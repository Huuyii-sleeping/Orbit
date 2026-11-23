import { Module, type DynamicModule } from "@nestjs/common";
import { ToolController } from "./tool.controller.js";

/** 显式接入当前进程的运行依赖。 */
@Module({})
export class ToolExecutionModule {
  static register(runtime: DynamicModule): DynamicModule {
    return { module: ToolExecutionModule, imports: [runtime], controllers: [ToolController] };
  }
}
