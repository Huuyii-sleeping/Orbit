import { OrganizationOperationsService } from "../../../src/identity/organization-operations.service.js";
import { runWithOrganizationAuthorization } from "../../../src/identity/organization-authorization.js";
import { verifiedIdentityFromClaims } from "../../../src/identity/organization-claims.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { SopDatabase } from "../../../src/storage/sop-database.js";
import { runWithTenant } from "../../../src/identity/tenant-context.js";
import { SqliteWorkflowRunsRepository } from "../../../src/workflow-runs/sqlite-workflow-runs.repository.js";
import { WorkflowRunsService } from "../../../src/workflow-runs/workflow-runs.service.js";

const databases: SopDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.onModuleDestroy()));

describe("WorkflowRunsService", () => {
  it("SaaS 请求在访问上游之前验证运行归属", async () => {
    const database = new SopDatabase({ sopDatabasePath: ":memory:", requireTenantContext: true });
    databases.push(database);
    const runs = new SqliteWorkflowRunsRepository(database);
    const agent = {
      startWorkflowRun: vi.fn(), workflowRun: vi.fn(), cancelWorkflowRun: vi.fn(),
      resumeWorkflowRun: vi.fn(), workflowEventStream: vi.fn(),
    };
    const service = new WorkflowRunsService(agent, { getDraft: vi.fn(), getVersion: vi.fn() }, runs,
      { resolvePublishedVersion: vi.fn() }, database, new OrganizationOperationsService(database));
    const owner = { issuer: "issuer", tenantId: "org-a", subject: "user-a" };
    const outsider = { ...owner, tenantId: "org-b" };
    runWithTenant(owner, () => runs.saveRun({
      id: "run-a", workflowId: "workflow-a", mode: "draft", status: "waiting", createdAt: 1,
      inputs: {}, nodeRuns: {},
    }));

    await runWithOrganizationAuthorization(verifiedIdentityFromClaims({ iss: outsider.issuer, sub: outsider.subject, organization: { org: { id: outsider.tenantId } }, orbit_org_roles: { [outsider.tenantId]: ["admin"] } }), async () => {
      await expect(service.get("run-a")).rejects.toMatchObject({ statusCode: 404, code: "WORKFLOW_RUN_NOT_FOUND" });
      await expect(service.cancel("run-a")).rejects.toMatchObject({ statusCode: 404, code: "WORKFLOW_RUN_NOT_FOUND" });
      await expect(service.resume("run-a", { interruptId: "approval", idempotencyKey: "key", action: "approve" }))
        .rejects.toMatchObject({ statusCode: 404, code: "WORKFLOW_RUN_NOT_FOUND" });
      const request = new IncomingMessage(new Socket());
      await expect(service.stream("run-a", request, new ServerResponse(request)))
        .rejects.toMatchObject({ statusCode: 404, code: "WORKFLOW_RUN_NOT_FOUND" });
    });
    expect(agent.workflowRun).not.toHaveBeenCalled();
    expect(agent.cancelWorkflowRun).not.toHaveBeenCalled();
    expect(agent.resumeWorkflowRun).not.toHaveBeenCalled();
    expect(agent.workflowEventStream).not.toHaveBeenCalled();
  });
});
