import { matchesAgentServiceToken } from "@orbit/service-auth";
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson } from "./http.js";

/** 在所有 Orbit/Mastra 路由与 body parser 之前验证受信服务调用。 */
export function createAgentServiceAuthMiddleware(token: string | undefined) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!token || (req.headersDistinct.authorization?.length === 1 && matchesAgentServiceToken(req.headers.authorization, token))) {
      next();
      return;
    }
    res.setHeader("WWW-Authenticate", 'Bearer realm="orbit-agent"');
    writeJson(res, 401, {
      ok: false,
      error: { code: "AGENT_SERVICE_UNAUTHORIZED", message: "valid Agent service credentials are required" },
    });
  };
}
