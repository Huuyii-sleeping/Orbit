import type { AgentConfiguration } from "./agent-configuration.js";
import type { WorkflowRunSnapshot } from "./runtime.js";

/** 独立试跑固定的配置身份，用于区分草稿和发布版本的测试结果。 */
export type AgentTestConfiguration = AgentConfiguration & {
  agentProfileId: string;
  versionId: string;
  contentHash: string;
  name: string;
  label: string;
};

/** Agent 独立试跑复用标准工作流快照。 */
export type AgentTestRun = {
  run: WorkflowRunSnapshot;
  configuration: AgentTestConfiguration;
};
