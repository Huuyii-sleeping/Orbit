import { Module, type DynamicModule } from "@nestjs/common";
import { AgentController } from "./agent.controller.js";

/** 显式接入当前进程的运行依赖。 */
@Module({})
export class AgentRuntimeModule {
  static register(runtime: DynamicModule): DynamicModule {
    return { module: AgentRuntimeModule, imports: [runtime], controllers: [AgentController] };
  }
}
