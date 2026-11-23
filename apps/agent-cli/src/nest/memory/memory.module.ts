import { Module, type DynamicModule } from "@nestjs/common";
import { MemoryController } from "./memory.controller.js";

/** 显式接入当前进程的运行依赖。 */
@Module({})
export class MemoryRuntimeModule {
  static register(runtime: DynamicModule): DynamicModule {
    return { module: MemoryRuntimeModule, imports: [runtime], controllers: [MemoryController] };
  }
}
