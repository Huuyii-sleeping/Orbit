import { randomUUID } from "node:crypto";
import { existsSync, renameSync, rmSync } from "node:fs";
import { copyFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import { SopStorageError } from "./sops.errors.js";

/** 先校验备份，再同步切换；切换失败时恢复原文件与连接。离线调用方必须先停 BFF。 */
export async function replaceSopBackup(options: {
  databasePath: string;
  backupRoot: string;
  fileName: string;
  validate: (path: string) => void;
  beforeReplace?: () => void;
  afterReplace?: () => void;
}): Promise<void> {
  const { databasePath, backupRoot, fileName } = options;
  if (databasePath === ":memory:" || !fileName || fileName === "." || fileName === ".." || basename(fileName) !== fileName) {
    throw new SopStorageError("备份文件名或数据库路径无效。");
  }
  const temporary = `${databasePath}.restore-${randomUUID()}`;
  const rollback = `${temporary}.previous`;
  const moved: string[] = [];
  try {
    await copyFile(join(backupRoot, fileName), temporary);
    const candidate = new Database(temporary, { readonly: true, fileMustExist: true });
    try {
      const integrity = candidate.pragma("integrity_check", { simple: true });
      if (integrity !== "ok" || !candidate.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()) {
        throw new Error("backup is not a valid SOP database");
      }
    } finally { candidate.close(); }
    options.validate(temporary);
    // 连接关闭后的文件切换不让出事件循环，避免请求观察到半完成状态。
    options.beforeReplace?.();
    let installed = false;
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        if (existsSync(`${databasePath}${suffix}`)) {
          renameSync(`${databasePath}${suffix}`, `${rollback}${suffix}`);
          moved.push(suffix);
        }
      }
      renameSync(temporary, databasePath);
      installed = true;
      options.afterReplace?.();
    } catch (error) {
      if (installed) {
        for (const suffix of ["", "-wal", "-shm"]) rmSync(`${databasePath}${suffix}`, { force: true });
      }
      for (const suffix of moved) renameSync(`${rollback}${suffix}`, `${databasePath}${suffix}`);
      options.afterReplace?.();
      throw error;
    }
    for (const suffix of moved) rmSync(`${rollback}${suffix}`, { force: true });
  } catch (error) {
    throw new SopStorageError("SOP 数据库恢复失败，备份校验或文件切换未完成。", { fileName, cause: String(error) });
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) await rm(`${temporary}${suffix}`, { force: true });
  }
}
