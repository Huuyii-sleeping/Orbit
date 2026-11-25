import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWorkbench } from "./AgentWorkbench";

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, workbench: {} as any }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (next: unknown) => { state.values[index] = next; }];
  },
}));
vi.mock("../hooks/use-agent-workbench", () => ({ useAgentWorkbench: () => state.workbench }));
function find(node: any, predicate: (item: any) => boolean): any {
  if (!node || typeof node !== "object") return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
const render = (dirty = false, view: "test" | "versions" = "test") => {
  state.cursor = 0;
  return AgentWorkbench({ agentId: "a", view, dirty, disabled: false, onTestStatus: vi.fn() });
};
beforeEach(() => {
  state.values = []; state.cursor = 0;
  state.workbench = { versions: [], history: [], current: null, logs: [], test: vi.fn(), publish: vi.fn(), setError: vi.fn() };
});
describe("Agent 试跑入口", () => {
  it("初始任务为空，未填写真实输入时不会发起试跑", () => {
    const tree = render();
    const input = find(tree, (item) => item.type?.name === "AgentJsonInput");
    expect(input.props.value).toBe("");
    find(tree, (item) => item.type === "button" && item.props.children === "开始试跑").props.onClick();
    expect(state.workbench.test).not.toHaveBeenCalled();
    expect(state.workbench.setError).toHaveBeenCalled();
  });
  it("未保存草稿不可测试，切换页签保留输入；固定版本不受草稿修改阻止", () => {
    find(render(), (item) => item.type?.name === "AgentJsonInput").props.onChange('{"source":"Hello"}');
    expect(find(render(true), (item) => item.type === "button" && item.props.children === "开始试跑").props.disabled).toBe(true);
    render(false, "versions");
    expect(find(render(), (item) => item.type?.name === "AgentJsonInput").props.value).toBe('{"source":"Hello"}');
    find(render(), (item) => item.props?.id === "agent-test-version").props.onChange({ target: { value: "v1" } });
    const button = find(render(true), (item) => item.type === "button" && item.props.children === "开始试跑");
    expect(button.props.disabled).toBe(false);
    button.props.onClick();
    expect(state.workbench.test).toHaveBeenCalledWith({ source: "Hello" }, "v1");
  });
});
