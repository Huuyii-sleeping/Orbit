import { isTerminalWorkflowRunStatus } from "@orbit/workflow-core";
import { createAgentTestWorkflow, createTestAgentVersion } from "../fixtures/agent-workflow.js";
import { MastraWorkflowRuntimeAdapter } from "../../src/mastra/adapters/workflow-runtime-adapter.js";
import { MastraWorkflowCompilerAdapter } from "../../src/mastra/workflows/compiler-adapter.js";
import { MastraWorkflowAgentNodeExecutor } from "../../src/mastra/workflows/agent-node-executor.js";
import { createBuiltinWorkflowExecutorRegistry } from "../../src/workflows/executors/index.js";
import { randomUUID } from "node:crypto";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { MODEL } from "../../src/config/config.js";
import { ModelCatalog } from "../../src/mastra/models/model-catalog.js";
import { MastraAgentDefinitionRegistry } from "../../src/mastra/agents/definition-registry.js";
import { OrbitMastraAgentExecutionResolver } from "../../src/mastra/agents/execution-resolver.js";
import { MastraAgentRuntimeAdapter } from "../../src/mastra/adapters/agent-runtime-adapter.js";
import type { GenerateAgentCommand, AgentRunResult } from "@orbit/runtime-contracts";
import type { ModelPolicyServiceLike } from "../../src/services/model-policy-service.js";

// 显式执行才调用云模型；使用内存存储，不改变生产草稿、会话或预算文件。
const references = process.argv.slice(2).length ? process.argv.slice(2) : [MODEL];
const mastra = new Mastra({
  storage: new InMemoryStore({ id: randomUUID() }),
  logger: new ConsoleLogger({ name: "live-model-test", level: LogLevel.ERROR }),
});
const modelCatalog = new ModelCatalog();
const modelPolicyService: ModelPolicyServiceLike = {
  selectModel: async (_role, model) => ({
    model,
    role: "coding",
    fallbackModel: null,
    budgetAction: "allow",
    budgetReason: null,
    estimatedPromptTokens: 0,
    estimatedPromptCostUsd: 0,
  }),
  selectFallbackModel: async () => null,
  finalizeUsage: async () => {},
};
let failures = 0;
try {
  const resolver = new OrbitMastraAgentExecutionResolver({
    registry: new MastraAgentDefinitionRegistry({ mastra }),
    modelCatalog,
    modelPolicyService,
    defaultModel: MODEL,
    promptSource: {
      core: "Follow user instructions exactly. Return a JSON object without markdown.",
      tools: [],
      skills: [],
      rules: [],
    },
    resolveTools: async () => ({
      echo: createTool({
        id: "echo",
        description: "Return the requested value. Use this tool when asked to echo.",
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => ({ value }),
      }),
    }),
  });
  const port = new MastraAgentRuntimeAdapter({ resolver, persistenceEnabled: false });
  for (const modelId of references) {
    const command: GenerateAgentCommand = {
      agentId: "live-test",
      agentVersion: "1",
      modelId,
      sessionId: randomUUID(),
      resourceId: "isolated-test",
      threadId: randomUUID(),
      messages: [{ role: "user", content: 'Return exactly {"text":"live-ok"}.' }],
      requestContext: { ownerId: "isolated-test" },
      policy: { allowedToolIds: [], allowedSkillIds: [] },
    };
    async function run(kind: "generate" | "tools") {
      const runId = randomUUID();
      const timer = setTimeout(() => {
        void port.cancel({ runId, reason: "live test timeout" });
      }, 40_000);
      const startedAt = Date.now();
      try {
        let result: AgentRunResult | undefined;
        if (kind === "generate") result = await port.generate({ ...command, runId });
        else
          for await (const event of port.stream({
            ...command,
            runId,
            sessionId: randomUUID(),
            threadId: randomUUID(),
            messages: [
              {
                role: "user",
                content:
                  'Call echo with value "live-tool-ok" once, then return {"text":"live-tool-ok"}.',
              },
            ],
            policy: { allowedToolIds: ["echo"], allowedSkillIds: [] },
          })) {
            if (event.type === "run.final") result = event.result;
          }
        const valid =
          result?.status === "succeeded" &&
          JSON.parse(result.text).text === (kind === "generate" ? "live-ok" : "live-tool-ok") &&
          (kind !== "tools" ||
            result.toolExecutions.some(
              (tool) => tool.toolId === "echo" && tool.status === "succeeded",
            ));
        console.log(
          JSON.stringify({
            modelId,
            test: kind,
            status: valid ? "passed" : "failed",
            elapsedMs: Date.now() - startedAt,
            text: result?.text,
            usage: result?.usage,
            toolExecutions: result?.toolExecutions,
            error: result?.error,
          }),
        );
        if (!valid) failures++;
        return valid;
      } catch (error) {
        failures++;
        console.log(
          JSON.stringify({
            modelId,
            test: kind,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return false;
      } finally {
        clearTimeout(timer);
      }
    }
    if (await run("generate")) {
      await run("tools");
      const versions = ["extract", "analyze", "report"].map((id) =>
        createTestAgentVersion(id, modelId),
      );
      const executors = createBuiltinWorkflowExecutorRegistry().register(
        new MastraWorkflowAgentNodeExecutor({
          runtime: port,
          resolveVersion: (id, versionId) =>
            versions.find((version) => version.agentProfileId === id && version.id === versionId),
        }),
      );
      const workflow = new MastraWorkflowRuntimeAdapter({
        compiler: new MastraWorkflowCompilerAdapter({ mastra, executors }),
        persistenceEnabled: false,
      });
      const startedAt = Date.now();
      const sop = await workflow.start({
        workflow: createAgentTestWorkflow(versions, "Return JSON"),
        agentDependencies: versions,
        mode: "draft",
        requestContext: { ownerId: "isolated-test" },
      });
      const timeout = setTimeout(() => {
        void workflow.cancel(sop.id);
      }, 60_000);
      try {
        for await (const event of workflow.events({ runId: sop.id }))
          if (event.type === "run.status" && isTerminalWorkflowRunStatus(event.status)) break;
        const result = await workflow.get(sop.id);
        const valid =
          result?.status === "succeeded" &&
          JSON.stringify(result.output) === '{"result":{"text":"adapter-ok"}}';
        console.log(
          JSON.stringify({
            modelId,
            test: "three-agent-sop",
            status: valid ? "passed" : "failed",
            elapsedMs: Date.now() - startedAt,
            output: result?.output,
            nodeStatuses: Object.fromEntries(
              Object.entries(result?.nodeRuns ?? {}).map(([id, node]) => [id, node.status]),
            ),
            error: result?.error,
          }),
        );
        if (!valid) failures++;
      } finally {
        clearTimeout(timeout);
      }
    }
  }
} finally {
  await mastra.shutdown();
}
if (failures) process.exitCode = 1;
