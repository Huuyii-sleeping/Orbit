import { OrganizationAuthorizationError } from "../identity/organization-authorization.js";
import { WorkflowResourceLimitError } from "@orbit/workflow-core";
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import { AgentConfigurationError } from "@orbit/workflow-core";
import type { ServerResponse } from "node:http";
import { errorPayload, writeJson } from "../http/http-utils.js";
import { WorkflowRunControlError } from "../workflow-runs/workflow-runs.errors.js";
import { AgentVersionNotFoundError } from "./agent-version.service.js";
import { AgentWorkbenchService } from "./agent-workbench.service.js";

/** Agent 配置试跑的薄 REST 入口。 */
@Controller("/api/agents")
export class AgentWorkbenchController {
  constructor(
    @Inject(AgentWorkbenchService)
    private readonly service: AgentWorkbenchService,
  ) {}

  @Get("tools/catalog")
  async tools(@Res() res: ServerResponse) {
    await this.respond(res, () => this.service.tools());
  }

  @Get(":agentId/tests")
  async history(@Param("agentId") id: string, @Res() res: ServerResponse) {
    await this.respond(res, async () => ({
      ok: true,
      data: this.service.history(id),
    }));
  }

  @Post(":agentId/tests")
  async test(
    @Param("agentId") id: string,
    @Body() input: { versionId?: string; inputs?: Record<string, unknown> },
    @Res() res: ServerResponse,
  ) {
    await this.respond(res, async () => ({
      ok: true,
      data: await this.service.test(id, input),
    }));
  }

  private async respond(res: ServerResponse, action: () => Promise<unknown>) {
    try {
      writeJson(res, 200, await action());
    } catch (error) {
      if (error instanceof WorkflowRunControlError || error instanceof OrganizationAuthorizationError || error instanceof WorkflowResourceLimitError)
        writeJson(
          res,
          error.statusCode,
          errorPayload(error.code, error.message),
        );
      else if (error instanceof AgentVersionNotFoundError)
        writeJson(res, 404, errorPayload(error.code, error.message));
      else if (error instanceof AgentConfigurationError)
        writeJson(res, 400, errorPayload(error.code, error.message));
      else throw error;
    }
  }
}
