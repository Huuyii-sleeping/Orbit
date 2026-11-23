import { randomUUID } from "node:crypto";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { expect, it, vi } from "vitest";
import type { GenerateAgentCommand, AgentRuntimeEvent } from "@orbit/runtime-contracts";
import { ModelCatalog } from "../../src/mastra/models/model-catalog.js";
import { MastraAgentDefinitionRegistry } from "../../src/mastra/agents/definition-registry.js";
import { OrbitMastraAgentExecutionResolver } from "../../src/mastra/agents/execution-resolver.js";
import { MastraAgentRuntimeAdapter } from "../../src/mastra/adapters/agent-runtime-adapter.js";
import { OrbitMastraWorkflowAgentResolver } from "../../src/mastra/workflows/agent-step-resolver.js";
import { startModelProvider } from "../fixtures/model-provider.js";

it("同一 Mastra 实例交替执行 CLI 与卡片时，身份和工具权限不会相互污染", async () => {
  const provider = await startModelProvider();
  const mastra = new Mastra({
    storage: new InMemoryStore({ id: randomUUID() }),
    logger: new ConsoleLogger({ name: "cli-card-isolation", level: LogLevel.ERROR }),
  });
  const execute = vi.fn(async ({ value }: { value: string }) => ({ text: value }));
  const resolver = new OrbitMastraAgentExecutionResolver({
    registry: new MastraAgentDefinitionRegistry({ mastra }),
    modelCatalog: new ModelCatalog({
      env: { OPENAI_API_KEY: "fixture-only", OPENAI_BASE_URL: provider.baseUrl },
    }),
    modelPolicyService: {
      selectModel: vi.fn(async (_role, model) => ({ model, budgetAction: "allow" as const })),
      selectFallbackModel: vi.fn(), finalizeUsage: vi.fn(),
    },
    defaultModel: "fixture-model",
    promptSource: { core: "HOST_CLI_ROLE", tools: ["HOST_TOOL_GUIDANCE"], skills: [], rules: [] },
    resolveTools: async () => ({ echo: createTool({
      id: "echo", description: "Echo", inputSchema: z.object({ value: z.string() }), execute,
    }) }),
  });
  const runtime = new MastraAgentRuntimeAdapter({ resolver, persistenceEnabled: false });
  const command: GenerateAgentCommand = {
    agentId: "same-agent", agentVersion: "same-version", sessionId: "cli", resourceId: "test",
    threadId: "cli", messages: [{ role: "user", content: "Hello" }], requestContext: { ownerId: "test" },
    policy: { allowedToolIds: ["echo"], allowedSkillIds: [] },
  };
  try {
    for (const kind of ["cli", "card", "cli", "card"]) {
      const before = provider.requests.length;
      const result = await runtime.generate(kind === "cli" ? command : {
        ...command, sessionId: "card", threadId: "card", skillBindings: [],
        messages: [{ role: "system", content: "CARD_TRANSLATOR_ROLE" }, ...command.messages],
        policy: { allowedToolIds: [], allowedSkillIds: [] },
      });
      expect(result.status).toBe("succeeded");
      const requests = provider.requests.slice(before);
      expect(requests).toHaveLength(kind === "cli" ? 2 : 1);
      for (const request of requests) {
        const serialized = JSON.stringify(request.body);
        expect(serialized).toContain(kind === "cli" ? "HOST_CLI_ROLE" : "CARD_TRANSLATOR_ROLE");
        expect(serialized).not.toContain(kind === "cli" ? "CARD_TRANSLATOR_ROLE" : "HOST_CLI_ROLE");
        if (kind === "card") expect(request.body.tools ?? []).toHaveLength(0);
      }
    }
    expect(execute).toHaveBeenCalledTimes(2);
  } finally {
    await mastra.shutdown();
    await provider.close();
  }
}, 15_000);

