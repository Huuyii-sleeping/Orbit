import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SopDatabase } from "../../../src/storage/sop-database.js";
import { SqliteSopsRepository } from "../../../src/sops/sqlite-sops.repository.js";
import { createTestDraft } from "../sops/test-fixtures.js";

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "orbit-sops-db-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("SopDatabase", () => {
  it("启用 WAL 并创建显式迁移表、SOP 运行表和 AgentVersion，但不创建审批产品表", async () => {
    const database = new SopDatabase({ sopDataRoot: await root() });
    try {
      expect(database.health()).toMatchObject({ ok: true, journalMode: "wal", migrationVersion: 9 });
      const tables = database.database.prepare("select name from sqlite_master where type = 'table' order by name").all() as Array<{ name: string }>;
      expect(tables.map((item) => item.name)).toEqual(expect.arrayContaining([
        "schema_migrations",
        "sop_drafts",
        "sop_versions",
        "sop_templates",
        "workflow_runs",
        "workflow_node_runs",
        "workflow_events",
        "agent_versions",
      ]));
      expect(tables.map((item) => item.name)).not.toContain("approval_requests");
    } finally {
      database.onModuleDestroy();
    }
  });

  it("在线备份和恢复保持草稿事务一致性", async () => {
    const database = new SopDatabase({ sopDataRoot: await root() });
    const repository = new SqliteSopsRepository(database);
    try {
      const created = repository.createDraft(createTestDraft());
      const fileName = await database.backup("test");
      repository.updateDraft(created.id, 0, { ...created, name: "已修改" });
      expect(repository.getDraft(created.id)?.name).toBe("已修改");
      await database.restore(fileName);
      expect(repository.getDraft(created.id)?.name).toBe("测试工作流");
      expect(repository.getDraft(created.id)?.revision).toBe(0);
    } finally {
      database.onModuleDestroy();
    }
  });

  it("损坏数据库给出可读的恢复提示", async () => {
    const dataRoot = await root();
    await writeFile(join(dataRoot, "workflows.sqlite"), "not-a-sqlite-database", "utf8");
    expect(() => new SopDatabase({ sopDataRoot: dataRoot })).toThrow(/无法打开 SOP SQLite 数据库|完整性检查失败/);
  });

  it("无效备份在替换前拒绝，原数据库保持可读写", async () => {
    const database = new SopDatabase({ sopDataRoot: await root() });
    const repository = new SqliteSopsRepository(database);
    try {
      const draft = repository.createDraft(createTestDraft());
      await mkdir(database.backupRoot, { recursive: true });
      await writeFile(join(database.backupRoot, "invalid.sqlite"), "broken backup");
      await expect(database.restore("invalid.sqlite")).rejects.toThrow();
      expect(repository.getDraft(draft.id)?.name).toBe(draft.name);
      expect(repository.updateDraft(draft.id, 0, { ...draft, name: "仍可保存" }).name).toBe("仍可保存");
    } finally { database.onModuleDestroy(); }
  });

  it("SQLite 完整但缺少业务表的备份不能替换原库", async () => {
    const database = new SopDatabase({ sopDataRoot: await root() });
    const repository = new SqliteSopsRepository(database);
    try {
      const draft = repository.createDraft(createTestDraft());
      const fileName = await database.backup("schema");
      const broken = new Database(join(database.backupRoot, fileName));
      try { broken.exec("drop table sop_drafts"); } finally { broken.close(); }
      await expect(database.restore(fileName)).rejects.toThrow();
      expect(repository.getDraft(draft.id)?.name).toBe(draft.name);
    } finally { database.onModuleDestroy(); }
  });

  it("离线恢复可修复损坏的主库，无效备份不会替换损坏原件", async () => {
    const dataRoot = await root();
    const database = new SopDatabase({ sopDataRoot: dataRoot });
    const draft = new SqliteSopsRepository(database).createDraft(createTestDraft());
    const fileName = await database.backup("offline");
    database.onModuleDestroy();
    await writeFile(join(dataRoot, "workflows.sqlite"), "corrupt original");
    await writeFile(join(dataRoot, "backups/invalid.sqlite"), "invalid backup");
    await expect(SopDatabase.restoreOffline({ sopDataRoot: dataRoot }, "invalid.sqlite")).rejects.toThrow();
    expect(await readFile(join(dataRoot, "workflows.sqlite"), "utf8")).toBe("corrupt original");
    await SopDatabase.restoreOffline({ sopDataRoot: dataRoot }, fileName);
    const restored = new SopDatabase({ sopDataRoot: dataRoot });
    try { expect(new SqliteSopsRepository(restored).getDraft(draft.id)?.name).toBe(draft.name); }
    finally { restored.onModuleDestroy(); }
  });

  it("关闭并重新打开数据库后仍保留草稿", async () => {
    const dataRoot = await root();
    const first = new SopDatabase({ sopDataRoot: dataRoot });
    const created = new SqliteSopsRepository(first).createDraft(createTestDraft("restart-workflow"));
    first.onModuleDestroy();

    const reopened = new SopDatabase({ sopDataRoot: dataRoot });
    try {
      expect(new SqliteSopsRepository(reopened).getDraft(created.id)).toMatchObject({
        id: created.id,
        name: created.name,
        revision: 0,
      });
    } finally {
      reopened.onModuleDestroy();
    }
  });

  it("从 v6 迁移时保留旧数据在本地命名空间，并允许租户使用相同 ID", async () => {
    const dataRoot = await root();
    const path = join(dataRoot, "workflows.sqlite");
    const legacy = new Database(path);
    try {
      legacy.exec(`
        create table schema_migrations(version integer primary key, applied_at integer not null);
        insert into schema_migrations values(6, 1);
        create table sop_drafts(id text primary key, revision integer not null, schema_version integer not null,
          name text not null, summary text not null, content_json text not null, created_at integer not null, updated_at integer not null);
        create table sop_versions(id text primary key, workflow_id text not null, version integer not null,
          schema_version integer not null, content_hash text not null, created_by text not null, release_notes text not null,
          content_json text not null, created_at integer not null, unique(workflow_id, version));
        create table sop_templates(id text not null, version integer not null, name text not null, summary text not null,
          source_workflow_id text not null, source_version_id text not null, parameter_schema_json text not null,
          content_json text not null, created_at integer not null, updated_at integer not null, primary key(id, version));
        create table agent_versions(id text primary key, agent_profile_id text not null, version integer not null,
          content_hash text not null, name text not null, description text not null, snapshot_json text not null,
          created_by text not null, release_notes text not null, created_at integer not null, unique(agent_profile_id, version));
        create table workflow_runs(id text primary key, workflow_id text not null, version_id text,
          content_hash text, mode text not null, status text not null, input_json text not null,
          output_json text, error_json text, created_at integer not null, started_at integer,
          finished_at integer, node_instances_json text, child_runs_json text, waiting_json text);
        create table workflow_node_runs(run_id text not null, node_id text not null, status text not null,
          attempt integer not null, input_json text, output_json text, error_json text,
          started_at integer, finished_at integer, duration_ms integer, primary key(run_id, node_id),
          foreign key(run_id) references workflow_runs(id) on delete cascade);
        create table workflow_events(run_id text not null, event_id integer not null, type text not null,
          event_json text not null, created_at integer not null, primary key(run_id, event_id),
          foreign key(run_id) references workflow_runs(id) on delete cascade);
        insert into sop_drafts values('same-id', 0, 2, '旧草稿', '', '{}', 1, 1);
        insert into sop_versions values('same-version', 'same-id', 1, 2, 'hash', 'old', '', '{}', 1);
        insert into sop_templates values('same-template', 1, '旧模板', '', 'same-id', 'same-version', '{}', '{}', 1, 1);
        insert into agent_versions values('same-agent', 'same-profile', 1, 'hash', '旧 Agent', '', '{}', 'old', '', 1);
        insert into workflow_runs(id, workflow_id, mode, status, input_json, created_at)
          values('same-run', 'same-id', 'draft', 'succeeded', '{}', 1);
        insert into workflow_node_runs(run_id, node_id, status, attempt)
          values('same-run', 'node-1', 'succeeded', 1);
        insert into workflow_events values('same-run', 1, 'run.status', '{}', 1);
      `);
    } finally { legacy.close(); }
    const database = new SopDatabase({ sopDataRoot: dataRoot, requireTenantContext: true });
    try {
      expect(database.health().migrationVersion).toBe(9);
      for (const table of ["sop_drafts", "sop_versions", "sop_templates", "agent_versions"]) {
        const row = database.database.prepare(`select issuer, tenant_id from ${table}`).get() as { issuer: string; tenant_id: string };
        expect(row).toEqual({ issuer: "", tenant_id: "" });
      }
      for (const table of ["workflow_runs", "workflow_node_runs", "workflow_events"]) {
        expect(database.database.prepare(`select issuer, tenant_id from ${table}`).get())
          .toEqual({ issuer: "", tenant_id: "" });
      }
      expect(database.database.prepare("pragma foreign_key_check").all()).toEqual([]);
      expect(database.database.prepare("select initiated_by from workflow_runs").get()).toEqual({ initiated_by: null });
      database.database.prepare(`insert into sop_drafts
        (issuer, tenant_id, id, revision, schema_version, name, summary, content_json, created_at, updated_at)
        values (?, ?, 'same-id', 0, 2, '租户草稿', '', '{}', 1, 1)`).run("issuer", "org-a");
      expect(database.database.prepare("select count(*) as count from sop_drafts where id = 'same-id'").get())
        .toEqual({ count: 2 });
      expect(() => database.database.prepare(`insert into sop_versions
        (issuer, tenant_id, id, workflow_id, version, schema_version, content_hash, created_by, release_notes, content_json, created_at)
        values ('issuer', 'org-b', 'new-version', 'same-id', 1, 2, 'hash', 'user', '', '{}', 1)`).run())
        .toThrow(/tenant workflow draft/i);
      expect(() => database.database.prepare(`insert into sop_templates
        (issuer, tenant_id, id, version, name, summary, source_workflow_id, source_version_id,
          parameter_schema_json, content_json, created_at, updated_at)
        values ('issuer', 'org-a', 'new-template', 1, 'test', '', 'same-id', 'same-version', '{}', '{}', 1, 1)`).run())
        .toThrow(/tenant workflow version/i);
      await expect(database.backup()).rejects.toThrow(/共享 SaaS/);
      await expect(database.restore("anything.sqlite")).rejects.toThrow(/共享 SaaS/);
    } finally { database.onModuleDestroy(); }
  });
});
