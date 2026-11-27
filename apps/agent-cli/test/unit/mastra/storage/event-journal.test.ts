import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OrbitRuntimeEventJournal } from "../../../../src/mastra/storage/event-journal.js";
import { WORKFLOW_OUTPUT_LIMITS, WorkflowOutputLimitError } from "@orbit/workflow-core";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("mastra/storage/event-journal", () => {
  it("超限事件不会落盘、通知或占用 id，重启后总字节预算仍生效并预留失败终态", async () => {
    root = await mkdtemp(path.join(tmpdir(), "orbit-journal-budget-"));
    let journal = new OrbitRuntimeEventJournal({ root, persistenceEnabled: true });
    let notified = 0;
    journal.subscribeWorkflow("budget", () => notified++);
    const oversized = { type: "node.output" as const, nodeId: "n", output: { text: "x".repeat(WORKFLOW_OUTPUT_LIMITS.eventBytes) } };
    await expect(journal.appendWorkflow("other", oversized)).rejects.toMatchObject({ code: "WORKFLOW_OUTPUT_LIMIT_EXCEEDED" });
    expect(await journal.listWorkflow("other")).toEqual([]);
    const event = { type: "node.output" as const, nodeId: "n", output: { text: "x".repeat(1_000_000) } };
    for (let i = 0; i < 4; i++) await journal.appendWorkflow("budget", event);
    expect(notified).toBe(4);
    journal = new OrbitRuntimeEventJournal({ root, persistenceEnabled: true });
    for (let i = 0; i < 4; i++) await journal.appendWorkflow("budget", event);
    await expect(journal.appendWorkflow("budget", event)).rejects.toMatchObject({ code: "WORKFLOW_OUTPUT_LIMIT_EXCEEDED" });
    const failure = new WorkflowOutputLimitError();
    const terminal = { type: "run.status" as const, status: "failed" as const, error: { code: failure.code, message: failure.message } };
    expect(await journal.appendWorkflow("budget", terminal)).toMatchObject({ id: 9, status: "failed" });
    expect(await journal.appendWorkflow("budget", terminal)).toMatchObject({ id: 9 });
    const restored = new OrbitRuntimeEventJournal({ root, persistenceEnabled: true });
    await expect(restored.appendWorkflow("budget", { type: "node.log", nodeId: "n", level: "info", message: "small" })).rejects.toMatchObject({ code: "WORKFLOW_OUTPUT_LIMIT_EXCEEDED" });
    expect((await restored.listWorkflow("budget", 8))).toMatchObject([{ id: 9, status: "failed" }]);
  });

  it("大量小事件并发写入也不能突破条数限制，固定失败事件可在额度用尽后写入", async () => {
    const journal = new OrbitRuntimeEventJournal({ persistenceEnabled: false });
    for (let i = 0; i < WORKFLOW_OUTPUT_LIMITS.journalEvents - 1; i++) await journal.appendWorkflow("count", { type: "node.log", nodeId: "n", level: "info", message: "x" });
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => journal.appendWorkflow("count", { type: "node.log", nodeId: "n", level: "info", message: "x" })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const error = new WorkflowOutputLimitError();
    expect(await journal.appendWorkflow("count", { type: "run.status", status: "failed", error: { code: error.code, message: error.message } })).toMatchObject({ id: WORKFLOW_OUTPUT_LIMITS.journalEvents + 1 });
  });
  it("allocates monotonic ids per domain/run and restores persisted events", async () => {
    root = await mkdtemp(path.join(tmpdir(), "orbit-mastra-journal-"));
    const first = new OrbitRuntimeEventJournal({ root });

    const agentFirst = await first.appendAgent("shared-run", { type: "run.status", status: "running" });
    const agentSecond = await first.appendAgent("shared-run", { type: "text.delta", delta: "hello" });
    const workflowFirst = await first.appendWorkflow("shared-run", { type: "run.status", status: "queued" });

    expect([agentFirst.id, agentSecond.id]).toEqual([1, 2]);
    expect(workflowFirst.id).toBe(1);

    const restored = new OrbitRuntimeEventJournal({ root });
    await expect(restored.listAgent("shared-run", 1)).resolves.toMatchObject([
      { id: 2, type: "text.delta", delta: "hello" },
    ]);
    await expect(restored.listWorkflow("shared-run", 0)).resolves.toMatchObject([
      { id: 1, type: "run.status", status: "queued" },
    ]);
  });

  it("notifies only subscribers in the matching domain/run", async () => {
    root = await mkdtemp(path.join(tmpdir(), "orbit-mastra-journal-"));
    const journal = new OrbitRuntimeEventJournal({ root });
    const seen: string[] = [];
    const unsubscribe = journal.subscribeAgent("agent-run", (event) => seen.push(`${event.id}:${event.type}`));

    await journal.appendWorkflow("agent-run", { type: "run.status", status: "running" });
    await journal.appendAgent("agent-run", { type: "run.status", status: "running" });
    unsubscribe();

    expect(seen).toEqual(["1:run.status"]);
  });

  it("并发 append 仍为单个 run 原子分配严格递增 event id", async () => {
    const journal = new OrbitRuntimeEventJournal({ persistenceEnabled: false });
    const events = await Promise.all(Array.from({ length: 20 }, (_item, index) => (
      journal.appendWorkflow("concurrent-run", {
        type: "node.log",
        nodeId: "node",
        level: "info",
        message: String(index),
      })
    )));

    expect(events.map((event) => event.id).sort((left, right) => left - right)).toEqual(
      Array.from({ length: 20 }, (_item, index) => index + 1),
    );
    await expect(journal.listWorkflow("concurrent-run")).resolves.toHaveLength(20);
  });

  it("实例事件在并发写入和游标回放时保持严格递增产品 id", async () => {
    const journal = new OrbitRuntimeEventJournal({ persistenceEnabled: false });
    await Promise.all(Array.from({ length: 6 }, (_item, index) => (
      journal.appendWorkflow("instance-run", {
        type: "node.status",
        nodeId: "iteration-1",
        status: "succeeded",
        attempt: 1,
        containerId: "iteration-1",
        instanceId: `instance-${index}`,
        iterationIndex: index,
        executionPath: ["iteration-1", String(index)],
      })
    )));

    const events = await journal.listWorkflow("instance-run", 2);
    expect(events.map((event) => event.id)).toEqual([3, 4, 5, 6]);
    expect(events.every((event) => event.type === "node.status" && event.instanceId !== undefined)).toBe(true);
  });

  it("存储暂时不可用时明确失败，恢复后不占用或跳过产品 event id", async () => {
    root = path.join(tmpdir(), `orbit-mastra-journal-blocked-${Date.now()}`);
    await writeFile(root, "blocked", "utf8");
    const journal = new OrbitRuntimeEventJournal({ root, persistenceEnabled: true });

    await expect(journal.appendAgent("storage-run", {
      type: "run.status",
      status: "running",
    })).rejects.toThrow();

    await rm(root, { force: true });
    await mkdir(root, { recursive: true });
    const recovered = await journal.appendAgent("storage-run", {
      type: "run.status",
      status: "running",
    });

    expect(recovered.id).toBe(1);
    await expect(journal.listAgent("storage-run")).resolves.toEqual([recovered]);
  });
});
