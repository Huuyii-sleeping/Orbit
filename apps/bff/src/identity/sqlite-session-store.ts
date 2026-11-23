import Database from "better-sqlite3";
import { mkdirSync, chmodSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { auth } from "express-openid-connect";
import { decodeJwt } from "jose";

type LibraryStore = NonNullable<NonNullable<NonNullable<Parameters<typeof auth>[0]>["session"]>["store"]>;
type SessionPayload = Parameters<LibraryStore["set"]>[1];
type GetCallback = Parameters<LibraryStore["get"]>[1];

/** 面向单机共享 SQLite 的 OIDC 会话存储；保留注销墓碑阻止延迟写回。 */
export class SqliteSessionStore {
  private readonly database: Database.Database;
  private writes = 0;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if ((statSync(dirname(path)).mode & 0o077) !== 0) throw new Error("BFF session directory must be private (0700)");
    this.database = new Database(path);
    chmodSync(path, 0o600);
    this.database.pragma("busy_timeout = 5000");
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("synchronous = FULL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS oidc_sessions (
        id TEXT PRIMARY KEY, payload_json TEXT, expires_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0, issuer TEXT, subject TEXT, sid TEXT
      );
      CREATE INDEX IF NOT EXISTS oidc_sessions_subject ON oidc_sessions(issuer, subject);
      CREATE INDEX IF NOT EXISTS oidc_sessions_sid ON oidc_sessions(issuer, sid);
      CREATE TABLE IF NOT EXISTS oidc_revocations (
        issuer TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL,
        PRIMARY KEY(issuer, kind, value)
      );
    `);
    this.cleanup();
  }

  /** SDK 使用回调式 store 接口；无记录或已撤销一律返回未登录。 */
  get(id: string, callback: GetCallback): void {
    try {
      const row = this.database.prepare("SELECT payload_json FROM oidc_sessions WHERE id = ? AND revoked = 0 AND expires_at > ?")
        .get(id, Date.now()) as { payload_json: string | null } | undefined;
      callback(null, row?.payload_json ? JSON.parse(row.payload_json) as SessionPayload : null);
    } catch (error) { callback(error); }
  }

  /** 已撤销的 session ID 永远不接受迟到的 SDK 写回。 */
  set(id: string, session: SessionPayload, callback?: (error?: unknown) => void): void {
    try {
      const token = typeof session.data?.id_token === "string" ? decodeJwt(session.data.id_token) : undefined;
      const expiresAt = Math.min(Number(session.header?.exp) * 1000, Number(token?.exp ?? Infinity) * 1000);
      if (!Number.isFinite(expiresAt)) throw new Error("OIDC session expiry is required");
      this.database.transaction(() => {
        const revoked = token?.iss && (typeof token.sid === "string" || token.sub)
          ? this.database.prepare(`SELECT 1 FROM oidc_revocations WHERE issuer = ? AND expires_at > ?
            AND ((kind = 'sid' AND value = ?) OR (kind = 'sub' AND value = ?))`)
            .get(token.iss, Date.now(), token.sid ?? "", token.sub ?? "")
          : undefined;
        if (revoked) {
          this.database.prepare(`INSERT INTO oidc_sessions(id, expires_at, revoked) VALUES (?, ?, 1)
            ON CONFLICT(id) DO UPDATE SET revoked = 1, payload_json = NULL`)
            .run(id, expiresAt);
          return;
        }
        const current = this.database.prepare("SELECT payload_json FROM oidc_sessions WHERE id = ? AND revoked = 0")
          .get(id) as { payload_json: string | null } | undefined;
        if (current?.payload_json) {
          const persisted = JSON.parse(current.payload_json) as SessionPayload;
          const previous = persisted.data?.orbitIdentity;
          const incoming = session.data?.orbitIdentity;
          if (previous && incoming && Number(previous.selectedAt ?? 0) > Number(incoming.selectedAt ?? 0)) {
            session = { ...session, data: { ...session.data, orbitIdentity: previous } };
          }
        }
        this.database.prepare(`INSERT INTO oidc_sessions(id, payload_json, expires_at, revoked, issuer, subject, sid)
          VALUES (?, ?, ?, 0, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, expires_at = excluded.expires_at,
            issuer = excluded.issuer, subject = excluded.subject, sid = excluded.sid WHERE oidc_sessions.revoked = 0`)
          .run(id, JSON.stringify(session), expiresAt, token?.iss ?? null, token?.sub ?? null, typeof token?.sid === "string" ? token.sid : null);
      }).immediate();
      if (++this.writes % 1000 === 0) this.cleanup();
      callback?.();
    } catch (error) { if (callback) callback(error); else throw error; }
  }

  /** 本地注销时保留短期墓碑；即使原 session 尚未写入也能阻止竞态恢复。 */
  destroy(id: string, callback?: (error?: unknown) => void): void {
    try {
      this.database.prepare(`INSERT INTO oidc_sessions(id, expires_at, revoked) VALUES (?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET revoked = 1, payload_json = NULL`)
        .run(id, Date.now() + 300_000);
      callback?.();
    } catch (error) { if (callback) callback(error); else throw error; }
  }

  /** 只接受 OIDC 库已验签的 logout token 中的 issuer/sid/sub。 */
  revoke(issuer: string, sid?: string, subject?: string): void {
    if (!sid && !subject) throw new Error("logout token requires sid or sub");
    this.database.transaction(() => {
      const marker = this.database.prepare(`INSERT INTO oidc_revocations(issuer, kind, value, expires_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(issuer, kind, value) DO UPDATE SET expires_at = max(expires_at, excluded.expires_at)`);
      const expiry = Date.now() + 300_000;
      if (sid) marker.run(issuer, "sid", sid, expiry);
      if (subject) marker.run(issuer, "sub", subject, expiry);
      this.database.prepare(`UPDATE oidc_sessions SET revoked = 1, payload_json = NULL
        WHERE issuer = ? AND revoked = 0 AND (${sid ? "sid = ?" : "0"}${subject ? ` OR subject = ?` : ""})`)
        .run(issuer, ...(sid ? [sid] : []), ...(subject ? [subject] : []));
    }).immediate();
    if (++this.writes % 1000 === 0) this.cleanup();
  }

  /** 清理由本存储创建的已到期会话与墓碑。 */
  cleanup(): void {
    this.database.prepare("DELETE FROM oidc_sessions WHERE expires_at <= ?").run(Date.now());
    this.database.prepare("DELETE FROM oidc_revocations WHERE expires_at <= ?").run(Date.now());
  }

  /** 关闭当前连接；调用方负责完成 HTTP 请求后执行。 */
  close(): void { this.database.close(); }
}
