import { Module, type DynamicModule } from "@nestjs/common";
import { SqliteWorkflowRunsRepository } from "./sqlite-workflow-runs.repository.js";
import { WORKFLOW_RUNS_REPOSITORY } from "./workflow-runs.types.js";
import { WorkflowRunsController } from "./workflow-runs.controller.js";
import { WorkflowRunsService } from "./workflow-runs.service.js";

/** 运行控制只消费 SOP 和 Agent 版本仓库，不重新创建其他领域的存储。 */
@Module({})
export class WorkflowRunsModule {
  static register(options: {
    runtime: DynamicModule;
    database: DynamicModule;
    versions: DynamicModule;
    sops: DynamicModule;
  }): DynamicModule {
    return {
      module: WorkflowRunsModule,
      imports: [options.runtime, options.database, options.versions, options.sops],
      controllers: [WorkflowRunsController],
      providers: [
        { provide: WORKFLOW_RUNS_REPOSITORY, useClass: SqliteWorkflowRunsRepository },
        WorkflowRunsService,
      ],
      exports: [WorkflowRunsService],
    };
  }
}
