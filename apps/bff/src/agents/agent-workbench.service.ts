import type {
  AgentTestConfiguration,
  AgentTestRun,
} from "@orbit/workflow-core";
import { Inject, Injectable } from "@nestjs/common";
import { AgentProxyService } from "../runtime-connection/agent-proxy.service.js";
import { WorkflowRunsService } from "../workflow-runs/workflow-runs.service.js";
import { WorkflowRunControlError } from "../workflow-runs/workflow-runs.errors.js";
import {
  AgentVersionNotFoundError,
  AgentVersionService,
} from "./agent-version.service.js";
import { createAgentTestWorkflow } from "./agent-test-workflow.js";

/** Agent 独立试跑与真实工具目录的产品边界。 */
@Injectable()
export class AgentWorkbenchService {
  constructor(
    @Inject(AgentVersionService) private readonly versions: Pick<AgentVersionService, "get" | "draftSnapshot">,
    @Inject(WorkflowRunsService) private readonly runs: Pick<WorkflowRunsService, "startAgentTest" | "listAgentTests">,
    @Inject(AgentProxyService) private readonly proxy: Pick<AgentProxyService, "agentTools">,
  ) {}

  /** versionId 缺省时测试已保存草稿，试跑不会生成发布版本。 */
  async test(
    agentId: string,
    input: { versionId?: string; inputs?: Record<string, unknown> },
  ) {
    if (
      !input ||
      !input.inputs ||
      typeof input.inputs !== "object" ||
      Array.isArray(input.inputs) ||
      !Object.keys(input.inputs).length
    ) {
      throw new WorkflowRunControlError(
        400,
        "AGENT_TEST_INPUT_INVALID",
        "请提供非空的测试输入 JSON 对象。",
      );
    }
    const version = input.versionId
      ? this.versions.get(input.versionId)
      : await this.versions.draftSnapshot(agentId);
    if (version.agentProfileId !== agentId)
      throw new AgentVersionNotFoundError("version", input.versionId ?? "");
    const configuration: AgentTestConfiguration = {
      agentProfileId: agentId,
      versionId: version.id,
      contentHash: version.contentHash,
      name: version.name,
      label: input.versionId ? `v${version.version}` : "已保存草稿",
      modelId: version.modelId ?? "",
      allowedToolIds: [...version.toolPolicy.allowedToolIds],
      outputSchema: version.outputSchema,
    };
    const run = await this.runs.startAgentTest(
      createAgentTestWorkflow(version, input.inputs),
      version,
      { testConfiguration: configuration, testInputs: input.inputs },
    );
    return { run, configuration } satisfies AgentTestRun;
  }

  /** 试跑配置与输入和运行一起保存，刷新页面后仍可追溯。 */
  history(agentId: string): AgentTestRun[] {
    return this.runs.listAgentTests(agentId).flatMap((run) => {
      const config = run.inputs.testConfiguration;
      return config &&
        typeof config === "object" &&
        "agentProfileId" in config &&
        config.agentProfileId === agentId
        ? [{ run, configuration: config as AgentTestConfiguration }]
        : [];
    });
  }

  /** 模型与工具的可用性最终由实际试跑验证。 */
  async tools() {
    const result = await this.proxy.agentTools();
    if (!result.ok)
      throw new WorkflowRunControlError(
        result.status,
        "AGENT_TOOLS_UNAVAILABLE",
        "工具目录加载失败，请检查 Agent 服务。",
      );
    return result.body;
  }
}