for (const protocol of ["openai-chat", "openai-responses", "anthropic", "google", "deepseek"] as const) {
  it(`${protocol}：真实 SDK + Mastra Agent 通过生成、流式工具往返和 SOP LLM 节点`, async () => {
    const provider = await startModelProvider();
    const modelCatalog = new ModelCatalog({
      env: { TEST_MODEL_KEY: "fixture-secret" },
      config: {
        providers: {
          fixture: { provider: protocol === "openai-chat" ? "openai-compatible" : protocol === "openai-responses" ? "openai" : protocol, baseUrl: provider.baseUrl, apiKeyEnv: "TEST_MODEL_KEY" },
        },
        models: {
          worker: {
            provider: "fixture",
            modelId: "test-model",
            ...(protocol === "openai-chat"
              ? { providerOptions: { openaiCompatible: { enable_thinking: false } } }
              : {}),
          },
        },
      },
    });
    const mastra = new Mastra({
      storage: new InMemoryStore({ id: randomUUID() }),
      logger: new ConsoleLogger({ name: "multi-model", level: LogLevel.ERROR }),
    });
    const registry = new MastraAgentDefinitionRegistry({ mastra });
    const finalizeUsage = vi.fn();
    const modelPolicyService = {
      selectModel: vi.fn(async (_role, model) => ({ model, budgetAction: "allow" as const })),
      selectFallbackModel: vi.fn(),
      finalizeUsage,
    };
    const execute = vi.fn(async ({ value }: { value: string }) => ({ text: value }));
    const resolver = new OrbitMastraAgentExecutionResolver({
      registry,
      modelCatalog,
      modelPolicyService: modelPolicyService as never,
      defaultModel: "worker",
      promptSource: { core: "You are a coding agent.", tools: ["Use todo."], skills: ["HOST_SKILL"], rules: [] },
      resolveTools: async () => ({
        echo: createTool({
          id: "echo",
          description: "Echo input",
          inputSchema: z.object({ value: z.string() }),
          execute,
        }),
      }),
    });
    const port = new MastraAgentRuntimeAdapter({ resolver, persistenceEnabled: false });
    const command: GenerateAgentCommand = {
      agentId: "worker",
      agentVersion: "v1",
      modelId: "worker",
      sessionId: "standalone",
      resourceId: "test",
      threadId: "test",
      messages: [
        { role: "system", content: "TRANSLATOR_ROLE: Translate the input." },
        { role: "system", content: "Return a JSON object with a text field." },
        { role: "user", content: "Return JSON" },
      ],
      requestContext: { ownerId: "test" },
      policy: { allowedToolIds: [], allowedSkillIds: [] },
    };
    try {
      const generated = await port.generate(command);
      expect(generated).toMatchObject({
        status: "succeeded",
        text: '{"text":"adapter-ok"}',
        usage: { inputTokens: 8, outputTokens: 4 },
      });
      const generatedRequest = JSON.stringify(provider.requests.at(-1)!.body);
      expect(generatedRequest).toContain("TRANSLATOR_ROLE");
      expect(generatedRequest).not.toMatch(/coding agent|Use todo|HOST_SKILL/);
      expect(generatedRequest.match(/TRANSLATOR_ROLE/g)).toHaveLength(1);
      const events: AgentRuntimeEvent[] = [];
      for await (const event of port.stream({
        ...command,
        sessionId: "tool-session",
        threadId: "tool-thread",
        policy: { allowedToolIds: ["echo"], allowedSkillIds: [] },
      }))
        events.push(event);
      expect(events.at(-1)).toMatchObject({
        type: "run.final",
        result: { status: "succeeded", text: '{"text":"adapter-ok"}' },
      });
      expect(execute).toHaveBeenCalledOnce();
      for (const request of provider.requests.slice(1)) {
        const serialized = JSON.stringify(request.body);
        expect(serialized).toContain("TRANSLATOR_ROLE");
        expect(serialized).toContain("Return a JSON object with a text field.");
        expect(serialized).not.toMatch(/coding agent|Use todo|HOST_SKILL/);
        expect(serialized.match(/TRANSLATOR_ROLE/g)).toHaveLength(1);
      }
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "tool.call", toolId: "echo", input: { value: "hello" } }),
          expect.objectContaining({
            type: "tool.result",
            result: expect.objectContaining({ toolId: "echo", status: "succeeded" }),
          }),
          expect.objectContaining({ type: "text.delta" }),
        ]),
      );
      const llm = new OrbitMastraWorkflowAgentResolver({
        registry,
        modelCatalog,
        modelPolicyService: modelPolicyService as never,
      });
      const deltas: string[] = [];
      const output = await llm.stream({
        workflowId: "workflow",
        runId: randomUUID(),
        requestContext: { ownerId: "test" },
        prompt: "Return JSON",
        signal: new AbortController().signal,
        onDelta: (delta) => deltas.push(delta),
        node: {
          id: "llm",
          label: "LLM",
          nodeVersion: 1,
          config: { model: "worker", prompt: { kind: "literal", value: "hello" } },
        } as never,
      });
      expect(output.text).toBe('{"text":"adapter-ok"}');
      expect(deltas.join("")).toBe(output.text);
      const { SubagentExecutor } = await import("../../src/tools/subagent/subagent-executor.js");
      const worker = new SubagentExecutor({
        registry,
        modelCatalog,
        modelPolicyService: {
          ...modelPolicyService,
          selectModel: async () => ({ model: "worker", budgetAction: "allow" }),
        } as never,
        tools: [
          {
            type: "function",
            function: {
              name: "echo",
              description: "Echo",
              parameters: {
                type: "object",
                properties: { value: { type: "string" } },
                required: ["value"],
              },
            },
          },
        ],
        runTool: async (_name, args) => JSON.stringify({ text: JSON.parse(args).value }),
      });
      expect(await worker.execute("Use echo")).toEqual({
        status: "completed",
        output: '{"text":"adapter-ok"}',
      });
      expect(finalizeUsage).toHaveBeenCalledTimes(4);
      const paths = provider.requests.map((request) => request.path);
      expect(paths).toHaveLength(6);
      expect(
        paths.every(
          (path) =>
            path.includes(
              {
                "openai-chat": "/chat/completions",
                "openai-responses": "/responses",
                deepseek: "/chat/completions",
                anthropic: "/messages",
                google: "GenerateContent",
              }[protocol],
            ) ||
            (protocol === "google" && path.includes("generateContent")),
        ),
      ).toBe(true);
      if (protocol === "openai-chat")
        for (const request of provider.requests) {
          expect(request.body.enable_thinking).toBe(false);
          expect(request.body.stream_options).toBeUndefined();
        }
      for (const request of provider.requests) {
        if (protocol === "anthropic") expect(request.headers["x-api-key"]).toBe("fixture-secret");
        else if (protocol === "google")
          expect(request.headers["x-goog-api-key"]).toBe("fixture-secret");
        else expect(request.headers.authorization).toBe("Bearer fixture-secret");
      }
      provider.state.statusCode = 403;
      const failed: AgentRuntimeEvent[] = [];
      for await (const event of port.stream({ ...command, runId: randomUUID() }))
        failed.push(event);
      expect(failed.at(-1)).toMatchObject({
        type: "run.final",
        result: { status: "failed", error: { message: "fixture unavailable" } },
      });
      provider.state.statusCode = 200;
      expect(await port.generate(command)).toMatchObject({ status: "succeeded" });
      provider.state.hold = true;
      const before = provider.requests.length;
      const runId = randomUUID();
      const cancelled: AgentRuntimeEvent[] = [];
      const pending = (async () => {
        for await (const event of port.stream({ ...command, runId })) cancelled.push(event);
      })();
      await vi.waitFor(() => expect(provider.requests.length).toBeGreaterThan(before));
      await port.cancel({ runId });
      await pending;
      expect(cancelled.at(-1)).toMatchObject({
        type: "run.final",
        result: { status: "cancelled" },
      });
    } finally {
      await mastra.shutdown();
      await provider.close();
    }
  }, 15_000);
}

