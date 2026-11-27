import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MastraWorkflowRunRepository } from "../../../../src/mastra/storage/workflow-run-repository.js";
import { TENANT_WORKFLOW_QUOTAS } from "@orbit/service-auth";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

function storedRun(runId = "run-1") {
  return {
    snapshot: {
      id: runId,
      workflowId: "workflow-1",
      mode: "draft" as const,
      status: "running" as const,
      createdAt: 1,
      startedAt: 1,
      inputs: {},
      nodeRuns: {},
    },
    nativeRunId: `native-${runId}`,
    runtimeWorkflowId: "runtime-1",
    ir: {
      irVersion: 1 as const,
      schemaVersion: 2 as const,
      source: { kind: "draft" as const, workflowId: "workflow-1", revision: 1, migrated: false },
      nodes: [],
      edges: [],
      topology: { orderedNodeIds: [], entryNodeIds: [], terminalNodeIds: [], dependencies: {}, dependents: {} },
      resourceBudget: {
        limits: { maxNodes: 1, maxEdges: 1, maxEstimatedSteps: 1, maxParallelism: 1, maxRuntimeMs: 1, maxOutputBytes: 1 },
        estimate: { nodeCount: 0, edgeCount: 0, estimatedSteps: 0, maxParallelism: 0 },
      },
      dependencies: [],
    },
  };
}

