import { afterEach, describe, expect, it } from "vitest";
import { SopDatabase } from "../../../src/storage/sop-database.js";
import { SqliteSopsRepository } from "../../../src/sops/sqlite-sops.repository.js";
import { SopsService } from "../../../src/sops/sops.service.js";
import { OrganizationOperationsService } from "../../../src/identity/organization-operations.service.js";
import { createTestDraft } from "./test-fixtures.js";
import { builtinNodeRegistry } from "@orbit/workflow-core";

const databases: SopDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.onModuleDestroy()));
function setup() {
  const database = new SopDatabase({ sopDatabasePath: ":memory:" }); databases.push(database);
  const repository = new SqliteSopsRepository(database);
  return { repository, service: new SopsService(repository, database, new OrganizationOperationsService(database)) };
}

describe("SOP 持久化资源边界", () => {
  it("创建、导入和保存拒绝超大定义，原有草稿不被修改", () => {
    const { service, repository } = setup();
    const original = service.createDraft(createTestDraft());
    const oversized = { ...original, metadata: { secret: "中".repeat(400_000) } };
    for (const invoke of [() => service.createDraft({ ...oversized, id: "other" }),
      () => service.importDraft(oversized), () => service.previewImport(oversized),
      () => service.saveDraft(original.id, { expectedRevision: 0, draft: oversized })]) {
      expect(invoke).toThrowError(expect.objectContaining({ code: "WORKFLOW_RESOURCE_LIMIT", statusCode: 413 }));
    }
    expect(repository.listDrafts()).toEqual([original]);
  });

  it("发布也重新检查历史数据和容器规模，失败时不生成版本", async () => {
    const { service, repository } = setup();
    const draft = createTestDraft();
    const definition = builtinNodeRegistry.get("iteration")!;
    const config = definition.createDefaultConfig();
    config.maxItems = 1_001;
    draft.nodes.push({ kind: "builtin", id: "container", type: "iteration", version: 1, label: "iteration", position: { x: 0, y: 0 }, config, ports: definition.createPorts(config) });
    expect(() => service.createDraft(draft)).toThrowError(expect.objectContaining({ diagnosticCode: "workflow.iteration-limit", statusCode: 422 }));
    repository.createDraft(draft);
    await expect(service.publish(draft.id, { expectedRevision: 0 })).rejects.toMatchObject({ diagnosticCode: "workflow.iteration-limit" });
    expect(repository.listVersions(draft.id)).toEqual([]);
  });
});
