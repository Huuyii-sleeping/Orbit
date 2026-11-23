import { describe, expect, it, vi } from "vitest";
import { AgentList } from "./AgentList";
import { defaultAgentProfileInput } from "../../../api/agents";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useState: (value: unknown) => [value, vi.fn()] }));
function find(element: any, predicate: (element: any) => boolean): any {
  if (!element || typeof element !== "object") return;
  if (predicate(element)) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
}

describe("Agent 列表导航", () => {
  it("点击行的空白或普通单元格进入配置，按钮只触发一次且保留键盘入口", () => {
    const agent = { ...defaultAgentProfileInput, id: "agent-1", name: "翻译", createdAt: 1, updatedAt: 1 };
    const onOpen = vi.fn();
    const tree = AgentList({ active: true, agents: [agent], query: "", sessions: [], installedSkills: [], error: null, onOpen, onRefresh: vi.fn(), onNewAgent: vi.fn(), onClearQuery: vi.fn() });
    const row = find(tree, (element) => element.type === "tr" && element.key === "agent-1");
    expect(row.props.onClick).toBeTypeOf("function");
    row.props.onClick();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith(agent);
    const button = find(row, (element) => element.type === "button" && element.props["aria-label"] === "编辑 翻译");
    const stopPropagation = vi.fn();
    onOpen.mockClear();
    button.props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith(agent);
    expect(renderToStaticMarkup(tree)).toContain('class="agent-row-name"');
  });
});
