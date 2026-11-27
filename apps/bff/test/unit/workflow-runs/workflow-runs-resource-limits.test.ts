import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinNodeRegistry, type WorkflowVersion } from "@orbit/workflow-core";
import { SopDatabase } from "../../../src/storage/sop-database.js";
import { SqliteSopsRepository } from "../../../src/sops/sqlite-sops.repository.js";
import { SqliteWorkflowRunsRepository } from "../../../src/workflow-runs/sqlite-workflow-runs.repository.js";
import { WorkflowRunsService } from "../../../src/workflow-runs/workflow-runs.service.js";
import { OrganizationOperationsService } from "../../../src/identity/organization-operations.service.js";
import { createTestDraft } from "../sops/test-fixtures.js";

const databases: SopDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.onModuleDestroy()));
function setup() {
  const database = new SopDatabase({ sopDatabasePath: ":memory:" }); databases.push(database);
  const sops = new SqliteSopsRepository(database);
  const agent = { startWorkflowRun: vi.fn(), workflowRun: vi.fn(), cancelWorkflowRun: vi.fn(), resumeWorkflowRun: vi.fn(), workflowEventStream: vi.fn() };
  const service = new WorkflowRunsService(agent, sops, new SqliteWorkflowRunsRepository(database),
    { resolvePublishedVersion: () => undefined }, database, new OrganizationOperationsService(database));
  sops.createDraft(createTestDraft("workflow-a"));
  return { service, agent, sops };
}

describe("Workflow 代理前的资源检查", () => {
  it("Agent 返回超限快照时拒绝保存并返回固定上游错误", async () => {
    const { service, agent } = setup();
    agent.startWorkflowRun.mockResolvedValue({ ok: true, status: 201, body: { run: {
      id: "oversized-agent-run", workflowId: "workflow-a", status: "running", mode: "draft", nodeRuns: {},
      output: { text: "private-agent-response-".repeat(200_000) },
    } } });
    await expect(service.start({ workflowId: "workflow-a", mode: "draft" })).rejects.toMatchObject({
      statusCode: 502, code: "WORKFLOW_AGENT_RESPONSE_INVALID", message: "Agent 返回的运行快照超过资源上限。",
    });
    expect(service.persisted("oversized-agent-run")).toBeNull();
  });

  it("超限、超深和非对象运行输入均不访问 Agent", async () => {
    const { service, agent } = setup();
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 70; i++) deep = { nested: deep };
    for (const inputs of [{ secret: "中".repeat(90_000) }, deep, [], null]) {
      await expect(service.start({ workflowId: "workflow-a", mode: "draft", inputs: inputs as never })).rejects.toMatchObject({ code: "WORKFLOW_RESOURCE_LIMIT" });
    }
    await expect(service.start({ workflowId: "workflow-a", mode: "draft", nodeInputs: { secret: "x".repeat(262_144) } })).rejects.toMatchObject({ statusCode: 413 });
    expect(agent.startWorkflowRun).not.toHaveBeenCalled();
  });

  it("内联容器和发布依赖在递归收集 Agent 依赖之前受限", async () => {
    const { service, agent, sops } = setup();
    const draft = createTestDraft("workflow-a");
    const definition = builtinNodeRegistry.get("subworkflow")!;
    const config = { ...definition.createDefaultConfig(), workflowId: "child", versionId: "v1", contentHash: "hash" };
    draft.nodes.push({ kind: "builtin", id: "child", type: "subworkflow", version: 1, label: "child", position: { x: 0, y: 0 }, config, ports: definition.createPorts(config) });
    const child: WorkflowVersion = { schemaVersion: 2, id: "v1", workflowId: "child", version: 1,
      contentHash: "hash", createdAt: 1, createdBy: "test", nodes: draft.nodes, edges: [] };
    const resolve = vi.spyOn(sops, "getVersion").mockReturnValue(child);
    await expect(service.start({ workflowId: "workflow-a", mode: "draft", draft })).rejects.toMatchObject({ diagnosticCode: "compile.nested-depth-limit" });
    expect(resolve).toHaveBeenCalledTimes(6);
    expect(agent.startWorkflowRun).not.toHaveBeenCalled();
  });

  it("超限审批数据不触碰运行和上游，也不允许非对象数据默默变为空对象", async () => {
    const { service, agent } = setup();
    for (const data of [{ secret: "x".repeat(262_144) }, []]) {
      await expect(service.resume("unknown", { interruptId: "i", action: "approve", idempotencyKey: "key", data: data as never })).rejects.toMatchObject({ code: "WORKFLOW_RESOURCE_LIMIT" });
    }
    expect(agent.workflowRun).not.toHaveBeenCalled();
    expect(agent.resumeWorkflowRun).not.toHaveBeenCalled();
  });
});
