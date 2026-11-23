import * as process from "node:process";
import { isIP } from "node:net";

export const DEFAULT_AGENT_HTTP_PORT = 3181;

/** 默认只监听本机；跨容器部署须显式配置监听 IP 并启用服务认证。 */
export function resolveAgentHttpHost(env: NodeJS.ProcessEnv = process.env) {
  const host = env.AGENT_HTTP_HOST?.trim() ?? "127.0.0.1";
  if (!isIP(host)) throw new Error("AGENT_HTTP_HOST must be an IP address");
  return host;
}

export function resolveAgentHttpPort(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.AGENT_HTTP_PORT ?? DEFAULT_AGENT_HTTP_PORT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AGENT_HTTP_PORT;
}

export function resolveAgentServiceBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `http://127.0.0.1:${resolveAgentHttpPort(env)}`;
}
