import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT, generateKeyPair } from "jose";
import { SqliteSessionStore, type SessionAuthorizationSnapshot } from "../../../src/identity/sqlite-session-store.js";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { protectSessionStream, SESSION_STREAM_RECHECK_MS } from "../../../src/identity/session-stream-authorization.js";
import Database from "better-sqlite3";

const roots: string[] = [];
const stores: SqliteSessionStore[] = [];
afterEach(async () => {
  vi.useRealTimers();
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "orbit-auth-store-")); roots.push(root);
  const path = join(root, "sessions.sqlite");
  const store = new SqliteSessionStore(path); stores.push(store);
  return { path, store };
}

async function payload(subject: string, sid: string, tenantId = "org-a", roles: string[] = []) {
  const { privateKey } = await generateKeyPair("RS256");
  const id_token = await new SignJWT({ sid, organization: { [tenantId]: { id: tenantId } } })
    .setProtectedHeader({ alg: "RS256" }).setIssuer("issuer").setSubject(subject)
    .setAudience("orbit").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  return {
    header: { iat: Math.floor(Date.now() / 1000), uat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 },
    data: { id_token, orbitIdentity: { issuer: "issuer", subject, organizations: [{ id: tenantId, alias: tenantId, roles }], selectedTenantId: tenantId } },
    cookie: { expires: Date.now() + 300_000, maxAge: 300_000 },
  };
}

function get(store: SqliteSessionStore, id: string) {
  return new Promise<unknown>((resolve, reject) => store.get(id, (error, value) => error ? reject(error) : resolve(value)));
}
function set(store: SqliteSessionStore, id: string, value: Awaited<ReturnType<typeof payload>>) {
  return new Promise<void>((resolve, reject) => store.set(id, value, (error) => error ? reject(error) : resolve()));
}
function destroy(store: SqliteSessionStore, id: string) {
  return new Promise<void>((resolve, reject) => store.destroy(id, (error) => error ? reject(error) : resolve()));
}

