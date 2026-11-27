import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SopDatabase } from "../../../src/storage/sop-database.js";
import { OrganizationOperationsService } from "../../../src/identity/organization-operations.service.js";
import { runWithOrganizationAuthorization } from "../../../src/identity/organization-authorization.js";
import { verifiedIdentityFromClaims } from "../../../src/identity/organization-claims.js";
import { SqliteWorkflowRunsRepository } from "../../../src/workflow-runs/sqlite-workflow-runs.repository.js";

const databases: SopDatabase[] = [];
const roots: string[] = [];
afterEach(async () => {
  databases.splice(0).forEach((db) => db.onModuleDestroy());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const identity = verifiedIdentityFromClaims({ iss: "issuer", sub: "alice", organization: { org: { id: "org-a" } }, orbit_org_roles: { "org-a": ["admin"] } });
function setup() {
  const db = new SopDatabase({ sopDatabasePath: ":memory:", requireTenantContext: true }); databases.push(db);
  return { db, operations: new OrganizationOperationsService(db) };
}

describe("组织操作与持久化审计", () => {
  it("无法写入操作意图时不执行副作用；缺少授权时也不执行", async () => {
    const { db, operations } = setup();
    const effect = vi.fn(async () => "done");
    await expect(operations.perform("workflow.run", { type: "workflow", id: "workflow" }, effect)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    db.database.exec("create trigger audit_unavailable before insert on organization_audit_events begin select raise(abort, 'audit unavailable'); end;");
    await runWithOrganizationAuthorization(identity, async () => {
      await expect(operations.perform("workflow.run", { type: "workflow", id: "workflow" }, effect)).rejects.toThrow("audit unavailable");
    });
    expect(effect).not.toHaveBeenCalled();
  });

  it("副作用成功但结果审计失败时保留请求意图，不伪造成功或自动重试", async () => {
    const { db, operations } = setup();
    const effect = vi.fn(async () => "done");
    db.database.exec("create trigger audit_result_unavailable before insert on organization_audit_events when new.phase = 'succeeded' begin select raise(abort, 'audit result unavailable'); end;");
    await runWithOrganizationAuthorization(identity, async () => {
      await expect(operations.perform("workflow.cancel", { type: "run", id: "run" }, effect)).rejects.toThrow("audit result unavailable");
    });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(db.database.prepare("select phase from organization_audit_events").all()).toEqual([{ phase: "requested" }]);
  });

  it("数据库重启后仍保留不可变发起人与审计", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-operation-restart-")); roots.push(root);
    const db = new SopDatabase({ sopDataRoot: root, requireTenantContext: true }); databases.push(db);
    const operations = new OrganizationOperationsService(db);
    await runWithOrganizationAuthorization(identity, () => operations.perform("workflow.run", { type: "workflow", id: "workflow" }, async (actor) => {
      new SqliteWorkflowRunsRepository(db).saveRun({ id: "run", workflowId: "workflow", mode: "draft", status: "waiting", createdAt: Date.now(), inputs: {}, nodeRuns: {} }, actor?.subject);
    }));
    db.onModuleDestroy();
    const reopened = new SopDatabase({ sopDataRoot: root, requireTenantContext: true }); databases.push(reopened);
    runWithOrganizationAuthorization(identity, () => {
      expect(new SqliteWorkflowRunsRepository(reopened).getInitiator("run")).toBe("alice");
      expect(reopened.database.prepare("select subject, phase from organization_audit_events order by rowid").all())
        .toEqual([{ subject: "alice", phase: "requested" }, { subject: "alice", phase: "succeeded" }]);
    });
  });
});
