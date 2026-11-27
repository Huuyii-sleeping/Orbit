import { OrganizationOperationsService } from "../../../src/identity/organization-operations.service.js";
import { afterEach, describe, expect, it } from "vitest";
import { builtinNodeRegistry } from "@orbit/workflow-core";
import { SopDatabase } from "../../../src/storage/sop-database.js";
import { SqliteSopsRepository } from "../../../src/sops/sqlite-sops.repository.js";
import { SopsService } from "../../../src/sops/sops.service.js";
import { runWithOrganizationAuthorization } from "../../../src/identity/organization-authorization.js";
import { verifiedIdentityFromClaims } from "../../../src/identity/organization-claims.js";
import { createTestDraft } from "./test-fixtures.js";

const databases: SopDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.onModuleDestroy()));
const identity = (roles: string[], tenantId = "org-a", subject = "alice") => verifiedIdentityFromClaims({
  iss: "issuer", sub: subject, organization: { org: { id: tenantId } }, orbit_org_roles: { [tenantId]: roles },
});
function setup() {
  const database = new SopDatabase({ sopDatabasePath: ":memory:", requireTenantContext: true });
  databases.push(database);
  const repository = new SqliteSopsRepository(database);
  return { database, service: new SopsService(repository, database, new OrganizationOperationsService(database)) };
}

