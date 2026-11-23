import { Module, type DynamicModule } from "@nestjs/common";
import { AgentProfileService } from "./agent-profile.service.js";
import { AgentVersionService } from "./agent-version.service.js";
import { AgentVersionsController } from "./agent-versions.controller.js";
import { AgentWorkbenchController } from "./agent-workbench.controller.js";
import { AgentWorkbenchService } from "./agent-workbench.service.js";
import { AgentsController } from "./agents.controller.js";

/** Agent 配置、发布和试跑边界，复用技能目录与工作流运行服务。 */
@Module({})
export class AgentsModule {
  static register(options: {
    store: DynamicModule;
    versions: DynamicModule;
    skills: DynamicModule;
    runs: DynamicModule;
    runtime: DynamicModule;
  }): DynamicModule {
    return {
      module: AgentsModule,
      imports: [options.store, options.versions, options.skills, options.runs, options.runtime],
      controllers: [AgentsController, AgentVersionsController, AgentWorkbenchController],
      providers: [
        AgentProfileService,
        AgentVersionService,
        AgentWorkbenchService,
      ],
    };
  }
}
