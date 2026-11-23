import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type LocalStoreOptions = {
  /** 旧 JSON 文件路径；事务数据库保存到同路径的 .sqlite 文件。 */
  filePath?: string;
};

const defaultStorePath = join(process.cwd(), ".data", "bff-business-state.json");

/** 业务配置的事务存储；首次访问时原子导入旧 JSON，保留原文件。 */
@Injectable()
export class LocalStoreService implements OnModuleDestroy {
  private readonly filePath: string;
  private connection?: Database.Database;

  constructor(options: LocalStoreOptions = {}) {
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
      database.prepare("INSERT INTO business_sections(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json")
        .run(key, serialized);
      return value;
    }).immediate();
  }

  onModuleDestroy(): void {
    this.connection?.close();
    this.connection = undefined;
  }

  private readValue<T>(database: Database.Database, key: string, fallback: T): T {
    const row = database.prepare("SELECT value_json FROM business_sections WHERE key = ?").get(key) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) as T : fallback;
  }

  private database(): Database.Database {
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