describe("SQLite OIDC session adapter", () => {
  it("旧会话表增加授权版本列后保留原会话和角色", async () => {
    const { path, store } = await setup();
    await set(store, "legacy", await payload("user1", "sid1", "org-a", ["viewer"]));
    store.close();
    const legacy = new Database(path);
    legacy.exec("ALTER TABLE oidc_sessions DROP COLUMN authorization_revision");
    legacy.close();
    const migrated = new SqliteSessionStore(path); stores.push(migrated);
    await migrated.runInRequest(async () => {
      expect(await get(migrated, "legacy")).toMatchObject({ data: { orbitIdentity: { organizations: [{ roles: ["viewer"] }] } } });
      expect(migrated.currentRequestSession()?.revision).toBe(0);
      expect(migrated.isCurrent(migrated.currentRequestSession()!)).toBe(true);
    });
  });

  it("签名注销同时给出 sid 和 sub 时不能撤销该用户的其他登录会话", async () => {
    const { store } = await setup();
    await set(store, "first", await payload("user1", "sid1"));
    await set(store, "second", await payload("user1", "sid2"));
    store.revoke("issuer", "sid1", "user1");
    expect(await get(store, "first")).toBeNull();
    expect(await get(store, "second")).not.toBeNull();
    await set(store, "third", await payload("user1", "sid3"));
    expect(await get(store, "third")).not.toBeNull();
  });

  it("会话授权版本防止切换后切回复活旧连接，迟到写回不覆盖最新组织", async () => {
    const { store } = await setup();
    const value = await payload("user1", "sid1");
    await set(store, "s", value);
    let snapshot: SessionAuthorizationSnapshot | undefined;
    await store.runInRequest(async () => { await get(store, "s"); snapshot = store.currentRequestSession(); });
    expect(snapshot).toBeDefined();
    expect(store.isCurrent(snapshot!)).toBe(true);
    await set(store, "s", { ...value, data: { ...value.data, orbitIdentity: { ...value.data.orbitIdentity, selectedTenantId: "org-b", selectedAt: 20 } } });
    await set(store, "s", { ...value, data: { ...value.data, orbitIdentity: { ...value.data.orbitIdentity, selectedAt: 21 } } });
    expect(store.isCurrent(snapshot!)).toBe(false);
    await set(store, "s", value);
    expect(await get(store, "s")).toMatchObject({ data: { orbitIdentity: { selectedTenantId: "org-a", selectedAt: 21 } } });
    expect(store.isCurrent(snapshot!)).toBe(false);
  });

  it("活动订阅在本地注销后关闭，不影响另一会话，并清理监听器和计时器", async () => {
    const { store } = await setup();
    await set(store, "a", await payload("user1", "sid1"));
    await set(store, "b", await payload("user2", "sid2"));
    vi.useFakeTimers();
    const streams: ServerResponse[] = [];
    for (const id of ["a", "b"]) await store.runInRequest(async () => {
      await get(store, id);
      const res = new ServerResponse(new IncomingMessage(new Socket())); streams.push(res);
      expect(protectSessionStream(store, res)).toBe(true);
    });
    expect(vi.getTimerCount()).toBe(4);
    await destroy(store, "a");
    expect(streams[0]!.destroyed).toBe(true);
    expect(streams[1]!.destroyed).toBe(false);
    expect(vi.getTimerCount()).toBe(2);
    streams[1]!.emit("finish");
    expect(vi.getTimerCount()).toBe(0);
    expect(streams[1]!.listenerCount("close")).toBe(0);
  });

  it("其他存储连接撤权在复查后关闭 SSE", async () => {
    const { store, path } = await setup();
    const other = new SqliteSessionStore(path); stores.push(other);
    const value = await payload("user1", "sid1");
    await set(store, "s", value);
    vi.useFakeTimers();
    const res = new ServerResponse(new IncomingMessage(new Socket()));
    await store.runInRequest(async () => { await get(store, "s"); expect(protectSessionStream(store, res)).toBe(true); });
    other.revoke("issuer", "sid1");
    expect(res.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(SESSION_STREAM_RECHECK_MS);
    expect(res.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("无活动请求的可信会话或存储读取失败时不能保持订阅，到期不延长", async () => {
    const { store } = await setup();
    const value = await payload("user1", "sid1");
    value.header.exp = Math.floor(Date.now() / 1000) + 2;
    await set(store, "s", value);
    const res = new ServerResponse(new IncomingMessage(new Socket()));
    expect(protectSessionStream(store, res)).toBe(false);
    vi.useFakeTimers();
    await store.runInRequest(async () => { await get(store, "s"); expect(protectSessionStream(store, res)).toBe(true); });
    await vi.advanceTimersByTimeAsync(2_001);
    expect(res.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    await set(store, "fault", await payload("user2", "sid2"));
    const broken = new ServerResponse(new IncomingMessage(new Socket()));
    await store.runInRequest(async () => { await get(store, "fault"); expect(protectSessionStream(store, broken)).toBe(true); });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = vi.spyOn(store, "isCurrent").mockImplementation(() => { throw new Error("private storage failure"); });
    try {
      await vi.advanceTimersByTimeAsync(SESSION_STREAM_RECHECK_MS);
      expect(broken.destroyed).toBe(true);
      expect(errorLog).toHaveBeenCalledWith("SSE session authorization check failed; closing connection");
      expect(vi.getTimerCount()).toBe(0);
    } finally { failure.mockRestore(); errorLog.mockRestore(); }
  });

  it("固定会话到期后旧角色不能因迟到写回而继续有效", async () => {
    const { store } = await setup();
    const value = await payload("user1", "sid1", "org-a", ["admin"]);
    await set(store, "privileged", value);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301_000);
    try {
      expect(await get(store, "privileged")).toBeNull();
      await set(store, "privileged", value);
      expect(await get(store, "privileged")).toBeNull();
    } finally { clock.mockRestore(); }
  });

  it("keeps a logout tombstone so delayed requests cannot resurrect a cookie", async () => {
    const { path, store } = await setup();
    const value = await payload("user1", "sid1");
    await set(store, "session1", value);
    expect(await get(store, "session1")).toMatchObject({ data: { orbitIdentity: { subject: "user1" } } });
    await destroy(store, "session1");
    await set(store, "session1", value);
    expect(await get(store, "session1")).toBeNull();
    const restarted = new SqliteSessionStore(path); stores.push(restarted);
    expect(await get(restarted, "session1")).toBeNull();
  });

  it("revokes only matching issuer and sid, or all matching subject sessions", async () => {
    const { store } = await setup();
    await set(store, "a", await payload("user1", "sid1"));
    await set(store, "b", await payload("user1", "sid2"));
    await set(store, "c", await payload("user2", "sid3"));
    store.revoke("issuer", "sid1", undefined);
    expect(await get(store, "a")).toBeNull();
    expect(await get(store, "b")).toBeTruthy();
    await set(store, "late", await payload("user1", "sid1"));
    expect(await get(store, "late")).toBeNull();
    store.revoke("issuer", undefined, "user1");
    expect(await get(store, "b")).toBeNull();
    expect(await get(store, "c")).toBeTruthy();
  });

  it("preserves the latest tenant selection when an old request finishes later", async () => {
    const { store } = await setup();
    const older = await payload("user1", "sid1");
    await set(store, "s", older);
    const newer = { ...older, data: { ...older.data, orbitIdentity: { ...older.data.orbitIdentity, selectedTenantId: "org-b", selectedAt: 20 } } };
    await set(store, "s", newer);
    await set(store, "s", older);
    expect(await get(store, "s")).toMatchObject({ data: { orbitIdentity: { selectedTenantId: "org-b" } } });
  });
});
