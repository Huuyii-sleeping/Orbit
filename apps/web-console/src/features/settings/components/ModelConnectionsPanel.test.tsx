import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelConnectionsPanel } from "./ModelConnectionsPanel";
import { deleteModelConnection, fetchModelConnections, restoreModelConnection } from "../../../api/model-connections";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
}));
vi.mock("../../../api/model-connections", () => ({
  deleteModelConnection: vi.fn(), fetchModelConnections: vi.fn(), restoreModelConnection: vi.fn(),
}));

// 模拟页面重绘，验证真实事件处理链与 API 参数。
function find(element: any, key: string, value: string): any {
  if (!element || typeof element !== "object") return;
  if (element.props?.[key] === value) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = find(child, key, value);
    if (found) return found;
  }
}
const connection = { id: "qa", reference: "connection:qa", name: "QA", provider: "openai-compatible", modelId: "qa", createdAt: 1, hasApiKey: false };
const catalog = { connections: [connection], deletedConnections: [], configuredModels: [], defaultModel: "" };
const hidden = { ...catalog, connections: [], deletedConnections: [{ ...connection, deletedAt: 2 }] };
const render = () => { hooks.cursor = 0; return ModelConnectionsPanel(); };
const button = (text: string) => find(render(), "children", text);

beforeEach(() => {
  hooks.values = [catalog]; hooks.cursor = 0;
  vi.clearAllMocks();
  vi.mocked(fetchModelConnections).mockResolvedValue(catalog);
});

describe("模型配置删除", () => {
  it("先确认、可取消，确认后提交准确引用并刷新；可恢复", async () => {
    find(render(), "aria-label", "删除模型 QA").props.onClick();
    expect(deleteModelConnection).not.toHaveBeenCalled();
    expect(find(render(), "aria-label", "确认删除 QA")).toBeDefined();
    button("取消").props.onClick();
    expect(find(render(), "aria-label", "确认删除 QA")).toBeUndefined();
    find(render(), "aria-label", "删除模型 QA").props.onClick();
    vi.mocked(fetchModelConnections).mockResolvedValueOnce(hidden);
    await button("确认删除").props.onClick();
    expect(deleteModelConnection).toHaveBeenCalledWith("qa", { reference: "connection:qa" });
    expect(find(render(), "aria-label", "删除模型 QA")).toBeUndefined();
    await find(render(), "aria-label", "恢复模型 QA").props.onClick();
    expect(restoreModelConnection).toHaveBeenCalledWith("qa", { reference: "connection:qa" });
    expect(find(render(), "aria-label", "删除模型 QA")).toBeDefined();
  });

  it("删除失败保留配置并显示错误，处理中禁止重复操作", async () => {
    let reject!: (cause: Error) => void;
    vi.mocked(deleteModelConnection).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    find(render(), "aria-label", "删除模型 QA").props.onClick();
    const pending = button("确认删除").props.onClick();
    expect(find(render(), "aria-label", "编辑模型 QA").props.disabled).toBe(true);
    await button("处理中…").props.onClick();
    expect(deleteModelConnection).toHaveBeenCalledTimes(1);
    reject(new Error("模型配置已被修改"));
    await pending;
    expect(find(render(), "role", "alert").props.children).toBe("模型配置已被修改");
    expect(button("确认删除").props.disabled).toBe(false);
    expect(find(render(), "aria-label", "删除模型 QA")).toBeDefined();
    expect(fetchModelConnections).not.toHaveBeenCalled();
  });
});
