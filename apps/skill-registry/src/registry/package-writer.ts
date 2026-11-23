import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { packageDirectory, sha256Hex } from "../packages/package-utils.js";
import type { SkillManifest, SkillPublisher, SkillRegistrySource } from "../types.js";

/** 已发布版本不可覆盖；相同内容与发布者的重试可安全重复。 */
export class SkillVersionConflictError extends Error {
  readonly code = "SKILL_VERSION_CONFLICT";
  constructor() { super("skill version already exists with different content or ownership"); }
}

/** 在同一数据库事务内保存发布元数据，包文件以内容哈希命名。 */
export function storePackage(database: DatabaseSync, packageRoot: string, input: {
  manifest: SkillManifest;
  packageRaw: string;
  source: SkillRegistrySource;
  publisher: SkillPublisher;
  packageSha256: string;
  deprecated: boolean;
  rating: number | null;
  downloads: number;
}): void {
  const directory = packageDirectory(packageRoot, input.manifest.id, input.manifest.version);
  const hash = sha256Hex(input.packageRaw);
  if (hash !== input.packageSha256) throw new Error("skill package checksum mismatch");
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database.prepare("SELECT package_sha256, publisher_id, source FROM skill_versions WHERE skill_id = ? AND version = ?")
      .get(input.manifest.id, input.manifest.version) as { package_sha256: string; publisher_id: string; source: string } | undefined;
    if (existing) {
      if (existing.package_sha256 !== hash || existing.publisher_id !== input.publisher.id || existing.source !== input.source) {
        throw new SkillVersionConflictError();
      }
      database.exec("COMMIT");
      return;
    }
    mkdirSync(directory, { recursive: true });
    const packagePath = join(directory, `${hash}.json`);
    if (existsSync(packagePath)) {
      if (sha256Hex(readFileSync(packagePath, "utf8")) !== hash) throw new Error("stored skill package checksum mismatch");
    } else {
      const temporary = `${packagePath}.${randomUUID()}.tmp`;
      try {
        // 先写完整临时文件再替换，进程中断不会暴露半写入的包。
        writeFileSync(temporary, input.packageRaw, { encoding: "utf8", flag: "wx", flush: true });
        renameSync(temporary, packagePath);
      } finally { rmSync(temporary, { force: true }); }
    }
    database.prepare(`INSERT INTO publishers(id, name, verified) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, verified = excluded.verified`)
      .run(input.publisher.id, input.publisher.name, input.publisher.verified ? 1 : 0);
    const manifest = input.manifest;
    const now = Date.now();
    database.prepare(`INSERT INTO skills(
      id, name, description, summary, category, provider, runtime, permissions_json, tags_json, entry, maturity, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .run(manifest.id, manifest.name, manifest.description, manifest.summary, manifest.category, manifest.provider,
        manifest.runtime, JSON.stringify(manifest.permissions), JSON.stringify(manifest.tags), manifest.entry, manifest.maturity, now, now);
    database.prepare(`INSERT INTO skill_versions(
      skill_id, version, publisher_id, source, package_sha256, deprecated, rating, download_count, package_path, manifest_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(manifest.id, manifest.version, input.publisher.id, input.source, hash, input.deprecated ? 1 : 0,
        input.rating, input.downloads, packagePath, JSON.stringify(manifest), now, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
