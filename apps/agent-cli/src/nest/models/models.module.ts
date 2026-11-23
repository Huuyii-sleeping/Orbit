import { Body, Controller, Delete, Get, Inject, Module, Param, Patch, Post, Res } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { ModelCatalog } from "../../mastra/models/model-catalog.js";
import { ModelConnectionError } from "../../services/model-connection-store.js";
import { writeJson } from "../http.js";

/** 本机模型连接管理入口，返回值始终为无凭据摘要。 */
@Controller("model-connections")
class ModelConnectionsController {
  constructor(@Inject(ModelCatalog) private readonly catalog: ModelCatalog) {}

  @Get()
  list() {
    return { ok: true, ...this.catalog.listConnections() };
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: unknown, @Res() res: ServerResponse) {
    try {
      writeJson(res, 200, { ok: true, connection: this.catalog.updateConnection(id, body) });
    } catch (error) {
      if (!(error instanceof ModelConnectionError)) throw error;
      writeJson(res, 400, { ok: false, error: { code: "MODEL_CONNECTION_INVALID", message: error.message } });
    }
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Body() body: unknown, @Res() res: ServerResponse) {
    try {
      this.catalog.deleteConnection(id, body);
      writeJson(res, 200, { ok: true });
    } catch (error) {
      if (!(error instanceof ModelConnectionError)) throw error;
      writeJson(res, 400, { ok: false, error: { code: "MODEL_CONNECTION_INVALID", message: error.message } });
    }
  }

  @Post(":id/restore")
  restore(@Param("id") id: string, @Body() body: unknown, @Res() res: ServerResponse) {
    try {
      this.catalog.restoreConnection(id, body);
      writeJson(res, 200, { ok: true });
    } catch (error) {
      if (!(error instanceof ModelConnectionError)) throw error;
      writeJson(res, 400, { ok: false, error: { code: "MODEL_CONNECTION_INVALID", message: error.message } });
    }
  }

  @Post()
  create(@Body() body: unknown, @Res() res: ServerResponse) {
    try {
      writeJson(res, 201, { ok: true, connection: this.catalog.createConnection(body) });
    } catch (error) {
      if (!(error instanceof ModelConnectionError)) throw error;
      writeJson(res, 400, {
        ok: false,
        error: { code: "MODEL_CONNECTION_INVALID", message: error.message },
      });
    }
  }
}

/** 模型协议仍由 Mastra 解析，此模块只提供连接管理。 */
@Module({
  controllers: [ModelConnectionsController],
  providers: [{ provide: ModelCatalog, useFactory: () => new ModelCatalog() }],
})
export class ModelsModule {}