describe("mastra/storage/workflow-run-repository", () => {
  it("同组织并发创建最多接受固定额度，waiting 和重启仍占额，终态释放且 issuer 隔离", async () => {
    root = await mkdtemp(path.join(tmpdir(), "orbit-tenant-run-quota-"));
    const tenant = { issuer: "issuer", tenantId: "org", subject: "alice" };
    let repository = new MastraWorkflowRunRepository({ root, persistenceEnabled: true });
    const results = await Promise.allSettled(Array.from({ length: 9 }, (_, index) => repository.create({
      ...storedRun(`quota-${index}`), tenant: { ...tenant, subject: `member-${index}` },
    })));
    const accepted = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    expect(accepted).toHaveLength(TENANT_WORKFLOW_QUOTAS.unfinishedRuns);
    expect(results.filter((result) => result.status === "rejected").map((result) => result.reason))
      .toEqual(Array.from({ length: 4 }, () => expect.objectContaining({ statusCode: 429, code: "WORKFLOW_CONCURRENCY_LIMIT" })));
    const first = accepted[0]!;
    await repository.update({ ...first, snapshot: { ...first.snapshot, status: "waiting" } });
    repository = new MastraWorkflowRunRepository({ root, persistenceEnabled: true });
    await expect(repository.create({ ...storedRun("blocked-after-restart"), tenant })).rejects.toMatchObject({ code: "WORKFLOW_CONCURRENCY_LIMIT" });
    expect(await repository.get("blocked-after-restart")).toBeNull();
    await expect(repository.create({ ...storedRun("other-issuer"), tenant: { ...tenant, issuer: "another" } })).resolves.toBeTruthy();
    await repository.update({ ...first, snapshot: { ...first.snapshot, status: "cancelled" } });
    await expect(repository.create({ ...storedRun("slot-reused"), tenant })).resolves.toBeTruthy();
  });

  it("全局容量约束不同组织的未完成运行，已有记录幂等读取不重复占额", async () => {
    const repository = new MastraWorkflowRunRepository({ persistenceEnabled: false });
    const records = Array.from({ length: TENANT_WORKFLOW_QUOTAS.globalUnfinishedRuns }, (_, index) => ({
      ...storedRun(`global-${index}`), tenant: { issuer: "issuer", tenantId: `org-${index}`, subject: "alice" },
    }));
    await Promise.all(records.map((record) => repository.create(record)));
    await expect(repository.create(records[0]!)).resolves.toEqual(records[0]);
    await expect(repository.create({ ...storedRun("global-blocked"), tenant: { issuer: "issuer", tenantId: "another", subject: "alice" } }))
      .rejects.toMatchObject({ statusCode: 429, code: "WORKFLOW_CAPACITY_LIMIT" });
  });

  it("审批回执扩充完整记录后也受预算限制，失败时不登记回执", async () => {
    const repository = new MastraWorkflowRunRepository({ persistenceEnabled: false });
    const current = storedRun();
    await repository.create(current);
    await expect(repository.claimInterruptDecision({ runId: current.snapshot.id, interruptId: "i",
      idempotencyKey: "x".repeat(8_388_608), decisionHash: "hash" })).rejects.toMatchObject({ code: "WORKFLOW_OUTPUT_LIMIT_EXCEEDED" });
    expect(await repository.get(current.snapshot.id)).toEqual(current);
  });

  it("拒绝过大产品 snapshot，原有运行记录仍可查询和收敛为失败", async () => {
    const repository = new MastraWorkflowRunRepository({ persistenceEnabled: false });
    const current = storedRun();
    await repository.create(current);
    await expect(repository.update({ ...current, snapshot: { ...current.snapshot, output: { text: "x".repeat(4_194_304) } } })).rejects.toMatchObject({ code: "WORKFLOW_OUTPUT_LIMIT_EXCEEDED" });
    expect(await repository.get(current.snapshot.id)).toEqual(current);
    await repository.update({ ...current, snapshot: { ...current.snapshot, status: "failed" } });
    expect(await repository.get(current.snapshot.id)).toMatchObject({ snapshot: { status: "failed" } });
  });
  it("运行的组织身份与执行 owner 在创建后不可修改", async () => {
    const repository = new MastraWorkflowRunRepository({ persistenceEnabled: false });
    const record = { ...storedRun(), ownerId: "tenant-owner", tenant: { issuer: "issuer", tenantId: "org-a", subject: "user-a" } };
    await repository.create(record);
    await expect(repository.update({ ...record, tenant: { ...record.tenant, tenantId: "org-b" } }))
      .rejects.toMatchObject({ code: "RUNTIME_TERMINAL_CONFLICT" });
    await expect(repository.update({ ...record, ownerId: "other-owner" }))
      .rejects.toMatchObject({ code: "RUNTIME_TERMINAL_CONFLICT" });
    expect(await repository.get(record.snapshot.id)).toEqual(record);
  });
  it("持久化恢复元数据并保持 Workflow 终态不可逆", async () => {
    root = await mkdtemp(path.join(tmpdir(), "orbit-mastra-workflow-runs-"));
    const repository = new MastraWorkflowRunRepository({ root });
    const running = storedRun();
    await repository.create(running);
    const completed = await repository.update({
      ...running,
      snapshot: { ...running.snapshot, status: "succeeded", finishedAt: 2 },
    });

    await expect(repository.update({
      ...completed,
      snapshot: { ...completed.snapshot, status: "failed" },
    })).resolves.toEqual(completed);
    await expect(new MastraWorkflowRunRepository({ root }).get("run-1")).resolves.toEqual(completed);
  });

  it("decision receipt 只在当前 run 内提供幂等/冲突语义，并按 TTL 清理", async () => {
    root = await mkdtemp(path.join(tmpdir(), "orbit-mastra-workflow-receipt-"));
    let now = 100;
    const repository = new MastraWorkflowRunRepository({
      root,
      now: () => now,
      decisionTtlMs: 20,
      terminalRetentionMs: 40,
    });
    const running = storedRun("receipt-run");
    await repository.create(running);

    await expect(repository.claimInterruptDecision({
      runId: "receipt-run",
      interruptId: "interrupt-1",
      idempotencyKey: "decision-1",
      decisionHash: "hash-1",
    })).resolves.toBe("claimed");
    await expect(repository.claimInterruptDecision({
      runId: "receipt-run",
      interruptId: "interrupt-1",
      idempotencyKey: "decision-1",
      decisionHash: "hash-conflict",
    })).resolves.toBe("conflict");

    const claimed = await repository.get("receipt-run");
    const completed = await repository.update({
      ...claimed!,
      snapshot: { ...claimed!.snapshot, status: "succeeded", finishedAt: now },
    });
    await expect(repository.claimInterruptDecision({
      runId: "receipt-run",
      interruptId: "interrupt-1",
      idempotencyKey: "decision-1",
      decisionHash: "hash-1",
    })).resolves.toBe("replay");

    now = 121;
    const retained = await repository.get("receipt-run");
    expect(retained).toMatchObject({ snapshot: { status: "succeeded" } });
    expect(retained).not.toHaveProperty("interruptDecision");
    now = 141;
    await expect(repository.cleanupExpired()).resolves.toEqual(["receipt-run"]);
    await expect(repository.get("receipt-run")).resolves.toBeNull();
    expect(completed.retentionExpiresAt).toBe(140);
  });

  it("waiting run 不因 decision TTL 到期被提前删除", async () => {
    root = await mkdtemp(path.join(tmpdir(), "orbit-mastra-workflow-waiting-retention-"));
    let now = 10;
    const repository = new MastraWorkflowRunRepository({ root, now: () => now, decisionTtlMs: 5, terminalRetentionMs: 5 });
    const waiting = {
      ...storedRun("waiting-run"),
      snapshot: { ...storedRun("waiting-run").snapshot, status: "waiting" as const },
    };
    await repository.create(waiting);
    await repository.claimInterruptDecision({
      runId: "waiting-run",
      interruptId: "interrupt-waiting",
      idempotencyKey: "decision-waiting",
      decisionHash: "hash-waiting",
    });
    now = 20;

    await expect(repository.cleanupExpired()).resolves.toEqual([]);
    const retained = await repository.get("waiting-run");
    expect(retained).toMatchObject({ snapshot: { status: "waiting" } });
    expect(retained).not.toHaveProperty("interruptDecision");
  });
});
