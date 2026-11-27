import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SopDatabase } from "../../../src/storage/sop-database.js";
import { SqliteSopsRepository } from "../../../src/sops/sqlite-sops.repository.js";
import { SqliteWorkflowRunsRepository } from "../../../src/workflow-runs/sqlite-workflow-runs.repository.js";
import { WorkflowRunsService } from "../../../src/workflow-runs/workflow-runs.service.js";
import type { WorkflowRunSnapshot } from "../../../src/workflow-runs/workflow-runs.types.js";
import { OrganizationOperationsService } from "../../../src/identity/organization-operations.service.js";
import { runWithOrganizationAuthorization } from "../../../src/identity/organization-authorization.js";
import { verifiedIdentityFromClaims } from "../../../src/identity/organization-claims.js";
import { createTestDraft } from "../sops/test-fixtures.js";

const databases: SopDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.onModuleDestroy()));
const identity = (roles: string[], subject = "alice", tenantId = "org-a", issuer = "issuer") => verifiedIdentityFromClaims({
  iss: issuer, sub: subject, organization: { org: { id: tenantId } }, orbit_org_roles: { [tenantId]: roles },
});
const decision = { interruptId: "interrupt-1", action: "approve" as const, idempotencyKey: "private-key", data: { secret: "approval-body-secret" } };

function setup() {
  const database = new SopDatabase({ sopDatabasePath: ":memory:", requireTenantContext: true });
  databases.push(database);
  const sops = new SqliteSopsRepository(database);
  const runs = new SqliteWorkflowRunsRepository(database);
  let snapshot: WorkflowRunSnapshot = {
    id: "run-a", workflowId: "workflow-a", mode: "draft", status: "waiting", createdAt: Date.now(), inputs: {}, nodeRuns: {},
    waiting: { nodeId: "approval", reason: "approval", waiting: {
      kind: "approval", interruptId: "interrupt-1", approvalRequestId: "interrupt-1", deadline: Date.now() + 60_000,
      displayFields: [], decisionSchema: { type: "object" },
    } },
  };
  const response = () => ({ ok: true as const, status: 200, body: { ok: true, run: snapshot } });
  const agent = {
    startWorkflowRun: vi.fn(async () => response()), workflowRun: vi.fn(async () => response()),
    cancelWorkflowRun: vi.fn(async () => response()),
    resumeWorkflowRun: vi.fn(async () => { snapshot = { ...snapshot, status: "succeeded", waiting: undefined }; return response(); }),
    workflowEventStream: vi.fn(async () => new Response()),
  };
  const service = new WorkflowRunsService(agent, sops, runs, { resolvePublishedVersion: () => undefined }, database, new OrganizationOperationsService(database));
  runWithOrganizationAuthorization(identity(["editor"]), () => sops.createDraft(createTestDraft("workflow-a")));
  return { service, agent, runs, database, snapshot };
}

