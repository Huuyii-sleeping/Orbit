import { Module, type DynamicModule } from "@nestjs/common";
import { AgentProxyService, type AgentProxyOptions } from "./agent-proxy.service.js";
import { RuntimeController } from "./runtime.controller.js";

/** 共享单个 Runtime 连接；各业务模块显式导入，不使用全局 provider。 */
@Module({})
export class RuntimeModule {
  static register(options: AgentProxyOptions): DynamicModule {
    return {
      module: RuntimeModule,
      controllers: [RuntimeController],
      providers: [{ provide: AgentProxyService, useValue: new AgentProxyService(options) }],
      exports: [AgentProxyService],
    };
  }
}
