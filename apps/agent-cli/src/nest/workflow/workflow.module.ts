import { Module, type DynamicModule } from "@nestjs/common";
import { WorkflowController } from "./workflow.controller.js";

/** 显式接入当前进程的运行依赖。 */
@Module({})
export class WorkflowRuntimeModule {
  static register(runtime: DynamicModule): DynamicModule {
    return { module: WorkflowRuntimeModule, imports: [runtime], controllers: [WorkflowController] };
  }
}
