import { Module, type DynamicModule } from "@nestjs/common";
import { SkillsController } from "./skills.controller.js";

/** 显式接入当前进程的运行依赖。 */
@Module({})
export class SkillsModule {
  static register(runtime: DynamicModule): DynamicModule {
    return { module: SkillsModule, imports: [runtime], controllers: [SkillsController] };
  }
}
