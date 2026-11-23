import { createHash } from "node:crypto";
import { ModelsDevGateway } from "@mastra/core/llm";
import { ModelCatalog } from "./model-catalog.js";

// Mastra 默认优先读取进程环境；显式连接地址必须隔离，防止多连接互相覆盖。
class ConfiguredModelGateway extends ModelsDevGateway {
  constructor(private readonly connection: ReturnType<ModelCatalog["resolve"]>) {
    super({ [connection.providerId]: connection.config });
  }

  override buildUrl(routerId: string, envVars?: NodeJS.ProcessEnv) {
    return this.connection.baseUrl ?? super.buildUrl(routerId, envVars);
  }
}

/** 仅装配连接；模型 SDK、协议转换和流式解析全部由 Mastra 内置 Gateway 负责。 */
export async function resolveMastraModel(
  reference: string,
  catalog: ModelCatalog,
  requirements: { tools?: boolean; temperature?: boolean } = {},
) {
  const connection = catalog.resolve(reference, requirements);
  const gateway = new ConfiguredModelGateway(connection);
  const model = await gateway.resolveLanguageModel({
    providerId: connection.providerId,
    modelId: connection.modelId,
    apiKey: connection.apiKey ?? "",
  });
  const modelConfigKey = createHash("sha256").update(JSON.stringify(connection)).digest("hex");
  return { model, modelConfigKey, providerOptions: connection.providerOptions };
}
