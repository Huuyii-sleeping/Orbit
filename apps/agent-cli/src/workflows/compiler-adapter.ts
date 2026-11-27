import { compileWorkflow, WorkflowResourceLimitError, type CompileWorkflowOptions, type WorkflowIR } from "@orbit/workflow-core";

/** Agent runtime 的共享编译器薄适配；不复制编译规则。 */
export function compileWorkflowForRuntime(value: unknown, options: CompileWorkflowOptions = {}): WorkflowIR {
  const result = compileWorkflow(value, options);
  if (!result.ok) {
    const message = result.diagnostics.map((item) => `[${item.code}] ${item.message}`).join("\n");
    const budget = result.diagnostics.find((item) => /^(workflow\.(json-|graph-invalid|iteration-limit)|compile\.(node|edge|step|nested-depth|parallelism)-limit)/.test(item.code));
    if (budget) throw new WorkflowResourceLimitError(budget.code, `工作流编译失败：\n${message}`, budget.code === "workflow.json-size-limit" ? 413 : budget.code.endsWith("invalid") ? 400 : 422);
    throw new Error(`工作流编译失败：\n${message}`);
  }
  return result.ir;
}
