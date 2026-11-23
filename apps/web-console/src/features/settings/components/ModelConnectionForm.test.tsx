import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelConnectionForm } from "./ModelConnectionForm";
import { createModelConnection, updateModelConnection } from "../../../api/model-connections";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.values[index] = value;
      },
    ];
  },
}));
vi.mock("../../../api/model-connections", () => ({
  createModelConnection: vi.fn(),
  updateModelConnection: vi.fn(),
}));
beforeEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
  vi.clearAllMocks();
});

// 通过字段 ID 找到交互入口，验证用户输入生成的实际请求。
function find(element: any, key: string, value: string): any {
  if (!element || typeof element !== "object") return;
  if (element.props?.[key] === value) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = find(child, key, value);
    if (found) return found;
  }
}

describe("模型接口格式", () => {
  it("显示接口格式选择，不要求用户填写供应商 ID", () => {
    const html = renderToStaticMarkup(
      <ModelConnectionForm onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(html).toContain("接口格式");
    for (const format of ["OpenAI 兼容", "Anthropic Messages", "Google Gemini"])
      expect(html).toContain(format);
    expect(html).not.toContain("供应商 ID");
    expect(html).toContain("连接名称（可选）");
  });

  it("编辑预填配置，密钥不回显，留空提交以保留现有密钥", async () => {
    const connection = { id: "1", reference: "connection:revision-1", name: "翻译", provider: "openai-compatible", modelId: "model-old", baseUrl: "https://example.com/v1", hasApiKey: true, createdAt: 1 };
    const onSaved = vi.fn();
    vi.mocked(updateModelConnection).mockResolvedValue({ ...connection, reference: "connection:revision-2" });
    const render = () => { hooks.cursor = 0; return ModelConnectionForm({ connection, onSaved, onCancel: vi.fn() }); };
    expect(find(render(), "id", "connection-model").props.value).toBe("model-old");
    expect(find(render(), "id", "connection-key").props.value).toBe("");
    find(render(), "id", "connection-model").props.onChange({ target: { value: "model-new" } });
    await find(render(), "data-action", "save-connection").props.onClick();
    expect(updateModelConnection).toHaveBeenCalledWith("1", { name: "翻译", provider: "openai-compatible", modelId: "model-new", baseUrl: connection.baseUrl, apiKey: undefined, reference: connection.reference, clearApiKey: false });
    expect(createModelConnection).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it.each(["openai-compatible", "anthropic", "google"])(
    "%s 仍交由 Mastra 内置供应商解析，空备注使用模型 ID",
    async (provider) => {
      const onSaved = vi.fn();
      vi.mocked(createModelConnection).mockResolvedValue({
        id: "1",
        reference: "connection:1",
        name: "my-model",
        provider,
        modelId: "my-model",
        hasApiKey: true,
        createdAt: 1,
      });
      const render = () => {
        hooks.cursor = 0;
        return ModelConnectionForm({ onSaved, onCancel: vi.fn() });
      };
      for (const [id, value] of [
        ["connection-format", provider],
        ["connection-model", "my-model"],
        ["connection-url", "https://example.com/v1"],
        ["connection-key", "test-key"],
      ]) {
        find(render(), "id", id).props.onChange({ target: { value } });
      }
      await find(render(), "data-action", "save-connection").props.onClick();
      expect(createModelConnection).toHaveBeenCalledWith({
        name: "my-model",
        provider,
        modelId: "my-model",
        baseUrl: "https://example.com/v1",
        apiKey: "test-key",
      });
      expect(onSaved).toHaveBeenCalled();
      expect(find(render(), "id", "connection-key").props.value).toBe("");
    },
  );
});
