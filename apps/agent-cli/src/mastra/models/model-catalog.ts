import { z } from "zod";
import { getProviderConfig, type ProviderConfig } from "@mastra/core/llm";
import { loadModelConfig } from "../../config/model-config.js";
import { ModelConnectionStore, ModelConnectionError, parseModelConnection } from "../../services/model-connection-store.js";

/** 将模型引用映射到 Mastra 注册的供应商；仅保留 Orbit 连接、别名和能力约束。 */
export class ModelCatalog {
  private readonly env: NodeJS.ProcessEnv;
  private readonly settings: ReturnType<typeof loadModelConfig>;
  private readonly connections: ModelConnectionStore;

  constructor(options: { env?: NodeJS.ProcessEnv; config?: unknown; connections?: ModelConnectionStore } = {}) {
    this.env = options.env ?? process.env;
    this.settings = loadModelConfig(this.env, options.config);
    this.connections = options.connections ?? new ModelConnectionStore();
    for (const [id, connection] of Object.entries(this.settings.providers)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`模型供应商配置无效：${id}`);
      this.providerConfig(connection.provider, connection.baseUrl);
    }
    for (const [id, model] of Object.entries(this.settings.models)) {
      if (id.includes("/")) throw new Error("模型别名不能包含 /。");
      this.connectionConfig(model.provider);
    }
  }

  /** 返回工作台可选模型，不暴露密钥和部署配置中的凭据。 */
  listConnections() {
    return { connections: this.connections.list(), deletedConnections: this.connections.list(true), configuredModels: Object.keys(this.settings.models), defaultModel: this.env.MODEL_ID?.trim() ?? "" };
  }

  /** 连接保存后立即可用，参数校验沿用 Mastra 内置协议配置。 */
  createConnection(input: unknown) {
    return this.connections.create(this.validateConnection(input));
  }

  /** 编辑保留历史修订，未填写密钥时沿用当前密钥。 */
  updateConnection(id: string, input: unknown) {
    const metadata = z.object({ reference: z.string().min(1), clearApiKey: z.boolean().optional() }).passthrough().safeParse(input);
    if (!metadata.success) throw new ModelConnectionError("请检查模型配置的编辑引用。");
    const { reference, clearApiKey, ...fields } = metadata.data;
    const current = this.connections.current(id, reference);
    const parsed = parseModelConnection(fields);
    if (clearApiKey && parsed.apiKey) throw new ModelConnectionError("清除密钥时不能同时填写新密钥。");
    const apiKey = clearApiKey ? undefined : parsed.apiKey || current.apiKey;
    return this.connections.revise(id, this.validateConnection({ ...parsed, apiKey }));
  }

  /** 从可选目录移除，保留已绑定 Agent 的历史引用。 */
  deleteConnection(id: string, input: unknown) {
    this.connections.setDeleted(id, this.lifecycleReference(input), true);
  }

  /** 恢复目录可见性，不更改模型参数或版本引用。 */
  restoreConnection(id: string, input: unknown) {
    this.connections.setDeleted(id, this.lifecycleReference(input), false);
  }

  private lifecycleReference(input: unknown) {
    const parsed = z.object({ reference: z.string().min(1) }).strict().safeParse(input);
    if (!parsed.success) throw new ModelConnectionError("请提供模型配置的当前引用。");
    return parsed.data.reference;
  }

  private validateConnection(input: unknown) {
    const parsed = parseModelConnection(input);
    let native: ProviderConfig;
    try { native = this.providerConfig(parsed.provider, parsed.baseUrl); }
    catch { throw new ModelConnectionError("请选择有效的供应商；兼容服务需要填写 API 地址。"); }
    const environmentKey = [native.apiKeyEnvVar].flat().some((key) => this.env[key]?.trim());
    if (parsed.provider !== "openai-compatible" && !parsed.apiKey && !environmentKey)
      throw new ModelConnectionError("请填写 API Key。");
    return parsed;
  }

  private providerConfig(provider: string, baseUrl?: string): ProviderConfig {
    if (provider === "openai-compatible") {
      if (!baseUrl) throw new Error("OpenAI 兼容服务需要 baseUrl。");
      return { name: provider, url: baseUrl, apiKeyEnvVar: [], models: [], gateway: "models.dev" };
    }
    const config = getProviderConfig(provider);
    if (!config) throw new Error(`未知模型供应商：${provider}`);
    return { ...config, url: baseUrl ?? config.url };
  }

  private connectionConfig(id: string) {
    const custom = Object.hasOwn(this.settings.providers, id)
      ? this.settings.providers[id]
      : undefined;
    // 旧部署只在此映射到通用兼容连接，不污染其他供应商配置。
    if (id === "default" && !custom)
      return {
        provider: "openai-compatible",
        baseUrl:
          this.env.OPENAI_BASE_URL?.trim() ||
          this.env.OPENAI_BASEURL?.trim() ||
          "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
      };
    if (custom) return custom;
    this.providerConfig(id);
    return { provider: id, baseUrl: undefined, apiKeyEnv: undefined };
  }

  resolve(reference: string, requirements: { tools?: boolean; temperature?: boolean } = {}) {
    const value = reference.trim();
    if (value === "unset-model") throw new ModelConnectionError("请选择模型连接，或配置系统默认 MODEL_ID。");
    if (!value) throw new Error("模型 ID 不能为空。");
    if (value.startsWith("connection:")) {
      const saved = this.connections.get(value);
      const config = this.providerConfig(saved.provider, saved.baseUrl);
      const apiKey = saved.apiKey || [config.apiKeyEnvVar].flat().map((key) => this.env[key]?.trim()).find(Boolean);
      if (saved.provider !== "openai-compatible" && !apiKey) throw new ModelConnectionError("模型连接缺少 API Key。");
      return { connectionId: saved.id, providerId: saved.provider, modelId: saved.modelId, config, baseUrl: saved.baseUrl, apiKey, supportsTools: undefined, supportsTemperature: undefined, providerOptions: undefined };
    }
    const alias = Object.hasOwn(this.settings.models, value)
      ? this.settings.models[value]
      : undefined;
    const separator = value.indexOf("/");
    const providerId =
      alias?.provider ??
      (separator < 0 ? this.env.MODEL_PROVIDER?.trim() || "default" : value.slice(0, separator));
    const modelId = alias?.modelId ?? (separator < 0 ? value : value.slice(separator + 1));
    if (!modelId.trim()) throw new Error("模型 ID 不能为空。");
    const connection = this.connectionConfig(providerId);
    const native = this.providerConfig(connection.provider, connection.baseUrl);
    const keyNames = connection.apiKeyEnv
      ? [connection.apiKeyEnv]
      : connection.provider === "openai-compatible"
        ? []
        : [native.apiKeyEnvVar].flat();
    const apiKey = keyNames.map((key) => this.env[key]?.trim()).find(Boolean);
    if (keyNames.length && !apiKey)
      throw new Error(`模型供应商 ${providerId} 缺少环境变量：${keyNames.join(" / ")}`);
    if (requirements.tools && alias?.supportsTools === false)
      throw new Error(`模型 ${value} 不支持工具调用。`);
    if (requirements.temperature && alias?.supportsTemperature === false)
      throw new Error(`模型 ${value} 不支持 temperature。`);
    return {
      connectionId: providerId,
      providerId: connection.provider,
      modelId,
      config: native,
      baseUrl: connection.baseUrl,
      apiKey,
      supportsTools: alias?.supportsTools,
      supportsTemperature: alias?.supportsTemperature,
      providerOptions: alias?.providerOptions,
    };
  }
}
