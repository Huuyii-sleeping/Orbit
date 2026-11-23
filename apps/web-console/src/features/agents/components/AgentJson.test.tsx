import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentJsonInput, parseAgentTestInput } from "./AgentJsonInput";
import { AgentJsonResult } from "./AgentJsonResult";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
}));
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });
function find(element: any, key: string, value: string): any {
  if (!element || typeof element !== "object") return;
  if (element.props?.[key] === value) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const result = find(child, key, value);
    if (result) return result;
  }
}

describe("Agent JSON 试跑工具", () => {
  it("仅非空对象可作为试跑输入", () => {
    expect(parseAgentTestInput('{"task":"翻译"}')).toEqual({ task: "翻译" });
    for (const value of ["", "{bad", "[]", "{}", "null", "false", '"hello"']) expect(() => parseAgentTestInput(value)).toThrow();
  });
  it("格式化与压缩保留数据，非法 JSON 不覆盖输入，清空可用", () => {
    let value = '{"task":"hello","meta":{"x":1}}';
    const onChange = vi.fn((next: string) => { value = next; });
    const render = () => { hooks.cursor = 0; return AgentJsonInput({ value, onChange }); };
    find(render(), "data-action", "format").props.onClick();
    expect(value).toBe(JSON.stringify({ task: "hello", meta: { x: 1 } }, null, 2));
    find(render(), "data-action", "compact").props.onClick();
    expect(value).toBe('{"task":"hello","meta":{"x":1}}');
    value = '{"task":';
    onChange.mockClear();
    find(render(), "data-action", "format").props.onClick();
    expect(onChange).not.toHaveBeenCalled();
    expect(find(render(), "role", "alert")).toBeTruthy();
    find(render(), "data-action", "clear").props.onClick();
    expect(value).toBe("");
  });
  it("结构化结果展开多行文本、嵌套对象和数组，保留假值并转义 HTML", () => {
    const html = renderToStaticMarkup(<AgentJsonResult value={{ text: "第一行\n第二行", nested: { list: [false, 0, null, "<script>bad</script>"] } }} />);
    expect(html).toContain("第一行\n第二行");
    for (const value of ["text", "nested", "list", "false", "0", "null", "&lt;script&gt;"]) expect(html).toContain(value);
    expect(html).toContain("原始 JSON");
    expect(html).not.toContain("<script>");
  });
  it("将 JSON 字符串解析为结构化结果，普通文本保持原样", () => {
    expect(renderToStaticMarkup(<AgentJsonResult value={'{"text":"hello\\nworld"}'} />)).toContain("hello\nworld");
    expect(renderToStaticMarkup(<AgentJsonResult value="plain text" />)).toContain("plain text");
  });
});
