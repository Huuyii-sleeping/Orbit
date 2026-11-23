import { Module, type DynamicModule } from "@nestjs/common";
import { ProfileService } from "./profile.service.js";
import { SettingsService } from "./settings.service.js";
import { WorkspaceController } from "./workspace.controller.js";

/** 工作区配置模块，与 Agent Runtime 无依赖。 */
@Module({})
export class WorkspaceModule {
  static register(store: DynamicModule): DynamicModule {
    return {
      module: WorkspaceModule,
      imports: [store],
      controllers: [WorkspaceController],
      providers: [
        ProfileService,
        SettingsService,
      ],
    };
  }
}
