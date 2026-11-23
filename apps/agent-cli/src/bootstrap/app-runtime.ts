import { ensureModelConfigured, getDefaultModel, getStaticPromptSource } from "../config/config.js";
import { createRuntimeServices, type RuntimeServices } from "../services/runtime-services.js";
import type { StaticPromptSource } from "../prompt/types.js";

/** 入口装配使用的运行配置；不携带模型 SDK 客户端或重复的服务容器。 */
export type AgentAppRuntimeDeps = RuntimeServices & {
  model: string;
  promptSource: StaticPromptSource;
};

/** 组装宿主所需服务，模型客户端由执行适配层按需创建。 */
export function createAgentAppRuntime(overrides: Partial<AgentAppRuntimeDeps> = {}): AgentAppRuntimeDeps {
  if (!overrides.model) ensureModelConfigured();
  return {
    ...createRuntimeServices(overrides),
    model: overrides.model ?? getDefaultModel(),
    promptSource: overrides.promptSource ?? getStaticPromptSource(),
  };
}