it("四种供应商协议的 Agent 可以在同一 SOP 中串行执行并传递结构化结果", async () => {
  const { MastraWorkflowRuntimeAdapter } =
    await import("../../src/mastra/adapters/workflow-runtime-adapter.js");
  const { MastraWorkflowCompilerAdapter } =
    await import("../../src/mastra/workflows/compiler-adapter.js");
  const { MastraWorkflowAgentNodeExecutor } =
    await import("../../src/mastra/workflows/agent-node-executor.js");
  const { createBuiltinWorkflowExecutorRegistry } =
    await import("../../src/workflows/executors/index.js");
  const { createAgentTestWorkflow, createTestAgentVersion } =
    await import("../fixtures/agent-workflow.js");
  const { isTerminalWorkflowRunStatus } = await import("@orbit/workflow-core");
  const provider = await startModelProvider();
  const protocols = ["openai-chat", "openai-responses", "anthropic", "google"];
  const modelCatalog = new ModelCatalog({
    env: { TEST_KEY: "fixture-secret" },
    config: {
      providers: Object.fromEntries(
        protocols.map((protocol) => [
          protocol,
          { provider: protocol === "openai-chat" ? "openai-compatible" : protocol === "openai-responses" ? "openai" : protocol, baseUrl: provider.baseUrl, apiKeyEnv: "TEST_KEY" },
        ]),
      ),
    },
  });
  const mastra = new Mastra({
    storage: new InMemoryStore({ id: randomUUID() }),
    logger: new ConsoleLogger({ name: "multi-model-sop", level: LogLevel.ERROR }),
  });
  const modelPolicyService = {
    selectModel: vi.fn(async (_role, model) => ({ model, budgetAction: "allow" })),
    selectFallbackModel: vi.fn(),
    finalizeUsage: vi.fn(),
  };
  const resolver = new OrbitMastraAgentExecutionResolver({
    registry: new MastraAgentDefinitionRegistry({ mastra }),
    modelCatalog,
    modelPolicyService: modelPolicyService as never,
    defaultModel: "unused",
    promptSource: { core: "HOST_CODING_IDENTITY", tools: ["HOST_TOOL_GUIDANCE"], skills: [], rules: [] },
  });
  const port = new MastraAgentRuntimeAdapter({ resolver, persistenceEnabled: false });
  const versions = protocols.map((protocol) => ({
    ...createTestAgentVersion(protocol, `${protocol}/test-model`),
    instructions: [`AGENT_ROLE_${protocol}: Return JSON.`],
  }));
  const executors = createBuiltinWorkflowExecutorRegistry().register(
    new MastraWorkflowAgentNodeExecutor({
      runtime: port,
      resolveVersion: (id, versionId) =>
        versions.find((version) => version.agentProfileId === id && version.id === versionId),
    }),
  );
  const runtime = new MastraWorkflowRuntimeAdapter({
    compiler: new MastraWorkflowCompilerAdapter({ mastra, executors }),
    persistenceEnabled: false,
  });
  try {
    const run = await runtime.start({
      workflow: createAgentTestWorkflow(versions, "Return JSON"),
      agentDependencies: versions,
      mode: "draft",
      requestContext: { ownerId: "test" },
    });
    for await (const event of runtime.events({ runId: run.id }))
      if (event.type === "run.status" && isTerminalWorkflowRunStatus(event.status)) break;
    const result = await runtime.get(run.id);
    expect(result).toMatchObject({
      status: "succeeded",
      output: { result: { text: "adapter-ok" } },
    });
    expect(provider.requests).toHaveLength(4);
    expect(provider.requests.map((request) => request.path)).toEqual([
      expect.stringContaining("/chat/completions"),
      expect.stringContaining("/responses"),
      expect.stringContaining("/messages"),
      expect.stringContaining("streamGenerateContent"),
    ]);
    for (const request of provider.requests.slice(1))
      expect(JSON.stringify(request.body)).toContain("adapter-ok");
    for (const [index, request] of provider.requests.entries()) {
      const serialized = JSON.stringify(request.body);
      expect(serialized).toContain(versions[index]!.instructions[0]);
      expect(serialized).toContain("Return a JSON object matching this output schema.");
      expect(serialized).not.toMatch(/HOST_CODING_IDENTITY|HOST_TOOL_GUIDANCE/);
      for (const other of versions.filter((_, otherIndex) => index !== otherIndex))
        expect(serialized).not.toContain(other.instructions[0]);
    }
  } finally {
    await mastra.shutdown();
    await provider.close();
  }
}, 15_000);
