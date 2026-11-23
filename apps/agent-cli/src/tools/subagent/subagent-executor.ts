import { randomUUID } from "node:crypto";
import { createTool } from "@mastra/core/tools";
import type { PublicSchema } from "@mastra/core/schema";
import { MODEL } from "../../config/config.js";
import { RUNTIME_CONFIG } from "../../config/runtime-config.js";
import { classifyFallbackableError } from "../../models/model-policy.js";
import { ModelCatalog } from "../../mastra/models/model-catalog.js";
import { resolveMastraModel } from "../../mastra/models/model-resolver.js";
import { getOrCreateMastraRuntime } from "../../mastra/instance/factory.js";
import { MastraAgentDefinitionRegistry } from "../../mastra/agents/definition-registry.js";
import {
  DEFAULT_MODEL_POLICY_SERVICE,
  type ModelPolicyServiceLike,
} from "../../services/model-policy-service.js";
import { BASE_TOOLS, runBaseToolByName } from "../base.js";
import type { SubagentExecutionResult } from "./subagent-types.js";

/** 子 Agent 执行边界；测试和管理器可注入确定性执行器。 */
export type SubagentExecutorLike = {
  execute(prompt: string, traceId?: string): Promise<SubagentExecutionResult>;
};

/** 将已有子 Agent 工具接入共享 Mastra，复用统一供应商协议与模型策略。 */
export class SubagentExecutor implements SubagentExecutorLike {
  constructor(
    private readonly options: {
      modelCatalog?: ModelCatalog;
      modelPolicyService?: ModelPolicyServiceLike;
      registry?: MastraAgentDefinitionRegistry;
      tools?: typeof BASE_TOOLS;
      runTool?: typeof runBaseToolByName;
    } = {},
  ) {}

  async execute(prompt: string, traceId?: string): Promise<SubagentExecutionResult> {
    try {
      const policy = this.options.modelPolicyService ?? DEFAULT_MODEL_POLICY_SERVICE;
      const estimatedPromptTokens = Math.ceil(prompt.length / 4);
      const selection = await policy.selectModel("ops", MODEL, estimatedPromptTokens);
      if (selection.budgetAction === "deny")
        return {
          status: "failed",
          error: `MODEL_BUDGET_DENIED:${selection.budgetReason ?? "budget exceeded"}`,
        };
      const catalog = this.options.modelCatalog ?? new ModelCatalog();
      const registry =
        this.options.registry ??
        new MastraAgentDefinitionRegistry({ mastra: (await getOrCreateMastraRuntime()).mastra });
      const runTool = this.options.runTool ?? runBaseToolByName;
      const tools = Object.fromEntries(
        (this.options.tools ?? BASE_TOOLS).flatMap((tool) => {
          if (tool.type !== "function") return [];
          const definition = tool.function;
          return [
            [
              definition.name,
              createTool({
                id: definition.name,
                description: definition.description ?? definition.name,
                inputSchema: (definition.parameters ?? {
                  type: "object",
                  properties: {},
                }) as PublicSchema,
                execute: async (input) => runTool(definition.name, JSON.stringify(input)),
              }),
            ],
          ];
        }),
      );
      const execute = async (model: string) => {
        const resolved = await resolveMastraModel(model, catalog, {
          tools: Object.keys(tools).length > 0,
        });
        const registered = registry.resolve({
          agentId: "subagent-worker",
          agentVersion: "1",
          name: "Worker",
          instructions: [
            "You are a focused worker agent. Use tools when needed and return concise factual results.",
          ],
          model: resolved.model,
          modelConfigKey: resolved.modelConfigKey,
          tools,
          toolIds: Object.keys(tools),
          skillIds: [],
        });
        const result = await registered.agent.generate(prompt, {
          runId: randomUUID(),
          maxSteps: RUNTIME_CONFIG.subagentMaxRounds,
          modelSettings: { maxOutputTokens: RUNTIME_CONFIG.subagentMaxTokens },
          providerOptions: resolved.providerOptions,
        });
        if (result.error) throw result.error;
        return result;
      };
      const startedAt = Date.now();
      let model = selection.model;
      let fallbackUsed = selection.budgetAction === "downgrade";
      let output;
      try {
        output = await execute(model);
      } catch (error) {
        if (!selection.fallbackModel || !classifyFallbackableError(error)) throw error;
        model = selection.fallbackModel;
        fallbackUsed = true;
        output = await execute(model);
      }
      await policy.finalizeUsage(
        {
          role: "ops",
          model,
          promptTokens: output.totalUsage.inputTokens ?? estimatedPromptTokens,
          completionTokens: output.totalUsage.outputTokens ?? 0,
          latencyMs: Date.now() - startedAt,
          fallbackUsed,
        },
        traceId,
      );
      if (output.finishReason === "tool-calls")
        return { status: "failed", error: "SUBAGENT_MAX_ROUNDS_EXCEEDED" };
      return { status: "completed", output: output.text };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }
}
