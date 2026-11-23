import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelCatalog } from "../../../../src/mastra/models/model-catalog.js";

describe("models/model-catalog", () => {
  it("未配置默认模型时明确要求选择连接，不请求占位模型", () => {
    expect(() => new ModelCatalog({ env: {} }).resolve("unset-model")).toThrow("请选择模型连接");
  });
  it("兼容旧裸模型 ID，供应商前缀隔离地址和凭据，模型路径中的斜线保持完整", () => {
    const catalog = new ModelCatalog({
      env: {
        OPENAI_API_KEY: "legacy-secret",
        OPENAI_BASEURL: "https://legacy.example/v1",
        ANTHROPIC_API_KEY: "claude-secret",
      },
    });
    expect(catalog.resolve("qwen-plus")).toMatchObject({
      modelId: "qwen-plus",
      config: { url: "https://legacy.example/v1" },
      apiKey: "legacy-secret",
    });
    expect(catalog.resolve("anthropic/claude-test")).toMatchObject({
      modelId: "claude-test",
      apiKey: "claude-secret",
    });
    expect(catalog.resolve("default/org/model-name").modelId).toBe("org/model-name");
    expect(() => catalog.resolve("missing/model")).toThrow("未知模型供应商");
  });

  it("加载多供应商和模型别名，不把非 OpenAI 请求发到旧的 OpenAI 地址", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-model-config-"));
    const file = join(root, "models.json");
    try {
      writeFileSync(
        file,
        JSON.stringify({
          providers: {
            qwen: {
              provider: "openai-compatible",
              baseUrl: "https://qwen.example/v1",
              apiKeyEnv: "QWEN_TEST_KEY",
            },
            local: { provider: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1" },
          },
          models: {
            writer: {
              provider: "qwen",
              modelId: "qwen-plus",
              supportsTools: false,
              supportsTemperature: false,
              providerOptions: { openaiCompatible: { enable_thinking: false } },
            },
          },
        }),
      );
      const catalog = new ModelCatalog({
        env: { MODEL_CONFIG_FILE: file, MODEL_PROVIDER: "qwen", QWEN_TEST_KEY: "qwen-secret" },
      });
      expect(catalog.resolve("qwen-plus")).toMatchObject({
        connectionId: "qwen",
        providerId: "openai-compatible",
        apiKey: "qwen-secret",
      });
      expect(catalog.resolve("writer")).toMatchObject({
        modelId: "qwen-plus",
        supportsTools: false,
        supportsTemperature: false,
      });
      expect(catalog.resolve("local/test").apiKey).toBeUndefined();
      expect(() => catalog.resolve("writer", { tools: true })).toThrow("不支持工具调用");
      expect(() => catalog.resolve("writer", { temperature: true })).toThrow("不支持 temperature");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("错误配置和缺少凭据在请求前失败，错误信息不包含凭据", () => {
    expect(() => new ModelCatalog({ env: {} }).resolve("anthropic/test")).toThrow(
      "ANTHROPIC_API_KEY",
    );
    expect(
      () =>
        new ModelCatalog({
          env: {},
          config: { providers: { x: { protocol: "unsupported", apiKey: "do-not-expose" } } },
        }),
    ).toThrow("模型配置格式无效");
    expect(
      () =>
        new ModelCatalog({
          env: {},
          config: {
            providers: { x: { provider: "openai-compatible", baseUrl: "file:///tmp/model" } },
          },
        }),
    ).toThrow("模型配置格式无效");
    expect(
      () =>
        new ModelCatalog({
          env: {},
          config: { models: { broken: { provider: "absent", modelId: "x" } } },
        }),
    ).toThrow("未知模型供应商");
  });
});
