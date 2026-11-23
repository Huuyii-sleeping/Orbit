import { Module } from "@nestjs/common";
import type { AgentProxyOptions } from "./runtime-connection/agent-proxy.service.js";
import { AgentsModule } from "./agents/agents.module.js";
import { AgentVersionStorageModule } from "./agents/agent-version-storage.module.js";
import type { LocalStoreOptions } from "./storage/local-store.service.js";
import { RuntimeModule } from "./runtime-connection/runtime.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";
import type { SkillRegistryOptions } from "./skills/skill-registry.service.js";
import { SkillsModule } from "./skills/skills.module.js";
import { LocalStoreModule } from "./storage/local-store.module.js";
import { ProductDatabaseModule } from "./storage/product-database.module.js";
import { SopsModule, type SopsModuleOptions } from "./sops/sops.module.js";
import { WorkflowRunsModule } from "./workflow-runs/workflow-runs.module.js";
import { WorkspaceModule } from "./workspace/workspace.module.js";
import { ModelsModule } from "./models/models.module.js";

/** BFF 进程启动配置，各领域仅接收自己需要的配置和共享资源。 */
export type AppModuleOptions = AgentProxyOptions & LocalStoreOptions & SkillRegistryOptions & SopsModuleOptions;

/** 只装配业务模块和共享资源，不注册业务 controller 或 service。 */
@Module({})
export class AppModule {
  static register(options: AppModuleOptions) {
    const store = LocalStoreModule.register(options);
    const database = ProductDatabaseModule.register(options);
    const versions = AgentVersionStorageModule.register(database);
    const runtime = RuntimeModule.register(options);
    const skills = SkillsModule.register(options, store);
    const sops = SopsModule.register(options, database, versions);
    const runs = WorkflowRunsModule.register({ runtime, database, versions, sops });
    return {
      module: AppModule,
      imports: [
        runtime,
        ModelsModule.register(runtime),
        WorkspaceModule.register(store),
        SessionsModule.register(runtime),
        skills,
        sops,
        runs,
        AgentsModule.register({ store, versions, skills, runs, runtime }),
      ],
    };
  }
}
