import { Body, Controller, Get, Inject, Post, Res } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import type { AgentService } from "../../service-api/index.js";
import { writeJson } from "../http.js";
import { AGENT_TOOLS_SERVICE } from "../tokens.js";

@Controller("tools")
export class ToolController {
  constructor(
    @Inject(AGENT_TOOLS_SERVICE) private readonly service: Pick<AgentService, "toolsMetadata" | "runToolByName">,
  ) {}

  @Get()
  async list(): Promise<Record<string, unknown>> {
    return { ok: true, tools: await this.service.toolsMetadata() };
  }

  @Post("call")
  async execute(
    @Body() body: { name?: string; arguments_json?: string },
    @Res() res: ServerResponse,
  ): Promise<void> {
    const toolName = String(body.name ?? "").trim();
    if (!toolName) {
      writeJson(res, 400, {
        ok: false,
        error: { code: "INVALID_REQUEST", message: "tool name is required" },
      });
      return;
    }
    const output = await this.service.runToolByName(toolName, String(body.arguments_json ?? ""));
    writeJson(res, 200, { ok: true, output });
  }
}
