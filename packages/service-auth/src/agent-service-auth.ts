import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/** 受信服务端持有的 Agent HTTP 凭据，不属于浏览器或用户身份配置。 */
export type AgentServiceAuthOptions = {
  agentServiceToken?: string;
};

/** 统一校验服务凭据；生产环境不允许隐式匿名模式，显式空值不能关闭认证。 */
export function resolveAgentServiceToken(options: AgentServiceAuthOptions = {}, env: NodeJS.ProcessEnv = process.env) {
  const raw = options.agentServiceToken ?? env.AGENT_SERVICE_TOKEN;
  if (raw === undefined) {
    if (env.NODE_ENV === "production") throw new Error("AGENT_SERVICE_TOKEN must be configured for production");
    return undefined;
  }
  const token = raw.trim();
  if (token.length < 32 || token.length > 512 || !/^[A-Za-z0-9\-._~+/]+=*$/.test(token)) {
    throw new Error("AGENT_SERVICE_TOKEN must contain 32–512 valid Bearer token characters");
  }
  return token;
}

/** 固定长度摘要比较；不接受 query、cookie 或多个 Authorization 值。 */
export function matchesAgentServiceToken(authorization: string | undefined, token: string) {
  if (!authorization || authorization.length > 1024) return false;
  const match = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization);
  if (!match || match[0] !== authorization) return false;
  return timingSafeEqual(
    createHash("sha256").update(match[1]!).digest(),
    createHash("sha256").update(token).digest(),
  );
}

/** 无凭据仅允许明确的回环 IP；直接使用 server 工厂也不能匿名绑定外网。 */
export function assertAgentServiceListenAddress(host: string, token: string | undefined) {
  const version = isIP(host);
  if (!version) throw new Error("AGENT_HTTP_HOST must be an IP address");
  const loopback = version === 4 ? host.startsWith("127.") : host === "::1";
  if (!token && !loopback) throw new Error("AGENT_SERVICE_TOKEN is required for a non-loopback Agent HTTP listener");
}
