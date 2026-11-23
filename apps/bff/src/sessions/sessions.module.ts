import { Module, type DynamicModule } from "@nestjs/common";
import { SessionsController } from "./sessions.controller.js";

/** 会话模块只依赖 Runtime 连接，不加载产品配置或技能安装服务。 */
@Module({})
export class SessionsModule {
  static register(runtime: DynamicModule): DynamicModule {
    return { module: SessionsModule, imports: [runtime], controllers: [SessionsController] };
  }
}
