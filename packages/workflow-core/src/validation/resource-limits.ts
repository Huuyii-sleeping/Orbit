import { DEFAULT_WORKFLOW_EXECUTION_LIMITS, type WorkflowExecutionLimits } from "../compiler/contracts.js";
import type { WorkflowVersionResolver } from "../contracts/references.js";
import { assertWorkflowJsonBudget, WORKFLOW_PAYLOAD_LIMITS, WorkflowResourceLimitError } from "./json-budget.js";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkflowResourceLimitError("workflow.graph-invalid", "Workflow 图或节点结构无效。", 400);
  return value as Record<string, unknown>;
}

/** 在归一化/依赖递归前检查展开后的总规模；草稿可以未完成，但不能无界嵌套或执行。 */
export function assertWorkflowDefinitionBudget(value: unknown, options: {
  workflowVersions?: WorkflowVersionResolver;
  limits?: Partial<WorkflowExecutionLimits>;
} = {}): void {
  const limits = { ...DEFAULT_WORKFLOW_EXECUTION_LIMITS, ...options.limits };
  const stack = [{ graph: value, depth: 0, multiplier: 1, definition: true }];
  let nodes = 0, edges = 0, steps = 0;
  let definitionBytes = 0;
  const fail = (code: string, label: string, limit: number) => {
    throw new WorkflowResourceLimitError(code, `${label}超过上限 ${limit}。`);
  };
  while (stack.length > 0) {
    const { graph, depth, multiplier, definition } = stack.pop()!;
    if (depth > limits.maxNestedDepth) fail("compile.nested-depth-limit", "Workflow 嵌套深度", limits.maxNestedDepth);
    if (definition) {
      definitionBytes += assertWorkflowJsonBudget(graph, WORKFLOW_PAYLOAD_LIMITS.definitionBytes);
      if (definitionBytes > WORKFLOW_PAYLOAD_LIMITS.commandBytes) throw new WorkflowResourceLimitError("workflow.json-size-limit", "展开的 Workflow 定义总大小超过上限。", 413);
    }
    const current = record(graph);
    if (!Array.isArray(current.nodes) || !Array.isArray(current.edges)) throw new WorkflowResourceLimitError("workflow.graph-invalid", "Workflow 必须包含 nodes 和 edges 数组。", 400);
    nodes += current.nodes.length;
    edges += current.edges.length;
    steps += current.nodes.length * multiplier;
    if (nodes > limits.maxNodes) fail("compile.node-limit", "递归节点数", limits.maxNodes);
    if (edges > limits.maxEdges) fail("compile.edge-limit", "递归连边数", limits.maxEdges);
    if (steps > limits.maxEstimatedSteps) fail("compile.step-limit", "预计执行步数", limits.maxEstimatedSteps);
    for (const value of current.nodes) {
      const node = record(value);
      if (node.kind !== "builtin") continue;
      if (node.type === "iteration" || node.type === "loop") {
        const config = record(node.config);
        const count = node.type === "iteration" ? config.maxItems : config.maxIterations;
        const limit = node.type === "iteration" ? limits.maxIterationItems : limits.maxLoopIterations;
        if (!Number.isSafeInteger(count) || Number(count) < 1 || Number(count) > limit) fail("workflow.iteration-limit", "容器迭代数量", limit);
        if (node.type === "iteration" && (!Number.isSafeInteger(config.maxConcurrency) || Number(config.maxConcurrency) < 1 || Number(config.maxConcurrency) > limits.maxParallelism)) fail("compile.parallelism-limit", "迭代并发", limits.maxParallelism);
        stack.push({ graph: config.body, depth: depth + 1, multiplier: multiplier * Number(count), definition: false });
      }
      if (node.type === "subworkflow" && options.workflowVersions) {
        const config = record(node.config);
        const dependency = options.workflowVersions.resolvePublishedVersion(String(config.workflowId), String(config.versionId));
        if (dependency) stack.push({ graph: dependency, depth: depth + 1, multiplier, definition: true });
      }
    }
  }
}
