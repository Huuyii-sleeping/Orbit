import { builtinNodeRegistry, type WorkflowIRGraph } from "@orbit/workflow-core";
import { describe, expect, it } from "vitest";
import { assertTenantWorkflowIsolated } from "../../../../src/mastra/workflows/tenant-execution-policy.js";

const graph: WorkflowIRGraph = {
  nodes: [{
    kind: "executable", id: "start", type: "start", nodeVersion: 1, label: "start", disabled: false,
    config: { inputs: [] }, ports: { inputs: [], outputs: [] }, executor: { id: "workflow.start", version: 1 },
    execution: { timeoutMs: 1000, maxAttempts: 1, retryBackoffMs: 0, idempotent: true, onError: "fail" },
  }],
  edges: [], topology: { orderedNodeIds: ["start"], entryNodeIds: ["start"], terminalNodeIds: ["start"], dependencies: {}, dependents: {} },
};
const codeGraph: WorkflowIRGraph = { ...graph, nodes: [{
  ...graph.nodes[0], kind: "executable", type: "code", config: builtinNodeRegistry.get("code")!.createDefaultConfig(),
}] };

describe("共享租户执行策略", () => {
  it("允许纯数据节点，但拒绝代码和藏在容器内的未隔离节点", () => {
    expect(() => assertTenantWorkflowIsolated(graph)).not.toThrow();
    expect(() => assertTenantWorkflowIsolated(codeGraph)).toThrow(/code/);
    const iteration: WorkflowIRGraph = { ...graph, nodes: [{
      ...graph.nodes[0], kind: "iteration", type: "iteration",
      config: builtinNodeRegistry.get("iteration")!.createDefaultConfig(), body: codeGraph,
    }] };
    expect(() => assertTenantWorkflowIsolated(iteration)).toThrow(/code/);
    const subworkflow: WorkflowIRGraph = { ...graph, nodes: [{
      ...graph.nodes[0], kind: "subworkflow", type: "subworkflow",
      config: builtinNodeRegistry.get("subworkflow")!.createDefaultConfig(), workflow: codeGraph,
      dependency: { workflowId: "child", versionId: "v1", version: 1, contentHash: "hash" },
    }] };
    expect(() => assertTenantWorkflowIsolated(subworkflow)).toThrow(/code/);
  });
});
