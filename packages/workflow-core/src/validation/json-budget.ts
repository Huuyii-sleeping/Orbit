/** 运行命令、定义和数据的固定上限；调用方不能通过请求覆盖。 */
export const WORKFLOW_PAYLOAD_LIMITS = Object.freeze({
  commandBytes: 2_097_152,
  definitionBytes: 1_048_576,
  inputBytes: 262_144,
  jsonDepth: 64,
  jsonValues: 100_000,
});

/** 输入资源错误可由 HTTP 适配层直接映射，不携带原始输入。 */
export class WorkflowResourceLimitError extends Error {
  readonly code = "WORKFLOW_RESOURCE_LIMIT";
  constructor(readonly diagnosticCode: string, message: string, readonly statusCode = 422) {
    super(message);
    this.name = "WorkflowResourceLimitError";
  }
}

/** 在任何递归序列化、校验或克隆前，以有界迭代遍历验证 JSON 深度、规模和 UTF-8 字节数。 */
export function assertWorkflowJsonBudget(value: unknown, maxBytes: number): number {
  const encoder = new TextEncoder();
  const ancestors = new Set<object>();
  const stack: Array<{ value: unknown; depth: number; exit?: boolean }> = [{ value, depth: 0 }];
  let bytes = 0;
  let values = 0;
  const add = (size: number) => {
    bytes += size;
    if (bytes > maxBytes) throw new WorkflowResourceLimitError("workflow.json-size-limit", `JSON 内容超过 ${maxBytes} 字节。`, 413);
  };
  const stringBytes = (text: string) => {
    // UTF-8 JSON 字符串至少占 text.length + 2 字节，先挡住明显超限值，避免分配巨型转义字符串。
    if (text.length + 2 > maxBytes - bytes) add(maxBytes + 1);
    return encoder.encode(JSON.stringify(text)).byteLength;
  };
  while (stack.length > 0) {
    const current = stack.pop()!;
    const item = current.value;
    if (current.exit) { ancestors.delete(item as object); continue; }
    if (++values > WORKFLOW_PAYLOAD_LIMITS.jsonValues) throw new WorkflowResourceLimitError("workflow.json-value-limit", "JSON 元素数量超过上限。");
    if (current.depth > WORKFLOW_PAYLOAD_LIMITS.jsonDepth) throw new WorkflowResourceLimitError("workflow.json-depth-limit", `JSON 嵌套深度超过 ${WORKFLOW_PAYLOAD_LIMITS.jsonDepth}。`);
    if (item === null) { add(4); continue; }
    if (typeof item === "string") { add(stringBytes(item)); continue; }
    if (typeof item === "boolean") { add(item ? 4 : 5); continue; }
    if (typeof item === "number" && Number.isFinite(item)) { add(String(item).length); continue; }
    if (!item || typeof item !== "object" || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) {
      throw new WorkflowResourceLimitError("workflow.json-invalid", "输入必须是可序列化的 JSON 数据。", 400);
    }
    if (ancestors.has(item)) throw new WorkflowResourceLimitError("workflow.json-invalid", "JSON 数据不能包含循环引用。", 400);
    ancestors.add(item);
    stack.push({ value: item, depth: current.depth, exit: true });
    const entries = Array.isArray(item) ? Array.from(item, (child, index) => [String(index), child] as const)
      : Object.entries(item).filter(([, child]) => child !== undefined);
    if (entries.length + stack.length > WORKFLOW_PAYLOAD_LIMITS.jsonValues) throw new WorkflowResourceLimitError("workflow.json-value-limit", "JSON 元素数量超过上限。");
    add(2 + Math.max(0, entries.length - 1));
    for (const [key, child] of entries) {
      if (!Array.isArray(item)) add(stringBytes(key) + 1);
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return bytes;
}

/** 运行输入和审批数据只能是 JSON 对象；省略时由调用方使用空对象。 */
export function assertWorkflowInputBudget(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkflowResourceLimitError("workflow.input-invalid", "运行输入必须是 JSON 对象。", 400);
  assertWorkflowJsonBudget(value, WORKFLOW_PAYLOAD_LIMITS.inputBytes);
}
