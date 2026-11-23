import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SopDatabase } from "../../../src/storage/sop-database.js";
import { SopRevisionConflictError } from "../../../src/sops/sops.errors.js";
import { SqliteSopsRepository } from "../../../src/sops/sqlite-sops.repository.js";
import { createTestDraft } from "./test-fixtures.js";
import { runWithTenant } from "../../../src/identity/tenant-context.js";

const roots: string[] = [];

async function setup() {
  const dataRoot = await mkdtemp(join(tmpdir(), "orbit-sops-repository-"));
  roots.push(dataRoot);
  const database = new SopDatabase({ sopDataRoot: dataRoot });
  return { database, repository: new SqliteSopsRepository(database) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("SqliteSopsRepository", () => {
  it("使用 revision 条件更新并拒绝过期写入", async () => {
    const { database, repository } = await setup();
    try {
      const created = repository.createDraft(createTestDraft());
      const saved = repository.updateDraft(created.id, 0, { ...created, name: "revision 1" });
      expect(saved.revision).toBe(1);
      expect(() => repository.updateDraft(created.id, 0, created)).toThrow(SopRevisionConflictError);
    } finally {
      database.onModuleDestroy();
    }
  });

  it("发布追加不可变版本并保持历史快照不受草稿修改影响", async () => {
    const { database, repository } = await setup();
    try {
      const draft = repository.createDraft(createTestDraft());
      const version = repository.publishVersion({
        schemaVersion: draft.schemaVersion,
        workflowId: draft.id,
        contentHash: "hash-1",
        createdAt: Date.now(),
        createdBy: "tester",
        nodes: draft.nodes,
        edges: draft.edges,
        metadata: { name: draft.name },
      });
      repository.updateDraft(draft.id, 0, { ...draft, name: "新草稿名称" });
      expect(repository.getVersion(draft.id, version.id)?.metadata).toMatchObject({ name: "测试工作流" });
      expect(repository.listVersions(draft.id)).toHaveLength(1);
    } finally {
      database.onModuleDestroy();
    }
  });

  it("发布事务失败时不留下半成品版本", async () => {
    const { database, repository } = await setup();
    try {
      const draft = repository.createDraft(createTestDraft("atomic-publish"));
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(() => repository.publishVersion({
        schemaVersion: draft.schemaVersion,
        workflowId: draft.id,
        contentHash: "hash-atomic",
        createdAt: Date.now(),
        createdBy: "tester",
        nodes: draft.nodes,
        edges: draft.edges,
        metadata: cyclic,
      })).toThrow(/circular|cyclic/i);
      expect(repository.listVersions(draft.id)).toEqual([]);
    } finally {
      database.onModuleDestroy();
    }
  });

  it("模板更新创建新版本而不是覆盖旧版本", async () => {
    const { database, repository } = await setup();
    try {
      const draft = createTestDraft();
      const base = {
        id: "template-1",
        version: 0,
        name: "模板",
        summary: "v1",
        sourceWorkflowId: draft.id,
        sourceVersionId: "version-1",
        parameterSchema: {},
        draft,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      expect(repository.createTemplate(base).version).toBe(1);
      expect(repository.createTemplate({ ...base, summary: "v2" }).version).toBe(2);
      expect(repository.getTemplate(base.id, 1)?.summary).toBe("v1");
      expect(repository.getTemplate(base.id)?.summary).toBe("v2");
    } finally {
      database.onModuleDestroy();
    }
  });

  it("同一业务 ID 在不同租户独立存储，跨租户版本和模板查询不可见", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "orbit-sops-tenants-"));
    roots.push(dataRoot);
    const localDatabase = new SopDatabase({ sopDataRoot: dataRoot });
    const local = new SqliteSopsRepository(localDatabase);
    const draft = createTestDraft("shared-workflow-id");
    local.createDraft({ ...draft, name: "旧本地草稿" });
    localDatabase.onModuleDestroy();
    const database = new SopDatabase({ sopDataRoot: dataRoot, requireTenantContext: true });
    const repository = new SqliteSopsRepository(database);
    const alpha = { issuer: "issuer", tenantId: "org-a", subject: "user" };
    const beta = { issuer: "issuer", tenantId: "org-b", subject: "user" };
    try {
      expect(() => repository.listDrafts()).toThrow(/tenant context/i);
      const alphaVersion = runWithTenant(alpha, () => {
        expect(repository.getDraft(draft.id)).toBeNull();
        repository.createDraft({ ...draft, name: "组织 A" });
        return repository.publishVersion({
          schemaVersion: draft.schemaVersion, workflowId: draft.id, contentHash: "alpha",
          createdAt: Date.now(), createdBy: "tester", nodes: draft.nodes, edges: draft.edges,
          metadata: { name: "组织 A" },
        });
      });
      runWithTenant(beta, () => {
        expect(repository.getDraft(draft.id)).toBeNull();
        expect(repository.getVersionById(alphaVersion.id)).toBeNull();
        expect(repository.getVersion(draft.id, alphaVersion.id)).toBeNull();
        expect(() => repository.updateDraft(draft.id, 0, draft)).toThrow();
        expect(repository.deleteDraft(draft.id)).toBe(false);
        expect(() => repository.createTemplate({
          id: "shared-template", version: 0, name: "非法模板", summary: "", sourceWorkflowId: draft.id,
          sourceVersionId: alphaVersion.id, parameterSchema: {}, draft, createdAt: Date.now(), updatedAt: Date.now(),
        })).toThrow();
        repository.createDraft({ ...draft, name: "组织 B" });
        const betaVersion = repository.publishVersion({
          schemaVersion: draft.schemaVersion, workflowId: draft.id, contentHash: "beta",
          createdAt: Date.now(), createdBy: "tester", nodes: draft.nodes, edges: draft.edges,
          metadata: { name: "组织 B" },
        });
        expect(betaVersion.version).toBe(1);
        expect(repository.createTemplate({
          id: "shared-template", version: 0, name: "组织 B 模板", summary: "", sourceWorkflowId: draft.id,
          sourceVersionId: betaVersion.id, parameterSchema: {}, draft, createdAt: Date.now(), updatedAt: Date.now(),
        }).version).toBe(1);
        expect(repository.getTemplate("shared-template")?.name).toBe("组织 B 模板");
        expect(repository.listVersions(draft.id)).toHaveLength(1);
        expect(repository.getDraft(draft.id)?.name).toBe("组织 B");
      });
      runWithTenant(alpha, () => {
        expect(repository.getVersionById(alphaVersion.id)).toEqual(alphaVersion);
        expect(repository.getTemplate("shared-template")).toBeNull();
        expect(repository.deleteTemplate("shared-template")).toBe(false);
        expect(repository.createTemplate({
          id: "shared-template", version: 0, name: "组织 A 模板", summary: "", sourceWorkflowId: draft.id,
          sourceVersionId: alphaVersion.id, parameterSchema: {}, draft, createdAt: Date.now(), updatedAt: Date.now(),
        }).version).toBe(1);
        expect(repository.listVersions(draft.id)).toHaveLength(1);
        expect(repository.getDraft(draft.id)?.name).toBe("组织 A");
      });
    } finally { database.onModuleDestroy(); }
  });
});