describe("Workflow 控制操作授权", () => {
  it("可信发起人随运行保存，查询和后续快照不能覆盖；管理员也不能自审批", async () => {
    const { service, runs, agent, snapshot, database } = setup();
    await runWithOrganizationAuthorization(identity(["admin"]), async () => {
      await service.start({ workflowId: "workflow-a", mode: "draft" });
      expect(runs.getInitiator("run-a")).toBe("alice");
      runs.saveRun(snapshot, "forged-bob");
      expect(runs.getInitiator("run-a")).toBe("alice");
      expect(() => database.database.prepare("update workflow_runs set initiated_by = 'bob' where id = 'run-a'").run()).toThrow(/immutable/);
      await expect(service.resume("run-a", decision)).rejects.toMatchObject({ statusCode: 403, code: "WORKFLOW_SELF_APPROVAL_FORBIDDEN" });
      expect(agent.workflowRun).not.toHaveBeenCalled();
      expect(agent.resumeWorkflowRun).not.toHaveBeenCalled();
    });
  });

  it("查看者不能运行、取消或审批，角色检查发生在访问上游之前", async () => {
    const { service, runs, agent, snapshot } = setup();
    await runWithOrganizationAuthorization(identity(["viewer"], "bob"), async () => {
      runs.saveRun(snapshot, "alice");
      await expect(service.start({ workflowId: "workflow-a", mode: "draft" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(service.cancel("run-a")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(service.resume("run-a", decision)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(agent.startWorkflowRun).not.toHaveBeenCalled();
      expect(agent.cancelWorkflowRun).not.toHaveBeenCalled();
      expect(agent.resumeWorkflowRun).not.toHaveBeenCalled();
      expect(agent.workflowRun).not.toHaveBeenCalled();
      expect(await service.get("run-a")).toMatchObject({ id: "run-a" });
      expect(runs.getInitiator("run-a")).toBe("alice");
    });
  });

  it("有审批权的其他成员可重试审批，审计保留真实身份与键哈希，不保存审批正文", async () => {
    const { service, database, runs } = setup();
    await runWithOrganizationAuthorization(identity(["operator"]), () => service.start({ workflowId: "workflow-a", mode: "draft" }));
    await runWithOrganizationAuthorization(identity(["approver"], "bob"), async () => {
      await expect(service.resume("run-a", decision)).resolves.toMatchObject({ status: "succeeded" });
      await expect(service.resume("run-a", decision)).resolves.toMatchObject({ status: "succeeded" });
      expect(runs.getInitiator("run-a")).toBe("alice");
      await expect(service.start({ workflowId: "workflow-a", mode: "draft" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    });
    const rows = database.database.prepare("select subject, action, phase, detail_json from organization_audit_events where action = 'workflow.approve'").all();
    expect(rows).toHaveLength(4);
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ subject: "bob", phase: "succeeded" })]));
    expect(JSON.stringify(rows)).not.toContain("private-key");
    expect(JSON.stringify(rows)).not.toContain("approval-body-secret");
    expect(JSON.parse(rows[0].detail_json)).toMatchObject({ interruptId: "interrupt-1", decision: "approve", idempotencyKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(() => database.database.prepare("delete from organization_audit_events").run()).toThrow(/immutable/);
  });

  it("历史运行缺少可信发起人时拒绝审批，不能通过后续写回补成任意用户", async () => {
    const { service, runs, snapshot, agent } = setup();
    await runWithOrganizationAuthorization(identity(["approver"], "bob"), async () => {
      runs.saveRun(snapshot);
      runs.saveRun(snapshot, "mallory");
      expect(runs.getInitiator(snapshot.id)).toBeNull();
      await expect(service.resume(snapshot.id, decision)).rejects.toMatchObject({ code: "WORKFLOW_RUN_INITIATOR_REQUIRED" });
      expect(agent.resumeWorkflowRun).not.toHaveBeenCalled();
    });
  });

  it("跨组织及跨 issuer 的管理员也不能操作运行，内联草稿不能绕过所属组织检查", async () => {
    const { service, agent } = setup();
    await runWithOrganizationAuthorization(identity(["operator"]), () => service.start({ workflowId: "workflow-a", mode: "draft" }));
    agent.startWorkflowRun.mockClear();
    for (const outsider of [identity(["admin"], "mallory", "org-b"), identity(["admin"], "mallory", "org-a", "other-issuer")]) {
      await runWithOrganizationAuthorization(outsider, async () => {
        await expect(service.get("run-a")).rejects.toMatchObject({ statusCode: 404 });
        await expect(service.cancel("run-a")).rejects.toMatchObject({ statusCode: 404 });
        await expect(service.resume("run-a", decision)).rejects.toMatchObject({ statusCode: 404 });
        const req = new IncomingMessage(new Socket());
        await expect(service.stream("run-a", req, new ServerResponse(req))).rejects.toMatchObject({ statusCode: 404 });
        await expect(service.start({ workflowId: "workflow-a", mode: "draft", draft: createTestDraft("workflow-a") })).rejects.toMatchObject({ statusCode: 404 });
      });
    }
    expect(agent.startWorkflowRun).not.toHaveBeenCalled();
    expect(agent.workflowRun).not.toHaveBeenCalled();
    expect(agent.cancelWorkflowRun).not.toHaveBeenCalled();
    expect(agent.resumeWorkflowRun).not.toHaveBeenCalled();
    expect(agent.workflowEventStream).not.toHaveBeenCalled();
  });

  it("缺少可信权限时索引与上游接口均拒绝；上游失败记录失败审计且不保存错误原文", async () => {
    const { service, agent, database } = setup();
    expect(() => service.persisted("run-a")).toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(() => service.listAgentTests("agent-a")).toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    await expect(service.get("run-a")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    agent.startWorkflowRun.mockRejectedValueOnce(new Error("upstream-credential-secret"));
    await runWithOrganizationAuthorization(identity(["operator"]), async () => {
      await expect(service.start({ workflowId: "workflow-a", mode: "draft" })).rejects.toThrow("upstream-credential-secret");
    });
    const rows = database.database.prepare("select phase, detail_json from organization_audit_events").all();
    expect(rows.map((row) => row.phase)).toEqual(["requested", "failed"]);
    expect(JSON.stringify(rows)).not.toContain("upstream-credential-secret");
  });

  it("上游返回其他运行时拒绝响应，不写入额外运行或改变发起人", async () => {
    const { service, agent, runs, snapshot } = setup();
    await runWithOrganizationAuthorization(identity(["operator"]), () => service.start({ workflowId: "workflow-a", mode: "draft" }));
    agent.workflowRun.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true, run: { ...snapshot, id: "unexpected-run" } } });
    await runWithOrganizationAuthorization(identity(["viewer"], "bob"), async () => {
      await expect(service.get("run-a")).rejects.toMatchObject({ statusCode: 502, code: "WORKFLOW_AGENT_RESPONSE_INVALID" });
      expect(runs.getRun("unexpected-run")).toBeNull();
      expect(runs.getInitiator("run-a")).toBe("alice");
    });
  });
});
