import { createAgentAppRuntime, type AgentAppRuntimeDeps } from "./app-runtime.js";
import { createMastraAgentService } from "./mastra-service.js";
import { AgentHost } from "../host/agent-host.js";

/** CLI 宿主的统一装配参数；交互界面可先启动，再由 /model 配置模型。 */
export type EmbeddedAgentOptions = {
  app?: AgentAppRuntimeDeps;
  host?: AgentHost;
  overrides?: Partial<AgentAppRuntimeDeps>;
  allowUnconfiguredModel?: boolean;
};

/** 初始化本地会话宿主并连接唯一 Mastra 执行路径，不发起模型请求。 */
export async function createEmbeddedAgent(options: EmbeddedAgentOptions = {}) {
  let app = options.app;
  let startupIssue: Error | null = null;
  if (!app) {
    try {
      app = createAgentAppRuntime(options.overrides);
    } catch (error) {
      if (
        !options.allowUnconfiguredModel ||
        !(error instanceof Error) ||
        !error.message.includes("Missing environment variable: MODEL_ID")
      )
        throw error;
      startupIssue = error;
      app = createAgentAppRuntime({ ...options.overrides, model: "unset-model" });
    }
  }
  const host = options.host ?? new AgentHost();
  await host.initialize();
  const service = await createMastraAgentService(app, host);
  return { app, host, service, startupIssue };
}
