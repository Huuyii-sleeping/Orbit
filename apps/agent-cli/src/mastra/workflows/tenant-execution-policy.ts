import type { WorkflowIRGraph } from "@orbit/workflow-core";
import { RuntimePortError } from "@orbit/runtime-contracts";

const isolatedNodes = new Set(["start", "end", "template", "variable", "human-approval", "iteration", "subworkflow"]);

/** 共享 SaaS 暂只执行纯数据与审批节点；模型、网络、表达式和工具须单独完成隔离。 */
export function assertTenantWorkflowIsolated(graph: WorkflowIRGraph): void {
  for (const node of graph.nodes) {
    if (!isolatedNodes.has(node.type)) {
      throw new RuntimePortError("RUNTIME_CAPABILITY_UNSUPPORTED", `SaaS Workflow 节点 ${node.type} 尚未完成执行隔离。`);
    }
    if (node.kind === "iteration") assertTenantWorkflowIsolated(node.body);
    if (node.kind === "subworkflow") assertTenantWorkflowIsolated(node.workflow);
  }
}
