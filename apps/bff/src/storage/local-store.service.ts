import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { requireTenantContext } from "../identity/tenant-context.js";

export type LocalStoreOptions = {
  /** 旧 JSON 文件路径；事务数据库保存到同路径的 .sqlite 文件。 */
  filePath?: string;
  /** SaaS 模式必须使用可信租户与用户复合键，禁止回退本地全局表。 */
  requireTenantContext?: boolean;
};

const defaultStorePath = join(process.cwd(), ".data", "bff-business-state.json");

/** 业务配置的事务存储；首次访问时原子导入旧 JSON，保留原文件。 */
@Injectable()
export class LocalStoreService implements OnModuleDestroy {
  private readonly filePath: string;
  private connection?: Database.Database;

  constructor(private readonly options: LocalStoreOptions = {}) {
    this.filePath = options.filePath ?? defaultStorePath;
  }

  async readSection<T>(key: string, fallback: T): Promise<T> {
    return this.readValue(this.database(), key, fallback);
  }

  async writeSection<T>(key: string, value: T): Promise<T> {
    return this.updateSection(key, value, () => value);
  }

  /** 在写事务内读取并修改一个 section；回调必须同步，不能执行异步 I/O。 */
  async updateSection<T>(key: string, fallback: T, update: (current: T) => T): Promise<T> {
    const database = this.database();
    return database.transaction(() => {
      const value = update(this.readValue(database, key, fallback));
      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new Error(`section ${key} must be JSON serializable`);
      if (this.options.requireTenantContext) {
        const { issuer, tenantId, subject } = requireTenantContext();
        database.prepare(`INSERT INTO tenant_business_sections(issuer, tenant_id, subject, key, value_json) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(issuer, tenant_id, subject, key) DO UPDATE SET value_json = excluded.value_json`)
          .run(issuer, tenantId, subject, key, serialized);
      } else {
        database.prepare("INSERT INTO business_sections(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json")
          .run(key, serialized);
      }
      return value;
    }).immediate();
  }

  onModuleDestroy(): void {
    this.connection?.close();
    this.connection = undefined;
  }

  private readValue<T>(database: Database.Database, key: string, fallback: T): T {
    const tenant = this.options.requireTenantContext ? requireTenantContext() : undefined;
    const row = (tenant
      ? database.prepare("SELECT value_json FROM tenant_business_sections WHERE issuer = ? AND tenant_id = ? AND subject = ? AND key = ?")
        .get(tenant.issuer, tenant.tenantId, tenant.subject, key)
      : database.prepare("SELECT value_json FROM business_sections WHERE key = ?").get(key)) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) as T : fallback;
  }

  private database(): Database.Database {
    // 在任何文件或数据库副作用前阻断缺失上下文的 SaaS 调用。
    if (this.options.requireTenantContext) requireTenantContext();
    if (this.connection) return this.connection;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const database = new Database(`${this.filePath}.sqlite`);
    try {
      database.pragma("busy_timeout = 5000");
      database.pragma("journal_mode = WAL");
      database.pragma("synchronous = FULL");
      database.exec(`
        CREATE TABLE IF NOT EXISTS business_sections (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS business_migrations (version INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS tenant_business_sections (
          issuer TEXT NOT NULL, tenant_id TEXT NOT NULL, subject TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL,
          PRIMARY KEY (issuer, tenant_id, subject, key)
        );
      `);
      database.transaction(() => {
        if (database.prepare("SELECT 1 FROM business_migrations WHERE version = 1").get()) return;
        let document: unknown = {};
        try {
          document = JSON.parse(readFileSync(this.filePath, "utf8"));
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        }
        if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("legacy business state must be a JSON object");
        const insert = database.prepare("INSERT INTO business_sections(key, value_json) VALUES (?, ?)");
        for (const [key, value] of Object.entries(document)) insert.run(key, JSON.stringify(value));
        database.prepare("INSERT INTO business_migrations(version) VALUES (1)").run();
      }).immediate();
      this.connection = database;
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }
}
