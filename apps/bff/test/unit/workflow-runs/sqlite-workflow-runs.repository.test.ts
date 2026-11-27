import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SopDatabase } from "../../../src/storage/sop-database.js";
import { SqliteWorkflowRunsRepository } from "../../../src/workflow-runs/sqlite-workflow-runs.repository.js";
import { runWithTenant } from "../../../src/identity/tenant-context.js";
import type { WorkflowRunSnapshot } from "../../../src/workflow-runs/workflow-runs.types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRepository(requireTenantContext = false) {
  const root = await mkdtemp(join(tmpdir(), "orbit-workflow-runs-"));
  roots.push(root);
  const database = new SopDatabase({ sopDataRoot: root, requireTenantContext });
  return { database, repository: new SqliteWorkflowRunsRepository(database, { now: () => 50 }) };
}

function queuedRun(): WorkflowRunSnapshot {
  return {
    id: "run-1",
    workflowId: "workflow-1",
    versionId: "version-1",
    contentHash: "hash-1",
    mode: "production",
    status: "queued",
    createdAt: 10,
    inputs: { question: "hello" },
    nodeRuns: { node1: { nodeId: "node1", status: "pending", attempt: 0 } },
  };
}

describe("SqliteWorkflowRunsRepository", () => {
  it("超限快照和事件不落库，累计投影超限回滚，资源失败后旧输出不会重新灌入", async () => {
    const { database, repository } = await createRepository();
    try {
      const run = { ...queuedRun(), status: "running" as const };
      repository.saveRun(run);
      expect(() => repository.saveRun({ ...run, output: { text: "x".repeat(4_194_304) } })).toThrowError(expect.objectContaining({ code: "WORKFLOW_OUTPUT_LIMIT_EXCEEDED" }));
      expect(repository.getRun(run.id)?.output).toBeUndefined();
      expect(() => repository.saveEvent({ id: 1, runId: run.id, at: 10, type: "node.output", nodeId: "node1", output: { text: "x".repeat(1_114_112) } })).toThrowError(expect.objectContaining({ code: "WORKFLOW_OUTPUT_LIMIT_EXCEEDED" }));
      expect(repository.listEvents(run.id)).toEqual([]);
      repository.saveRun({ ...run, output: { text: "x".repeat(3_300_000) } });
      expect(() => repository.saveEvent({ id: 2, runId: run.id, at: 20, type: "node.output", nodeId: "node1", output: { text: "x".repeat(950_000) } })).toThrowError(expect.objectContaining({ code: "WORKFLOW_OUTPUT_LIMIT_EXCEEDED" }));
      expect(repository.listEvents(run.id)).toEqual([]);
      expect(repository.getRun(run.id)?.nodeRuns.node1.output).toBeUndefined();
      repository.saveEvent({ id: 3, runId: run.id, at: 30, type: "run.status", status: "failed", error: { code: "WORKFLOW_OUTPUT_LIMIT_EXCEEDED", message: "resource failure" } });
      repository.saveEvent({ id: 1, runId: run.id, at: 10, type: "node.output", nodeId: "node1", output: { text: "old output" } });
      expect(repository.getRun(run.id)).toMatchObject({ status: "failed" });
      expect(repository.getRun(run.id)?.output).toBeUndefined();
      expect(repository.getRun(run.id)?.nodeRuns.node1.output).toBeUndefined();
    } finally { database.onModuleDestroy(); }
  });

  it("同名运行、节点和事件按租户隔离，旧本地记录不可见", async () => {
    const { database, repository } = await createRepository(true);
    const tenantA = { issuer: "issuer", tenantId: "tenant-a", subject: "user-a" };
    const tenantB = { issuer: "issuer", tenantId: "tenant-b", subject: "user-b" };
    const colleague = { ...tenantA, subject: "user-c" };
    try {
      database.database.prepare(`insert into workflow_runs(id, workflow_id, mode, status, input_json, created_at)
        values ('run-1', 'workflow-1', 'draft', 'succeeded', '{}', 1)`).run();
      expect(() => repository.getRun("run-1")).toThrow("Trusted tenant context");
      runWithTenant(tenantA, () => {
        repository.saveRun(queuedRun());
        expect(repository.saveEvent({ id: 1, runId: "run-1", at: 20, type: "run.status", status: "running" })).toBe(true);
      });
      runWithTenant(tenantB, () => {
        expect(repository.getRun("run-1")).toBeNull();
        expect(repository.listEvents("run-1")).toEqual([]);
        repository.saveRun({ ...queuedRun(), inputs: { question: "tenant-b" } });
        expect(repository.saveEvent({ id: 1, runId: "run-1", at: 30, type: "run.status", status: "waiting" })).toBe(true);
        expect(repository.getRun("run-1")?.inputs).toEqual({ question: "tenant-b" });
      });
      runWithTenant(tenantA, () => {
        expect(repository.getRun("run-1")?.inputs).toEqual({ question: "hello" });
        expect(repository.getRun("run-1")?.status).toBe("running");
        expect(repository.listEvents("run-1").map((event) => event.at)).toEqual([20]);
      });
      runWithTenant(colleague, () => expect(repository.getRun("run-1")?.status).toBe("running"));
      expect(database.database.prepare("select count(*) as total from workflow_runs where id = 'run-1'").get())
        .toEqual({ total: 3 });
      runWithTenant(tenantA, () => {
        repository.saveRun({ ...queuedRun(), status: "succeeded", finishedAt: 100 });
        expect(repository.cleanupExpired(250, 100)).toEqual(["run-1"]);
      });
      runWithTenant(tenantB, () => expect(repository.getRun("run-1")?.inputs).toEqual({ question: "tenant-b" }));
      expect(database.database.prepare("select count(*) as total from workflow_runs where id = 'run-1'").get())
        .toEqual({ total: 2 });
    } finally { database.onModuleDestroy(); }
  });
  it("保存运行、节点 attempt 和有序事件，并按事件 id 去重", async () => {
    const { database, repository } = await createRepository();
    try {
      repository.saveRun(queuedRun());
      const running = { id: 1, runId: "run-1", at: 20, type: "run.status", status: "running" } as const;
      const failed = { id: 2, runId: "run-1", at: 30, type: "node.status", nodeId: "node1", status: "failed", attempt: 2, error: { code: "FAILED", message: "boom", nodeId: "node1", attempt: 2 } } as const;
      const instance = { id: 3, runId: "run-1", at: 40, type: "node.status", nodeId: "node1", status: "running", attempt: 1, instanceId: "item-0", containerId: "iteration-1", iterationIndex: 0, childRunId: "child-1" } as const;
      const waiting = { id: 4, runId: "run-1", at: 50, type: "run.waiting", nodeId: "approval", reason: "Human approval pending", waiting: { kind: "approval", interruptId: "approval-1", approvalRequestId: "approval-1", deadline: 100, displayFields: [{ id: "summary", label: "摘要", value: "已脱敏" }], decisionSchema: { type: "object" } } } as const;
      expect(repository.saveEvent(running)).toBe(true);
      expect(repository.saveEvent(running)).toBe(false);
      expect(repository.saveEvent(failed)).toBe(true);
      expect(repository.saveEvent(instance)).toBe(true);
      expect(repository.saveEvent(waiting)).toBe(true);

      expect(repository.listEvents("run-1").map((event) => event.id)).toEqual([1, 2, 3, 4]);
      expect(repository.getRun("run-1")).toMatchObject({
        status: "running",
        startedAt: 20,
        nodeRuns: { node1: { status: "running", attempt: 1, error: { code: "FAILED", attempt: 2 } } },
        nodeInstances: { "node1::item-0": { instanceId: "item-0", containerId: "iteration-1", iterationIndex: 0 } },
        childRuns: { "child-1": { childRunId: "child-1", parentNodeId: "node1", status: "running" } },
        waiting: { nodeId: "approval", waiting: { kind: "approval", approvalRequestId: "approval-1" } },
      });
    } finally {
      database.onModuleDestroy();
    }
  });

  it("乱序与重放事件不会让终态回退，也不会丢弃其他节点的迟到事件", async () => {
    const { database, repository } = await createRepository();
    try {
      repository.saveRun(queuedRun());
      repository.saveEvent({ id: 5, runId: "run-1", at: 40, type: "node.status", nodeId: "node1", status: "succeeded", attempt: 1 });
      repository.saveEvent({ id: 3, runId: "run-1", at: 30, type: "node.status", nodeId: "node1", status: "running", attempt: 1 });
      repository.saveEvent({ id: 4, runId: "run-1", at: 35, type: "node.status", nodeId: "node2", status: "succeeded", attempt: 1 });
      repository.saveEvent({ id: 8, runId: "run-1", at: 50, type: "run.status", status: "succeeded" });
      repository.saveEvent({ id: 1, runId: "run-1", at: 20, type: "run.status", status: "running" });
      repository.saveEvent({ id: 2, runId: "run-1", at: 25, type: "run.waiting", nodeId: "approval", reason: "old wait" });
      expect(repository.getRun("run-1")).toMatchObject({ status: "succeeded", nodeRuns: { node1: { status: "succeeded" }, node2: { status: "succeeded" } } });
      expect(repository.getRun("run-1")?.waiting).toBeUndefined();
      expect(repository.listEvents("run-1").map((event) => event.id)).toEqual([1, 2, 3, 4, 5, 8]);
      repository.saveRun(queuedRun());
      expect(repository.getRun("run-1")?.status).toBe("succeeded");
    } finally { database.onModuleDestroy(); }
  });

  it("先查询到终态快照再补拉旧事件时，节点终态不回退", async () => {
    const { database, repository } = await createRepository();
    try {
      repository.saveRun({ ...queuedRun(), status: "succeeded", finishedAt: 40, nodeRuns: { node1: { nodeId: "node1", status: "succeeded", attempt: 1 } } });
      repository.saveEvent({ id: 1, runId: "run-1", at: 20, type: "node.status", nodeId: "node1", status: "running", attempt: 1 });
      expect(repository.getRun("run-1")).toMatchObject({ status: "succeeded", nodeRuns: { node1: { status: "succeeded" } } });
      expect(repository.listEvents("run-1")).toHaveLength(1);
    } finally { database.onModuleDestroy(); }
  });

  it("waiting 恢复窗口内保留技术状态，terminal retention 到期后按 run 级联清理", async () => {
    const { database, repository } = await createRepository();
    try {
      repository.saveRun({
        ...queuedRun(),
        id: "waiting-run",
        status: "waiting",
        createdAt: 1,
        waiting: {
          nodeId: "approval",
          reason: "Human approval pending",
          waiting: {
            kind: "approval",
            interruptId: "interrupt-waiting",
            approvalRequestId: "interrupt-waiting",
            deadline: 10_000,
            displayFields: [],
            decisionSchema: { type: "object" },
          },
        },
      });
      repository.saveRun({ ...queuedRun(), id: "terminal-run", status: "succeeded", createdAt: 1, finishedAt: 100 });
      repository.saveEvent({ id: 1, runId: "terminal-run", at: 100, type: "run.status", status: "succeeded" });

      expect(repository.cleanupExpired(250, 100)).toEqual(["terminal-run"]);
      expect(repository.getRun("waiting-run")).not.toBeNull();
      expect(repository.getRun("terminal-run")).toBeNull();
      expect(repository.listEvents("terminal-run")).toEqual([]);
      expect(database.database.prepare("select count(*) as total from workflow_node_runs where run_id = ?").get("terminal-run")).toEqual({ total: 0 });
    } finally {
      database.onModuleDestroy();
    }
  });
});
