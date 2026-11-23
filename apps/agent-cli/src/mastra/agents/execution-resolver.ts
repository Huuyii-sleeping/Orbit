import { resolveVersionSkillInstructions } from "./skill-instructions.js";
import type {
  AgentExecutionContext,
  AgentInputMessage,
  AgentUsage,
} from "@orbit/runtime-contracts";
import type { Agent, ToolsInput } from "@mastra/core/agent";
import type { MastraMemory } from "@mastra/core/memory";
import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from "@mastra/core/request-context";
import { ModelCatalog } from "../models/model-catalog.js";
import { resolveMastraModel } from "../models/model-resolver.js";
import { buildPromptEnvelope } from "../../prompt/builder.js";
import type { StaticPromptSource } from "../../prompt/types.js";
import type { ModelPolicyServiceLike } from "../../services/model-policy-service.js";
import { MastraAgentDefinitionRegistry } from "./definition-registry.js";
import {
  ORBIT_EXECUTOR_KIND_KEY,
  ORBIT_OWNER_ID_KEY,
  ORBIT_SESSION_ID_KEY,
} from "../tools/tool-execution-adapter.js";

export type MastraAgentChunk = {
  type: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

export type MastraAgentGenerateOutput = {
  runId?: string;
  text: string;
  finishReason?: string;
  totalUsage: AgentUsage;
  toolCalls: unknown[];
  toolResults: unknown[];
  error?: Error;
  tripwire?: { reason: string; metadata?: unknown };
};

export type MastraAgentStreamOutput = {
  runId: string;
  fullStream: AsyncIterable<MastraAgentChunk>;
  text: Promise<string>;
  finishReason: Promise<string | undefined>;
  totalUsage: Promise<AgentUsage>;
  error?: Error;
  tripwire?: { reason: string; metadata?: unknown };
};

export type MastraAgentExecutionOptions = {
  runId: string;
  abortSignal: AbortSignal;
  requestContext: RequestContext;
  activeTools: string[];
  providerOptions?: Awaited<ReturnType<typeof resolveMastraModel>>["providerOptions"];
  memory?: { resource: string; thread: string };
};

/** Adapter 使用的最小 Mastra Agent 执行面，便于共享 contract harness 注入确定性执行器。 */
export type MastraAgentExecutor = {
  generate(
    messages: AgentInputMessage[],
    options: MastraAgentExecutionOptions,
  ): Promise<MastraAgentGenerateOutput>;
  stream(
    messages: AgentInputMessage[],
    options: MastraAgentExecutionOptions,
  ): Promise<MastraAgentStreamOutput>;
  abortRunStream(runId: string): boolean;
};

export type MastraAgentResolution = {
  executor: MastraAgentExecutor;
  executionOptions: Omit<MastraAgentExecutionOptions, "runId" | "abortSignal">;
  finalizeUsage(usage: AgentUsage, latencyMs: number): Promise<void>;
};

export type MastraAgentMemoryIdentity = {
  mastraResourceId: string;
  mastraThreadId: string;
};

export interface MastraAgentExecutionResolver {
  readonly sessionMemory: boolean;
  resolve(
    command: AgentExecutionContext,
    identity: MastraAgentMemoryIdentity,
  ): Promise<MastraAgentResolution>;
}

type ResolverOptions = {
  registry: MastraAgentDefinitionRegistry;
  modelPolicyService: ModelPolicyServiceLike;
  defaultModel: string;
  promptSource: StaticPromptSource;
  resolveTools?: (command: AgentExecutionContext) => Promise<ToolsInput>;
  resolveSkillInstructions?: (command: AgentExecutionContext) => Promise<string[]>;
  memory?: MastraMemory;
  modelCatalog?: ModelCatalog;
};

function estimateTokens(values: string[]): number {
  return Math.max(1, Math.ceil(values.join("\n").length / 4));
}

function asExecutor(agent: Agent): MastraAgentExecutor {
  return {
    async generate(messages, options) {
      // system 消息已参与 definition 装配，避免在对话历史中重复发送。
      const output = await agent.generate(
        messages.filter((message) => message.role !== "system") as never,
        options,
      );
      return {
        runId: output.runId,
        text: output.text,
        finishReason: output.finishReason,
        totalUsage: output.totalUsage,
        toolCalls: output.toolCalls,
        toolResults: output.toolResults,
        error: output.error,
        tripwire: output.tripwire,
      };
    },
    async stream(messages, options) {
      const output = await agent.stream(
        messages.filter((message) => message.role !== "system") as never,
        options,
      );
      return {
        runId: output.runId,
        fullStream: output.fullStream as unknown as AsyncIterable<MastraAgentChunk>,
        text: output.text,
        finishReason: output.finishReason,
        totalUsage: output.totalUsage,
        error: output.error,
        tripwire: output.tripwire,
      };
    },
    abortRunStream(runId) {
      return agent.abortRunStream(runId);
    },
  };
}

/** 复用 Orbit model policy、prompt builder 与 Tool/Skill 解析结果装配 Mastra Agent。 */
export class OrbitMastraAgentExecutionResolver implements MastraAgentExecutionResolver {
  readonly sessionMemory: boolean;

  private readonly modelCatalog: ModelCatalog;

  constructor(private readonly options: ResolverOptions) {
    this.modelCatalog = options.modelCatalog ?? new ModelCatalog();
    this.sessionMemory = Boolean(options.memory);
  }

  async resolve(
    command: AgentExecutionContext,
    identity: MastraAgentMemoryIdentity,
  ): Promise<MastraAgentResolution> {
    const [tools, skillInstructions] = await Promise.all([
      this.options.resolveTools?.(command) ?? Promise.resolve({}),
      command.skillBindings !== undefined
        ? Promise.resolve().then(() => resolveVersionSkillInstructions(command))
        : (this.options.resolveSkillInstructions?.(command) ?? Promise.resolve([])),
    ]);
    const missingTools = command.policy.allowedToolIds.filter((id) => !(id in tools));
    if (missingTools.length) throw new Error(`Agent 工具不可用：${missingTools.join(", ")}`);
    const systemMessages = command.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content);
    const thread =
      command.memory === false
        ? null
        : await this.options.memory?.getThreadById({
            threadId: identity.mastraThreadId,
          });
    if (thread && thread.resourceId !== identity.mastraResourceId)
      throw new Error("Agent Memory thread 与 resource 不匹配。");
    const compactSummary =
      typeof thread?.metadata?.contextSummary === "string"
        ? thread.metadata.contextSummary
        : undefined;
    // 固定版本的职责和输出约束定义独立 Agent，不能叠加宿主 CLI 的编码身份与默认能力提示。
    const envelope = buildPromptEnvelope(
      systemMessages.length
        ? {
            core: systemMessages.join("\n\n"),
            tools: [],
            skills: skillInstructions,
            rules: [],
            compactSummary,
          }
        : {
            ...this.options.promptSource,
            skills: [...this.options.promptSource.skills, ...skillInstructions],
            compactSummary,
          },
    );
    const instructions = [
      envelope.primarySystemPrompt,
      ...envelope.supplementalSystemMessages,
    ].filter(Boolean);
    const estimatedPromptTokens = estimateTokens([
      ...instructions,
      ...command.messages
        .filter((message) => message.role !== "system")
        .map((message) => message.content),
    ]);
    const preferredModel = command.modelId?.trim() || this.options.defaultModel;
    const selection = await this.options.modelPolicyService.selectModel(
      "coding",
      preferredModel,
      estimatedPromptTokens,
    );
    if (selection.budgetAction === "deny")
      throw new Error(`模型预算拒绝执行：${selection.budgetReason ?? "budget denied"}`);
    if (command.modelId && selection.model !== preferredModel)
      throw new Error(
        `模型策略选择了 ${selection.model}，与 Agent 配置的 ${preferredModel} 不一致；请调整模型配置或系统策略。`,
      );
    const resolvedModel = await resolveMastraModel(selection.model, this.modelCatalog, {
      tools: command.policy.allowedToolIds.length > 0,
    });
    const registered = this.options.registry.resolve({
      agentId: command.agentId,
      agentVersion: command.agentVersion,
      name: command.agentId,
      instructions,
      model: resolvedModel.model,
      modelConfigKey: resolvedModel.modelConfigKey,
      tools,
      toolIds: command.policy.allowedToolIds,
      skillIds: command.policy.allowedSkillIds,
      memory: command.memory === false ? undefined : this.options.memory,
    });
    const requestContext = new RequestContext();
    for (const [key, value] of Object.entries(command.requestContext))
      requestContext.set(key, value);
    requestContext.set("orbitAgentId", command.agentId);
    requestContext.set("orbitAgentVersion", command.agentVersion);
    requestContext.set(
      ORBIT_OWNER_ID_KEY,
      typeof command.requestContext.ownerId === "string"
        ? command.requestContext.ownerId
        : command.resourceId,
    );
    requestContext.set(ORBIT_EXECUTOR_KIND_KEY, "agent");
    requestContext.set(ORBIT_SESSION_ID_KEY, command.sessionId);
    requestContext.set(MASTRA_RESOURCE_ID_KEY, identity.mastraResourceId);
    requestContext.set(MASTRA_THREAD_ID_KEY, identity.mastraThreadId);
    const activeTools = command.policy.allowedToolIds.filter((toolId) => toolId in tools);

    return {
      executor: asExecutor(registered.agent),
      executionOptions: {
        requestContext,
        activeTools,
        providerOptions: resolvedModel.providerOptions,
        memory:
          this.sessionMemory && command.memory !== false
            ? { resource: identity.mastraResourceId, thread: identity.mastraThreadId }
            : undefined,
      },
      finalizeUsage: async (usage, latencyMs) => {
        await this.options.modelPolicyService.finalizeUsage({
          promptTokens: usage.inputTokens ?? 0,
          completionTokens: usage.outputTokens ?? 0,
          model: selection.model,
          role: "coding",
          latencyMs,
          fallbackUsed: selection.model !== this.options.defaultModel,
        });
      },
    };
  }
}
