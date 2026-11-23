import { Module, type DynamicModule } from "@nestjs/common";
import { AGENT_VERSION_REPOSITORY } from "./agent-version.repository.js";
import { SqliteAgentVersionRepository } from "./sqlite-agent-version.repository.js";

/** 只提供版本仓库，不加载 Agent 编辑、技能或试跑服务，避免领域循环依赖。 */
@Module({})
export class AgentVersionStorageModule {
  static register(database: DynamicModule): DynamicModule {
    return {
      module: AgentVersionStorageModule,
      imports: [database],
      providers: [{ provide: AGENT_VERSION_REPOSITORY, useClass: SqliteAgentVersionRepository }],
      exports: [AGENT_VERSION_REPOSITORY],
    };
  }
}
