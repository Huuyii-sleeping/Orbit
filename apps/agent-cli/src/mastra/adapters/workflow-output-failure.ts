import { WorkflowOutputLimitError, type WorkflowRunSnapshot } from "@orbit/workflow-core";

/** 资源失败保留运行身份和最小节点状态，丢弃输出投影，避免再次存储超限数据。 */
export function workflowOutputFailure(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
  const failure = new WorkflowOutputLimitError();
  const now = Date.now();
  return {
    ...snapshot,
    status: "failed", finishedAt: now, output: undefined, waiting: undefined,
    nodeInstances: undefined, childRuns: undefined,
    error: { code: failure.code, message: failure.message },
    nodeRuns: Object.fromEntries(Object.entries(snapshot.nodeRuns).map(([id, node]) => [id, {
      nodeId: node.nodeId, status: node.status === "succeeded" ? "succeeded" : "failed", attempt: node.attempt,
      startedAt: node.startedAt, finishedAt: node.finishedAt ?? now,
    }])),
  };
}