describe("SOP 业务授权", () => {
  it("导入、版本派生、模板生命周期和模板派生均有独立审计动作", async () => {
    const { database, service } = setup();
    await runWithOrganizationAuthorization(identity(["admin"]), async () => {
      const imported = service.importDraft(createTestDraft("imported"));
      const version = await service.publish(imported.id, { expectedRevision: 0 });
      service.createDraftFromVersion(imported.id, version.id);
      const template = service.saveTemplate({ sourceVersionId: version.id, name: "template" });
      service.createDraftFromTemplate(template.id, template.version, { secret: "private-template-parameter" });
      service.deleteTemplate(template.id);
    });
    const rows = database.database.prepare("select detail_json from organization_audit_events where action = 'workflow.edit' and phase = 'succeeded' order by rowid").all();
    expect(rows).toEqual(["draft.import", "draft.from-version", "template.save", "draft.from-template", "template.delete"]
      .map((mutation) => ({ detail_json: JSON.stringify({ mutation }) })));
    expect(JSON.stringify(database.database.prepare("select * from organization_audit_events").all())).not.toContain("private-template-parameter");
  });

  it("草稿修订冲突保留失败审计，不能生成成功审计或修改已有数据", () => {
    const { database, service } = setup();
    runWithOrganizationAuthorization(identity(["editor"]), () => {
      const draft = service.createDraft(createTestDraft());
      expect(() => service.saveDraft(draft.id, { expectedRevision: 5, draft: { ...draft, name: "wrong" } }))
        .toThrowError(expect.objectContaining({ code: "SOP_REVISION_CONFLICT" }));
      expect(service.getDraft(draft.id).name).toBe(draft.name);
    });
    expect(database.database.prepare("select phase from organization_audit_events where detail_json like '%draft.save%' order by rowid").all())
      .toEqual([{ phase: "requested" }, { phase: "failed" }]);
  });

  it("草稿创建保存和删除记录可信操作者与动作，审计不包含正文", () => {
    const { database, service } = setup();
    runWithOrganizationAuthorization(identity(["editor"]), () => {
      const draft = service.createDraft({ ...createTestDraft(), summary: "private-draft-secret" });
      service.saveDraft(draft.id, { expectedRevision: 0, draft });
      service.deleteDraft(draft.id, 1);
    });
    const rows = database.database.prepare("select subject, action, phase, detail_json from organization_audit_events order by rowid").all();
    expect(rows).toHaveLength(6);
    expect(rows).toEqual(["draft.create", "draft.save", "draft.delete"].flatMap((mutation) => ["requested", "succeeded"].map((phase) => ({
      subject: "alice", action: "workflow.edit", phase, detail_json: JSON.stringify({ mutation }),
    }))));
    expect(JSON.stringify(rows)).not.toContain("private-draft-secret");
  });

  it("无法写入成功审计时草稿写入回滚，无法写入意图时不创建", () => {
    const { database, service } = setup();
    runWithOrganizationAuthorization(identity(["editor"]), () => {
      database.database.exec("create trigger audit_result_blocked before insert on organization_audit_events when new.phase = 'succeeded' begin select raise(abort, 'audit unavailable'); end;");
      expect(() => service.createDraft(createTestDraft("rollback"))).toThrow("audit unavailable");
      expect(service.listDrafts()).toEqual([]);
      expect(database.database.prepare("select phase from organization_audit_events order by rowid").all()).toEqual([{ phase: "requested" }, { phase: "failed" }]);
      database.database.exec("create trigger audit_request_blocked before insert on organization_audit_events when new.phase = 'requested' begin select raise(abort, 'audit request unavailable'); end;");
      expect(() => service.createDraft(createTestDraft("not-created"))).toThrow("audit request unavailable");
      expect(service.listDrafts()).toEqual([]);
    });
  });

  it("编辑者可修改但不能发布；发布者的 createdBy 只能来自登录身份", async () => {
    const { service } = setup();
    const draft = runWithOrganizationAuthorization(identity(["editor"]), () => service.createDraft(createTestDraft()));
    await runWithOrganizationAuthorization(identity(["editor"]), async () => {
      service.saveDraft(draft.id, { expectedRevision: 0, draft: { ...draft, name: "new" } });
      await expect(service.publish(draft.id, { expectedRevision: 1 })).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
    });
    await runWithOrganizationAuthorization(identity(["publisher"], "org-a", "bob"), async () => {
      const published = await service.publish(draft.id, { expectedRevision: 1, createdBy: "forged-admin" });
      expect(published.createdBy).toBe("bob");
      expect(() => service.deleteDraft(draft.id)).toThrowError(expect.objectContaining({ statusCode: 403 }));
    });
    runWithOrganizationAuthorization(identity(["admin"], "org-b"), () => {
      expect(() => service.getDraft(draft.id)).toThrowError(expect.objectContaining({ statusCode: 404 }));
    });
  });

  it("无角色时所有公开业务入口先拒绝，不因参数错误或资源存在性泄漏数据", async () => {
    const { service } = setup();
    const draft = createTestDraft();
    const calls = [
      () => service.listDrafts(), () => service.getDraft(draft.id), () => service.createDraft(draft),
      () => service.saveDraft(draft.id, { expectedRevision: 0, draft }), () => service.deleteDraft(draft.id),
      () => service.publish(draft.id, { expectedRevision: 0 }), () => service.listVersions(draft.id),
      () => service.getVersion(draft.id, "v1"), () => service.diffVersions(draft.id, "v1", "v2"),
      () => service.createDraftFromVersion(draft.id, "v1"), () => service.previewImport(draft),
      () => service.importDraft(draft), () => service.exportDraft(draft.id),
      () => service.saveTemplate({ name: "template", sourceVersionId: "v1" }), () => service.listTemplates(),
      () => service.getTemplate("template"), () => service.deleteTemplate("template"),
      () => service.createDraftFromTemplate("template", 1, {}),
    ];
    await runWithOrganizationAuthorization(identity([]), async () => {
      for (const invoke of calls) await expect(Promise.resolve().then(invoke)).rejects.toMatchObject({ code: "PERMISSION_DENIED", statusCode: 403 });
    });
    await expect(Promise.resolve().then(() => service.listDrafts())).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("组织管理员也不能调用整库健康、备份或恢复入口", async () => {
    const { service } = setup();
    await runWithOrganizationAuthorization(identity(["admin"]), async () => {
      for (const invoke of [() => service.storageHealth(), () => service.backup(), () => service.restore("backup.sqlite")]) {
        await expect(Promise.resolve().then(invoke)).rejects.toMatchObject({ code: "PERMISSION_DENIED", statusCode: 403 });
      }
    });
  });

  it("发布者也不能把其他组织的子工作流版本作为依赖发布", async () => {
    const { service } = setup();
    const foreign = await runWithOrganizationAuthorization(identity(["admin"], "org-b"), async () => {
      const draft = service.createDraft(createTestDraft("child"));
      return service.publish(draft.id, { expectedRevision: 0 });
    });
    await runWithOrganizationAuthorization(identity(["admin"]), async () => {
      const parent = createTestDraft("parent");
      const definition = builtinNodeRegistry.get("subworkflow")!;
      const config = { ...definition.createDefaultConfig(), workflowId: foreign.workflowId, versionId: foreign.id, contentHash: foreign.contentHash };
      parent.nodes.splice(1, 0, { kind: "builtin", id: "child", type: "subworkflow", version: 1, label: "child", position: { x: 0, y: 80 }, config, ports: definition.createPorts(config) });
      parent.edges = [
        { id: "start-child", source: { nodeId: "start", portId: "out" }, target: { nodeId: "child", portId: "in" } },
        { id: "child-end", source: { nodeId: "child", portId: "result" }, target: { nodeId: "end", portId: "in" } },
      ];
      service.createDraft(parent);
      await expect(service.publish(parent.id, { expectedRevision: 0 })).rejects.toMatchObject({ code: "SOP_VALIDATION_FAILED" });
      expect(service.listVersions(parent.id)).toEqual([]);
    });
  });
});
