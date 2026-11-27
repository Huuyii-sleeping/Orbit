import { createClient } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TABLE_WORKFLOW_SNAPSHOT } from "@mastra/core/storage";
import { getOrCreateMastraRuntime, shutdownMastraRuntime } from "../../../../src/mastra/instance/factory.js";
import { isWorkflowOutputLimitError, WORKFLOW_OUTPUT_LIMITS } from "@orbit/workflow-core";

let root = "";
afterEach(async () => {
  if (root) { await shutdownMastraRuntime({ root, persistenceEnabled: true }); await rm(root, { recursive: true, force: true }); }
  root = "";
});

describe("Mastra snapshot 数据库硬限制", () => {
  it("真实 LibSQL 拒绝超限 insert 和 JSONB merge，原 snapshot 保留且重启后仍生效", async () => {
    root = await mkdtemp(path.join(tmpdir(), "orbit-snapshot-budget-"));
    let runtime = await getOrCreateMastraRuntime({ root, persistenceEnabled: true });
    const snapshot = { runId: "native", status: "running", context: {}, value: {}, timestamp: 1,
      activePaths: [], suspendedPaths: {}, activeStepsPath: {}, resumeLabels: {}, waitingPaths: {}, serializedStepGraph: [] };
    const workflows = await runtime.storage.getStore("workflows");
    if (!workflows) throw new Error("missing workflow store");
    const oversized = { ...snapshot, context: { text: "中".repeat(Math.ceil(WORKFLOW_OUTPUT_LIMITS.nativeSnapshotBytes / 3)) } };
    await expect(workflows.persistWorkflowSnapshot({ workflowName: "budget", runId: "large", snapshot: oversized as never })).rejects.toSatisfy(isWorkflowOutputLimitError);
    expect(await workflows.loadWorkflowSnapshot({ workflowName: "budget", runId: "large" })).toBeNull();
    await workflows.persistWorkflowSnapshot({ workflowName: "budget", runId: "native", snapshot: snapshot as never });
    const client = createClient({ url: runtime.paths.databaseUrl });
    try {
      // 与 Mastra 原子 merge 相同：更新的是 JSONB snapshot，不能按压缩后的 BLOB 长度判断。
      await expect(client.execute({ sql: `update ${TABLE_WORKFLOW_SNAPSHOT} set snapshot = jsonb_set(snapshot, '$.context.text', ?) where workflow_name = 'budget' and run_id = 'native'`, args: [oversized.context.text] })).rejects.toSatisfy(isWorkflowOutputLimitError);
    } finally { client.close(); }
    expect(await workflows.loadWorkflowSnapshot({ workflowName: "budget", runId: "native" })).toMatchObject({ context: {} });
    await shutdownMastraRuntime({ root, persistenceEnabled: true });
    runtime = await getOrCreateMastraRuntime({ root, persistenceEnabled: true });
    const restored = await runtime.storage.getStore("workflows");
    expect(await restored!.loadWorkflowSnapshot({ workflowName: "budget", runId: "native" })).toMatchObject({ context: {} });
    await expect(restored!.persistWorkflowSnapshot({ workflowName: "budget", runId: "native", snapshot: oversized as never })).rejects.toSatisfy(isWorkflowOutputLimitError);
  });
});
