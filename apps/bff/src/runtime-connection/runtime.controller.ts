import { Body, Controller, Get, Inject, Post, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AgentProxyService } from "./agent-proxy.service.js";
import { writeJson, writeProxyResult, type JsonObject } from "../http/http-utils.js";

function searchFromReq(req: IncomingMessage): string {
  const url = req.url ? new URL(req.url, "http://127.0.0.1") : null;
  return url?.search ?? "";
}

/** Runtime 健康、审计、安全和事件接口。 */
@Controller("/api")
export class RuntimeController {
  constructor(@Inject(AgentProxyService) private readonly agentProxy: AgentProxyService) {}

  @Get("health")
  async health(@Res() res: ServerResponse): Promise<void> {
    const result = await this.agentProxy.health();
    if (!result.ok) {
      writeProxyResult(res, result);
      return;
    }
    const body = result.body && typeof result.body === "object" && !Array.isArray(result.body) ? (result.body as JsonObject) : {};
    writeJson(res, result.status, {
      ok: body.ok !== false,
      bff: { status: "ok" },
      agent: result.body,
    });
  }

  @Post("agent-skills/resolve")
  async resolveAgentSkills(@Body() body: JsonObject, @Res() res: ServerResponse): Promise<void> {
    writeProxyResult(res, await this.agentProxy.resolveAgentSkills(body));
  }

  @Get("audit/events")
  async auditEvents(@Req() req: IncomingMessage, @Res() res: ServerResponse): Promise<void> {
    writeProxyResult(res, await this.agentProxy.auditEvents(searchFromReq(req)));
  }

  @Get("security/findings")
  async securityFindings(@Req() req: IncomingMessage, @Res() res: ServerResponse): Promise<void> {
    writeProxyResult(res, await this.agentProxy.securityFindings(searchFromReq(req)));
  }

  @Get("events/stream")
  async events(@Req() req: IncomingMessage, @Res() res: ServerResponse): Promise<void> {
    await this.agentProxy.proxyEventStream(req, res, searchFromReq(req));
  }
}
