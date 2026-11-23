import type { AgentAppRuntimeDeps } from "../../bootstrap/app-runtime.js";
import { createEmbeddedAgent } from "../../bootstrap/embedded-agent.js";
import { createMastraAgentService } from "../../bootstrap/mastra-service.js";
import type { AgentHost } from "../../host/agent-host.js";
import { ModelCatalog } from "../../mastra/models/model-catalog.js";
import { renderCliError } from "../ui.js";
import {
  resolveDaemonTuiService,
  type DaemonTuiServiceResolution,
  type TerminalTuiServiceLike,
} from "./service.js";

/** 两种 TUI 共用的宿主选择配置，注入 service 或 host 时优先使用显式依赖。 */
export type TerminalRuntimeOptions = {
  service?: TerminalTuiServiceLike;
  host?: AgentHost;
  app?: AgentAppRuntimeDeps;
  resolveDaemonService?: () => Promise<DaemonTuiServiceResolution | null>;
};

/** 管理 daemon 连接、本地 Mastra 宿主与原子模型切换；不参与终端渲染。 */
export async function createTerminalRuntime(options: TerminalRuntimeOptions = {}) {
  let service = options.service;
  let embedded: Awaited<ReturnType<typeof createEmbeddedAgent>> | undefined;
  let notice: string | null = null;
  if (!service && !options.host) {
    try {
      const resolved = await (options.resolveDaemonService ?? resolveDaemonTuiService)();
      service = resolved?.service;
      notice = resolved?.notice ?? null;
    } catch (error) {
      notice = renderCliError(
        "daemon attach failed",
        error instanceof Error ? error.message : String(error),
        "falling back to embedded host",
      );
    }
  }
  if (!service) {
    embedded = await createEmbeddedAgent({
      app: options.app,
      host: options.host,
      allowUnconfiguredModel: !options.host,
    });
    service = embedded.service;
  }
  let selectedService = service;
  let model = embedded?.app.model ?? "daemon-host";
  let startupIssue = embedded?.startupIssue ?? null;
  return {
    get service() {
      return selectedService;
    },
    get app() {
      return embedded?.app ?? null;
    },
    get model() {
      return model;
    },
    get startupIssue() {
      return startupIssue;
    },
    notice,
    async setModel(nextModel: string) {
      if (!embedded) return false;
      // 只校验本地引用、凭据与能力，不发起计费请求；无效配置不能覆盖可用服务。
      new ModelCatalog().resolve(nextModel, { tools: true });
      // 服务创建成功后再更新显示与环境，失败时保留原服务、工具实例和会话。
      const app = { ...embedded.app, model: nextModel };
      const replacement = await createMastraAgentService(app, embedded.host);
      selectedService = replacement;
      embedded = { ...embedded, service: replacement, app, startupIssue: null };
      model = nextModel;
      startupIssue = null;
      process.env.MODEL_ID = nextModel;
      return true;
    },
  };
}
