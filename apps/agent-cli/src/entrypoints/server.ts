import * as process from "node:process";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { AgentService } from "../service-api/index.js";
import { createAgentAppRuntime, type AgentAppRuntimeDeps } from "../bootstrap/app-runtime.js";
import { AgentHost } from "../host/agent-host.js";
import { resolveAgentHttpPort } from "../service-api/config.js";
import { createNestAgentHttpServer } from "../nest/server.js";
import { createMastraAgentService } from "../bootstrap/mastra-service.js";
import { getDefaultModel } from "../config/config.js";

/** CLI/daemon 宿主真正需要的最小 HTTP server 生命周期接口。 */
export type AgentServerLike = {
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: () => void): unknown;
  listen(port: number, host: string, callback: () => void): unknown;
  close(callback?: (error?: Error) => void): unknown;
  closeAllConnections?(): void;
  closeIdleConnections?(): void;
  address?(): AddressInfo | string | null;
};

export type RunServerOptions = {
  service?: AgentService;
  host?: AgentHost;
  app?: AgentAppRuntimeDeps;
  serverFactory?: (service: AgentService) => AgentServerLike | Promise<AgentServerLike>;
  port?: number;
  output?: NodeJS.WritableStream;
};

export async function runServer(options: RunServerOptions = {}): Promise<AgentServerLike> {
  let service = options.service;
  if (!service) {
    const host = options.host ?? new AgentHost();
    await host.initialize();
    // HTTP 工作台允许先启动再配置连接；未选择模型时在执行前明确报错。
    service = await createMastraAgentService(options.app ?? createAgentAppRuntime({ model: getDefaultModel() }), host);
  }
  const server = options.serverFactory
    ? await options.serverFactory(service)
    : await createNestAgentHttpServer(service, { enableShutdownHooks: true });
  const targetPort = options.port ?? resolveAgentHttpPort();
  const output = options.output ?? process.stdout;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(targetPort, "0.0.0.0", () => resolve());
  });
  output.write(`agent service listening on http://0.0.0.0:${targetPort}\n`);
  return server;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}

if (isDirectRun()) {
  runServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
