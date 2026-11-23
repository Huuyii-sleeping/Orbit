import type {
  AgentRunResult,
  AgentRuntimePort,
  GenerateAgentCommand,
  RuntimeGateway,
} from "@orbit/runtime-contracts";
import { recordAuditEvent } from "../audit/runtime.js";
import type { AgentHost } from "../host/agent-host.js";
import type { ToolServiceLike } from "../tools/service.js";
import {
  normalizeAgentRuntimeContext,
  summarizeSession,
  summarizeSessionTranscript,
  type AgentSessionRecord,
} from "../service-api/sessions.js";

/** 聊天请求，供 HTTP 适配与进程内调用复用。 */
export type ChatRequest = {
  session_id?: string;
  message?: string;
  agent?: unknown;
  include_scheduled_notifications?: boolean;
};

/** 流式聊天的文本增量回调。 */
export type ChatCallbacks = {
  onAssistantDelta?: (delta: string) => void | Promise<void>;
};

/** 管理聊天会话与执行生命周期；模型推理和 Memory 委托给运行端口。 */
export class ChatService {
  constructor(
    private readonly host: Pick<
      AgentHost,
      "createSessionSync" | "persistSession" | "listSessions" | "getSession" | "emitEvent"
    >,
    private readonly tools: Pick<ToolServiceLike, "listToolRegistrations">,
    private readonly runtime: Pick<RuntimeGateway, "agent" | "memory">,
  ) {}

  createSession(agent?: unknown): AgentSessionRecord {
    const normalizedAgent = normalizeAgentRuntimeContext(agent);
    const record = this.host.createSessionSync(normalizedAgent);
    void this.host.persistSession(record);
    return record;
  }

  listSessions(): AgentSessionRecord[] {
    return this.host.listSessions();
  }

  getSession(sessionId: string): AgentSessionRecord | null {
    return this.host.getSession(sessionId);
  }

  getSessionDetail(sessionId: string): Record<string, unknown> | null {
    const session = this.getSession(sessionId);
    return session ? summarizeSessionTranscript(session) : null;
  }

  async chat(
    input: ChatRequest,
    callbacks: ChatCallbacks = {},
    agentRuntime: AgentRuntimePort = this.runtime.agent,
  ): Promise<Record<string, unknown>> {
    const prompt = String(input.message ?? "").trim();
    if (!prompt) {
      return {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "message is required",
        },
      };
    }

    const agent = normalizeAgentRuntimeContext(input.agent);
    const session = input.session_id
      ? this.getSession(String(input.session_id))
      : this.createSession(agent);
    if (!session) {
      return {
        ok: false,
        error: {
          code: "SESSION_NOT_FOUND",
          message: `session not found: ${String(input.session_id)}`,
        },
      };
    }
    if (session.busy) {
      return {
        ok: false,
        error: {
          code: "SESSION_BUSY",
          message: `session is busy: ${session.id}`,
        },
      };
    }
    // 准备 Memory、工具目录和审计也是本轮执行的一部分，必须在首次 await 前占用会话。
    session.busy = true;
    try {
      if (agent) {
        session.agent = agent;
      }
      const ownerId = session.memoryBinding?.ownerId ?? "local-owner";
      const resourceId = session.memoryBinding?.resourceId ?? `session:${session.id}`;
      const threadId = session.memoryBinding?.threadId ?? session.id;
      session.memoryBinding ??= {
        ownerId,
        resourceId,
        metadata: { source: "agent-session" },
      };
      await this.runtime.memory.createThread({
        id: threadId,
        ownerId,
        resourceId,
        metadata: { source: "agent-session" },
      });
      const allowedToolIds = (await this.tools.listToolRegistrations()).map((tool) => tool.name);
      const command: GenerateAgentCommand = {
        agentId: session.agent?.id ?? "orbit-agent",
        agentVersion:
          session.agent?.skills
            .map((skill) => skill.version)
            .filter(Boolean)
            .join(",") || "default",
        sessionId: session.id,
        resourceId,
        threadId,
        messages: [{ role: "user", content: prompt }],
        requestContext: {
          ownerId,
          resourceId,
          threadId,
          includeScheduledNotifications: input.include_scheduled_notifications === true,
        },
        runtimeBinding: session.runtimeBinding,
        policy: {
          allowedToolIds,
          allowedSkillIds: session.agent?.skills.map((skill) => skill.skillId) ?? [],
        },
      };

      session.updatedAt = Date.now();
      session.rounds += 1;
      session.history.push({ role: "user", content: prompt });
      await recordAuditEvent({
        category: "session",
        action: "chat",
        outcome: "started",
        subject: session.id,
        summary: "chat started",
        sessionId: session.id,
        metadata: {
          messageLength: prompt.length,
          rounds: session.rounds,
        },
      });
      this.host.emitEvent("chat.started", {
        session: summarizeSession(session),
        message: prompt,
      });
      let result: AgentRunResult | null = null;
      if (callbacks.onAssistantDelta) {
        for await (const event of agentRuntime.stream(command)) {
          if (event.type === "text.delta") await callbacks.onAssistantDelta(event.delta);
          if (event.type === "run.final") result = event.result;
        }
      } else {
        result = await agentRuntime.generate(command);
      }
      if (!result) throw new Error("Mastra Agent stream 未返回 run.final。");
      if (result.status !== "succeeded") {
        const error = result.error ?? {
          code: "MASTRA_AGENT_EXECUTION_FAILED",
          message: "Mastra Agent 执行失败。",
        };
        await recordAuditEvent({
          category: "session",
          action: "chat",
          outcome: "failed",
          subject: session.id,
          summary: error.message,
          sessionId: session.id,
          metadata: {
            errorCode: error.code,
            rounds: session.rounds,
          },
        });
        this.host.emitEvent("chat.failed", {
          session: summarizeSession(session),
          error,
        });
        return {
          ok: false,
          error,
          session: summarizeSession(session),
        };
      }
      session.history.push({ role: "assistant", content: result.text });
      session.updatedAt = Date.now();
      await recordAuditEvent({
        category: "session",
        action: "chat",
        outcome: "completed",
        subject: session.id,
        summary: "chat completed",
        sessionId: session.id,
        metadata: {
          messageCount: session.history.length,
          rounds: session.rounds,
        },
      });
      this.host.emitEvent("chat.completed", {
        session: summarizeSession(session),
        assistant: result.text,
      });
      return {
        ok: true,
        session: summarizeSession(session),
        assistant: result.text,
      };
    } catch (error) {
      await recordAuditEvent({
        category: "session",
        action: "chat",
        outcome: "failed",
        subject: session.id,
        summary: error instanceof Error ? error.message : String(error),
        sessionId: session.id,
        metadata: { rounds: session.rounds },
      });
      this.host.emitEvent("chat.failed", {
        session: summarizeSession(session),
        error: {
          code: "AGENT_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    } finally {
      session.busy = false;
      session.updatedAt = Date.now();
      await this.host.persistSession(session);
    }
  }
}
