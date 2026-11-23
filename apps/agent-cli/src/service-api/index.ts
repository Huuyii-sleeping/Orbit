import { type AgentRuntimePort, type RuntimeGateway } from "@orbit/runtime-contracts";
import type { ToolServiceLike } from "../tools/service.js";
import { AgentHost } from "../host/agent-host.js";
import type { AgentHostEvent } from "../host/events.js";
import type { AgentHostEventSubscriber } from "../host/events.js";
import { createAgentBridgeManifest, type AgentBridgeState } from "./bridge.js";
import { summarizeSession, type AgentSessionRecord } from "./sessions.js";
import { AgentSkillService } from "../services/agent-skill-service.js";
import { ToolCallService } from "../services/tool-call-service.js";
import { ChatService, type ChatRequest, type ChatCallbacks } from "../services/chat-service.js";
import { SessionCompactionService } from "../services/session-compaction-service.js";

/** 宿主门面仅需要工具目录，推理与存储通过运行端口提供。 */
export type AgentServiceDeps = {
  toolService: Pick<ToolServiceLike, "listToolMetadata" | "listToolRegistrations">;
};

export type AgentServiceRuntimeOptions = {
  runtimeGateway: RuntimeGateway;
  runtimeInfo?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
};

export type AgentServiceEvent = AgentHostEvent;

export type AgentServiceEventSubscriber = AgentHostEventSubscriber;

/** 兼容 CLI、HTTP、MCP 的进程内门面；聊天业务由独立服务承载。 */
export class AgentService {
  private readonly host: AgentHost;
  private readonly chats: ChatService;
  private readonly compaction: SessionCompactionService;
  private readonly toolCalls: ToolCallService;
  private readonly skills = new AgentSkillService();
  /** 工作流执行由 Agent runtime 负责，BFF 只消费此控制面。 */
  readonly workflowRuntime: RuntimeGateway["workflow"];
  /** 四个领域 Port 的进程内组合入口，生产路径唯一指向 Mastra。 */
  readonly runtimeGateway: RuntimeGateway;
  private readonly runtimeInfoProvider?: AgentServiceRuntimeOptions["runtimeInfo"];

  constructor(
    deps: AgentServiceDeps,
    host: AgentHost | undefined,
    runtimeOptions: AgentServiceRuntimeOptions,
  ) {
    this.host = host ?? new AgentHost();
    this.runtimeGateway = runtimeOptions.runtimeGateway;
    this.runtimeInfoProvider = runtimeOptions.runtimeInfo;
    this.workflowRuntime = this.runtimeGateway.workflow;
    this.chats = new ChatService(this.host, deps.toolService, this.runtimeGateway);
    this.compaction = new SessionCompactionService(this.host, this.runtimeGateway);
    this.toolCalls = new ToolCallService(deps.toolService, this.runtimeGateway.tools);
  }

  createSession(agent?: unknown): AgentSessionRecord {
    return this.chats.createSession(agent);
  }

  async runtimeInfo(): Promise<Record<string, unknown>> {
    if (this.runtimeInfoProvider) return this.runtimeInfoProvider();
    const [agent, workflow] = await Promise.all([
      this.runtimeGateway.agent.capabilities(),
      this.runtimeGateway.workflow.capabilities(),
    ]);
    return {
      mode: "mastra-only",
      backends: {
        agent: { backend: "mastra", capabilities: agent },
        workflow: { backend: "mastra", capabilities: workflow },
      },
    };
  }

  listSessions(): AgentSessionRecord[] {
    return this.chats.listSessions();
  }

  getSession(sessionId: string): AgentSessionRecord | null {
    return this.chats.getSession(sessionId);
  }

  toolsMetadata() {
    return this.toolCalls.toolsMetadata();
  }

  runToolByName(name: string, argumentsJson: string) {
    return this.toolCalls.runToolByName(name, argumentsJson);
  }

  resolveAgentSkills(input: unknown) {
    return this.skills.resolveAgentSkills(input);
  }

  getSessionDetail(sessionId: string): Record<string, unknown> | null {
    return this.chats.getSessionDetail(sessionId);
  }

  bridgeManifest(): Record<string, unknown> {
    return createAgentBridgeManifest();
  }

  bridgeState(): AgentBridgeState {
    const manifest = createAgentBridgeManifest();
    const sessions = this.listSessions().map((item) => summarizeSession(item));
    const eventWindow = this.host.eventWindow();
    return {
      ok: true,
      ready: true,
      name: manifest.name,
      version: manifest.version,
      capabilities: manifest.capabilities,
      session_count: sessions.length,
      sessions,
      latest_event_id: eventWindow.latestEventId,
      oldest_event_id: eventWindow.oldestEventId,
      buffered_event_count: eventWindow.bufferedEventCount,
    };
  }

  replayEventsSince(cursor: number | null): AgentServiceEvent[] {
    return this.host.listEventsSince(cursor);
  }

  subscribeEvents(subscriber: AgentServiceEventSubscriber): () => void {
    return this.host.subscribeEvents(subscriber);
  }

  chat(input: ChatRequest, callbacks: ChatCallbacks = {}, agentRuntime?: AgentRuntimePort) {
    return this.chats.chat(input, callbacks, agentRuntime);
  }

  /** 压缩实际推理上下文；保留原 Memory 和终端展示历史。 */
  compactSession(sessionId: string, keepRecent?: number) {
    return this.compaction.compact(sessionId, keepRecent);
  }
}
