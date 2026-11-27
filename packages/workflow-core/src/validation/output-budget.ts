import { assertWorkflowJsonBudget, WorkflowResourceLimitError } from "./json-budget.js";

/** Workflow 执行数据的服务端硬上限，单位为 UTF-8 JSON 字节；不接受请求覆盖。 */
export const WORKFLOW_OUTPUT_LIMITS = Object.freeze({
  nodeBytes: 1_048_576,
  frameBytes: 2_097_152,
  snapshotBytes: 4_194_304,
  recordBytes: 8_388_608,
  nativeSnapshotBytes: 8_388_608,
  eventBytes: 1_114_112,
  journalBytes: 8_388_608,
  journalEvents: 10_000,
  streamBytes: 1_048_576,
});

/** 资源耗尽属于运行失败，不能通过业务错误 fallback 或重试继续扩大执行。 */
export class WorkflowOutputLimitError extends Error {
  readonly code = "WORKFLOW_OUTPUT_LIMIT_EXCEEDED";
  constructor() {
    super("Workflow 输出或执行状态超过资源上限。");
    this.name = "WorkflowOutputLimitError";
  }
}

/** 检查输出的 JSON 规模和可序列化性；错误只返回固定消息，不携带输出内容。 */
export function assertWorkflowOutputBudget(value: unknown, maxBytes: number): number {
  try { return assertWorkflowJsonBudget(value, maxBytes); }
  catch (error) {
    if (error instanceof WorkflowResourceLimitError) throw new WorkflowOutputLimitError();
    throw error;
  }
}

/** 兼容 Mastra 序列化后的错误对象，维持资源错误不可恢复的语义。 */
export function isWorkflowOutputLimitError(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    if ("code" in current && current.code === "WORKFLOW_OUTPUT_LIMIT_EXCEEDED") return true;
    if ("message" in current && typeof current.message === "string" && current.message.includes("ORBIT_WORKFLOW_SNAPSHOT_LIMIT")) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
