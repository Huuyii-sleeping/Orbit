import { Module, type DynamicModule } from "@nestjs/common";
import { SessionsController } from "./sessions.controller.js";

/** 显式接入当前进程的运行依赖。 */
@Module({})
export class SessionsModule {
  static register(runtime: DynamicModule): DynamicModule {
    return { module: SessionsModule, imports: [runtime], controllers: [SessionsController] };
  }
}
