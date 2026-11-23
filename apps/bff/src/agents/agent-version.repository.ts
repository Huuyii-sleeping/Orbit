import type { AgentVersion, AgentVersionResolver } from "@orbit/workflow-core";

/** 发布新 AgentVersion 时由产品服务生成的不可变快照。 */
export type PublishAgentVersionRecord = Omit<AgentVersion, "id" | "version">;

/** AgentVersion 持久化边界；历史版本只允许追加和读取。 */
export interface AgentVersionRepository extends AgentVersionResolver {
  publish(input: PublishAgentVersionRecord): AgentVersion;
  list(agentProfileId?: string): AgentVersion[];
  getById(agentVersionId: string): AgentVersion | undefined;
}

/** Agent 版本持久化注入标识，业务层只依赖仓库契约。 */
export const AGENT_VERSION_REPOSITORY = Symbol("AGENT_VERSION_REPOSITORY");
