import { describe, expect, it, vi } from "vitest";
import { assertWorkflowDefinitionBudget, assertWorkflowJsonBudget, builtinNodeRegistry, compileWorkflow, type WorkflowDraft } from "../../../src/index.js";

function draft(): WorkflowDraft {
  return { schemaVersion: 2, id: "budget", name: "budget", summary: "", revision: 0,
    createdAt: 1, updatedAt: 1, nodes: [], edges: [] };
}

describe("递归处理前的 Workflow 资源边界", () => {
  it("在编译和依赖解析前拒绝超限定义，包括 UTF-8 多字节内容", () => {
    const resolvePublishedVersion = vi.fn();
    const result = compileWorkflow({ ...draft(), metadata: { text: "中".repeat(400_000) } }, {
      workflowVersions: { resolvePublishedVersion },
    });
    expect(result).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "workflow.json-size-limit" })] });
    expect(resolvePublishedVersion).not.toHaveBeenCalled();
  });

  it("超深容器在递归校验前返回诊断，不能触发调用栈溢出", () => {
    let body: unknown = { nodes: [], edges: [], inputs: [], outputs: [] };
    for (let i = 0; i < 1_000; i++) body = { nodes: [{ kind: "builtin", id: `iteration-${i}`, type: "iteration", config: { body } }], edges: [] };
    const result = compileWorkflow({ ...draft(), ...(body as object) });
    expect(result).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "workflow.json-depth-limit" })] });
  });

  it("计算精确 UTF-8 JSON 大小，边界值可用，超出一字节即拒绝", () => {
    const value = { text: "中😀\n\"\\", list: [null, 123, true], omitted: undefined };
    const size = new TextEncoder().encode(JSON.stringify(value)).length;
    expect(assertWorkflowJsonBudget(value, size)).toBe(size);
    expect(() => assertWorkflowJsonBudget(value, size - 1)).toThrowError(expect.objectContaining({ statusCode: 413 }));
    expect(() => assertWorkflowJsonBudget({ list: new Array(2) }, 100)).toThrowError(expect.objectContaining({ statusCode: 400 }));
    expect(() => assertWorkflowJsonBudget({ number: NaN }, 100)).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });

  it("循环 JSON 和大量小元素也被拒绝，重复的非循环对象仍有效", () => {
    const child = { value: "shared" };
    expect(() => assertWorkflowJsonBudget([child, child], 100)).not.toThrow();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => assertWorkflowJsonBudget(cycle, 100)).toThrowError(expect.objectContaining({ diagnosticCode: "workflow.json-invalid" }));
    expect(() => assertWorkflowJsonBudget(new Array(100_001).fill(0), 1_048_576)).toThrowError(expect.objectContaining({ diagnosticCode: "workflow.json-value-limit" }));
  });

  it("容器内节点、深度和乘积执行步数一并计入预算", () => {
    const definition = builtinNodeRegistry.get("iteration")!;
    const config = definition.createDefaultConfig();
    config.maxItems = 100;
    const container = { kind: "builtin", type: "iteration", id: "iteration", config };
    const source = { ...draft(), nodes: [container] };
    expect(() => assertWorkflowDefinitionBudget(source)).not.toThrow();
    config.body.nodes = Array.from({ length: 200 }, (_, i) => ({ ...config.body.nodes[0]!, id: String(i) }));
    expect(() => assertWorkflowDefinitionBudget(source)).toThrowError(expect.objectContaining({ diagnosticCode: "compile.node-limit" }));
    config.body.nodes = config.body.nodes.slice(0, 11);
    expect(() => assertWorkflowDefinitionBudget(source)).toThrowError(expect.objectContaining({ diagnosticCode: "compile.step-limit" }));
    config.maxItems = 1;
    let graph: unknown = { nodes: [], edges: [] };
    for (let i = 0; i < 6; i++) graph = { nodes: [{ ...container, config: { ...config, body: graph } }], edges: [] };
    expect(() => assertWorkflowDefinitionBudget(graph)).toThrowError(expect.objectContaining({ diagnosticCode: "compile.nested-depth-limit" }));
    config.maxItems = 1_001;
    expect(() => assertWorkflowDefinitionBudget(source)).toThrowError(expect.objectContaining({ diagnosticCode: "workflow.iteration-limit" }));
    config.maxItems = 1;
    config.maxConcurrency = 11;
    expect(() => assertWorkflowDefinitionBudget(source)).toThrowError(expect.objectContaining({ diagnosticCode: "compile.parallelism-limit" }));
  });

  it("依赖按每次展开计数，并在递归深度和总定义大小达到上限时停止解析", () => {
    const definition = builtinNodeRegistry.get("subworkflow")!;
    const config = { ...definition.createDefaultConfig(), workflowId: "child", versionId: "v1" };
    const reference = { kind: "builtin", type: "subworkflow", id: "child", config };
    const source = { ...draft(), nodes: [reference] };
    const child = { ...source, workflowId: "child", version: 1, contentHash: "hash", createdBy: "test" };
    const resolvePublishedVersion = vi.fn(() => child);
    expect(() => assertWorkflowDefinitionBudget(source, { workflowVersions: { resolvePublishedVersion } })).toThrowError(expect.objectContaining({ diagnosticCode: "compile.nested-depth-limit" }));
    expect(resolvePublishedVersion).toHaveBeenCalledTimes(6);
    const heavy = { ...child, nodes: [], metadata: { text: "x".repeat(750_000) } };
    const repeated = { ...source, nodes: [reference, { ...reference, id: "second" }, { ...reference, id: "third" }] };
    expect(() => assertWorkflowDefinitionBudget(repeated, { workflowVersions: { resolvePublishedVersion: () => heavy } })).toThrowError(expect.objectContaining({ statusCode: 413 }));
  });
});
