import { Body, Controller, Get, Inject, Param, Post, Res } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { AgentProxyService } from "../runtime-connection/agent-proxy.service.js";
import { writeProxyResult, type JsonObject } from "../http/http-utils.js";

/** 聊天会话及消息流接口，只代理 Runtime 请求。 */
@Controller("/api/sessions")
export class SessionsController {
  constructor(@Inject(AgentProxyService) private readonly agentProxy: AgentProxyService) {}

  @Get()
  async sessions(@Res() res: ServerResponse): Promise<void> {
    writeProxyResult(res, await this.agentProxy.sessions());
  }

  @Post()
  async createSession(@Body() body: JsonObject, @Res() res: ServerResponse): Promise<void> {
    writeProxyResult(res, await this.agentProxy.createSession(body));
  }

  @Get(":sessionId/transcript")
  async transcript(@Param("sessionId") sessionId: string, @Res() res: ServerResponse): Promise<void> {
    writeProxyResult(res, await this.agentProxy.transcript(sessionId));
  }

  @Post(":sessionId/messages")
  async sendMessage(
    @Param("sessionId") sessionId: string,
    @Body() body: JsonObject,
    @Res() res: ServerResponse,
  ): Promise<void> {
    writeProxyResult(res, await this.agentProxy.sendMessage(sessionId, body));
  }

  @Post(":sessionId/messages/stream")
  async streamMessage(
    @Param("sessionId") sessionId: string,
    @Body() body: JsonObject,
    @Res() res: ServerResponse,
  ): Promise<void> {
    await this.agentProxy.proxyChatMessageStream(res, sessionId, body);
  }

  @Get(":sessionId")
  async sessionDetail(@Param("sessionId") sessionId: string, @Res() res: ServerResponse): Promise<void> {
    writeProxyResult(res, await this.agentProxy.sessionDetail(sessionId));
  }
}
