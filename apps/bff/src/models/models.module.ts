import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Module,
  Post,
  Patch,
  Param,
  Res,
  type DynamicModule,
} from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { AgentProxyService } from "../runtime-connection/agent-proxy.service.js";
import { writeProxyResult } from "../http/http-utils.js";

/** 模型连接归 Runtime 管理，BFF 只转发，不在产品数据库保存凭据。 */
@Controller("/api/model-connections")
class ModelConnectionsController {
  constructor(
    @Inject(AgentProxyService) private readonly proxy: AgentProxyService,
  ) {}

  @Get()
  async list(@Res() res: ServerResponse) {
    writeProxyResult(
      res,
      await this.proxy.proxyJson({
        method: "GET",
        pathname: "/model-connections",
      }),
    );
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown, @Res() res: ServerResponse) {
    writeProxyResult(res, await this.proxy.proxyJson({
      method: "PATCH",
      pathname: `/model-connections/${encodeURIComponent(id)}`,
      body,
    }));
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @Body() body: unknown, @Res() res: ServerResponse) {
    writeProxyResult(res, await this.proxy.proxyJson({
      method: "DELETE", pathname: `/model-connections/${encodeURIComponent(id)}`, body,
    }));
  }

  @Post(":id/restore")
  async restore(@Param("id") id: string, @Body() body: unknown, @Res() res: ServerResponse) {
    writeProxyResult(res, await this.proxy.proxyJson({
      method: "POST", pathname: `/model-connections/${encodeURIComponent(id)}/restore`, body,
    }));
  }

  @Post()
  async create(@Body() body: unknown, @Res() res: ServerResponse) {
    writeProxyResult(
      res,
      await this.proxy.proxyJson({
        method: "POST",
        pathname: "/model-connections",
        body,
      }),
    );
  }
}

/** 与 Agent、会话并列的模型连接管理领域。 */
@Module({})
export class ModelsModule {
  static register(runtime: DynamicModule): DynamicModule {
    return {
      module: ModelsModule,
      imports: [runtime],
      controllers: [ModelConnectionsController],
    };
  }
}
