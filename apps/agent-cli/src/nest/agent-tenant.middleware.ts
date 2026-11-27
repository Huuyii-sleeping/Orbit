import { decodeServiceTenant, runWithServiceTenant, SERVICE_TENANT_HEADER } from "@orbit/service-auth";
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson } from "./http.js";

/** Agent HTTP 的部署模式；生产必须使用 SaaS 边界。 */
export type AgentDeploymentMode = "local" | "saas";

/** 本地宿主兼容旧入口；生产禁止回退到全局运行模式。 */
export function resolveAgentDeploymentMode(mode?: AgentDeploymentMode, env = process.env): AgentDeploymentMode {
  const production = env.NODE_ENV === "production";
  const value = mode ?? env.AGENT_MODE ?? (production ? "saas" : "local");
  if (value !== "local" && value !== "saas") throw new Error("AGENT_MODE must be local or saas");
  if (production && value !== "saas") throw new Error("Production Agent requires AGENT_MODE=saas");
  return value;
}

/** 必须在服务 Bearer 鉴权后安装；租户流量只进入已隔离的 Workflow API。 */
export function createAgentTenantMiddleware(mode: AgentDeploymentMode, token: string | undefined) {
  if (mode === "saas" && !token) throw new Error("SaaS Agent requires service credentials");
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const headers = req.headersDistinct[SERVICE_TENANT_HEADER];
    if (!headers && mode === "local") { next(); return; }
    if (!headers && req.method === "GET" && pathname === "/health") { next(); return; }
    if (!token || !headers || headers.length !== 1) {
      writeJson(res, 401, { ok: false, error: { code: "AGENT_TENANT_REQUIRED", message: "Trusted tenant identity is required" } });
      return;
    }
    let identity;
    try { identity = decodeServiceTenant(headers[0]); }
    catch {
      writeJson(res, 401, { ok: false, error: { code: "AGENT_TENANT_INVALID", message: "Invalid tenant identity" } });
      return;
    }
    const route = `${req.method} ${pathname}`;
    const allowed = route === "POST /workflow-runs"
      || /^GET \/workflow-runs\/[^/%]+(?:\/events)?$/.test(route)
      || /^POST \/workflow-runs\/[^/%]+\/(?:cancel|resume)$/.test(route);
    if (!allowed) {
      writeJson(res, 403, { ok: false, error: { code: "SAAS_CAPABILITY_NOT_ISOLATED", message: "This capability is unavailable in shared SaaS mode" } });
      return;
    }
    runWithServiceTenant(identity, next);
  };
}
