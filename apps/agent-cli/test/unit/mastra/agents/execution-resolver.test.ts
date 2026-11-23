import { ModelCatalog } from "../../../../src/mastra/models/model-catalog.js";
import { describe, expect, it, vi } from "vitest";
import type { GenerateAgentCommand } from "@orbit/runtime-contracts";
import { MastraAgentDefinitionRegistry } from "../../../../src/mastra/agents/definition-registry.js";
import { OrbitMastraAgentExecutionResolver } from "../../../../src/mastra/agents/execution-resolver.js";

const command: GenerateAgentCommand = {
  agentId: "agent-1",
  agentVersion: "version-7",
  sessionId: "session-1",
  resourceId: "resource-1",
  threadId: "thread-1",
  messages: [{ role: "user", content: "hello" }],
  requestContext: { tenantId: "tenant-1", apiKey: "request-secret" },
  policy: {
    allowedToolIds: ["read_file"],
    allowedSkillIds: ["review"],
  },
};

describe("mastra/agents/execution-resolver", () => {
  it("显式 Agent 职责替代宿主编码身份，且不继承未绑定的工具、技能与规则提示", async () => {
    const resolve = vi.fn((_definition: { instructions: string[] }) => ({ agent: {} }));
    const resolveSkillInstructions = vi.fn(async () => ["宿主会话技能"]);
    const resolver = new OrbitMastraAgentExecutionResolver({
      registry: { resolve } as never,
      modelPolicyService: {
        selectModel: vi.fn(async (_role, model) => ({ model })),
        selectFallbackModel: vi.fn(), finalizeUsage: vi.fn(),
      } as never,
      defaultModel: "translator",
      modelCatalog: new ModelCatalog({ env: { OPENAI_API_KEY: "test-only" } }),
      promptSource: {
        core: "You are a coding agent.", tools: ["Use todo."],
        skills: ["宿主默认技能"], rules: ["宿主编码规则"],
      },
      resolveSkillInstructions,
    });
    await resolver.resolve({
      ...command,
      skillBindings: [],
      policy: { allowedToolIds: [], allowedSkillIds: [] },
      messages: [
        { role: "system", content: "你是翻译 Agent。" },
        { role: "system", content: "请输出 JSON。" },
        { role: "user", content: "Hello" },
      ],
    }, { mastraResourceId: "r", mastraThreadId: "t" });
    const instructions = resolve.mock.calls[0]![0].instructions.join("\n");
    expect(instructions).toContain("你是翻译 Agent。");
    expect(instructions).toContain("请输出 JSON。");
    expect(instructions).not.toMatch(/coding|todo|宿主/);
    expect(resolveSkillInstructions).not.toHaveBeenCalled();
  });

  it("复用 model policy、prompt builder、Tool/Skill resolver 和 Memory identity 装配 Mastra Agent", async () => {
    let capturedDefinition: Record<string, unknown> | undefined;
    const fakeAgent = {
      generate: vi.fn(),
      stream: vi.fn(),
      abortRunStream: vi.fn(),
    };
    const registry = new MastraAgentDefinitionRegistry({
      mastra: { addAgent: vi.fn() },
      createAgent: (input) => {
        capturedDefinition = input as unknown as Record<string, unknown>;
        return fakeAgent as never;
      },
    });
    const selectModel = vi.fn().mockResolvedValue({ model: "selected-model", fallbackUsed: false });
    const finalizeUsage = vi.fn().mockResolvedValue(undefined);
    const resolver = new OrbitMastraAgentExecutionResolver({
      registry,
      modelPolicyService: {
        selectModel,
        selectFallbackModel: vi.fn().mockResolvedValue(null),
        finalizeUsage,
      },
      defaultModel: "default-model",
      promptSource: {
        core: "Core instruction",
        tools: ["Use governed tools"],
        skills: [],
        rules: ["Never leak secrets"],
      },
      resolveTools: vi.fn().mockResolvedValue({ read_file: { id: "read_file" } }),
      resolveSkillInstructions: vi.fn().mockResolvedValue(["Review skill instruction"]),
      memory: { getThreadById: vi.fn(async () => null) } as never,
      modelCatalog: new ModelCatalog({ env: { OPENAI_BASE_URL: "https://models.example/v1", OPENAI_API_KEY: "model-secret" } }),
    });

    const resolved = await resolver.resolve(command, {
      mastraResourceId: "mastra-resource-1",
      mastraThreadId: "mastra-thread-1",
    });

    expect(selectModel).toHaveBeenCalledWith("coding", "default-model", expect.any(Number));
    expect(capturedDefinition).toMatchObject({
      agentId: "agent-1",
      agentVersion: "version-7",
      model: {
        provider: "openai-compatible.chat",
        modelId: "selected-model",
      },
      modelConfigKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      toolIds: ["read_file"],
      skillIds: ["review"],
    });
    expect((capturedDefinition?.instructions as string[]).join("\n")).toContain("Core instruction");
    expect((capturedDefinition?.instructions as string[]).join("\n")).toContain("Review skill instruction");
    expect(resolved.executionOptions.memory).toEqual({
      resource: "mastra-resource-1",
      thread: "mastra-thread-1",
    });
    expect(resolved.executionOptions.activeTools).toEqual(["read_file"]);
    expect(resolved.executionOptions.requestContext.get("tenantId")).toBe("tenant-1");
    expect(resolved.executionOptions.requestContext.get("orbitAgentId")).toBe("agent-1");

    await resolved.finalizeUsage({ inputTokens: 3, outputTokens: 2, totalTokens: 5 }, 25);
    expect(finalizeUsage).toHaveBeenCalledWith(expect.objectContaining({
      promptTokens: 3,
      completionTokens: 2,
      model: "selected-model",
      role: "coding",
      latencyMs: 25,
    }));
  });
  it("显式模型进入策略，工具缺失、模型冲突或预算拒绝都不能静默继续", async () => {
    const registry = { resolve: vi.fn(() => ({ agent: {} })) };
    const selectModel = vi.fn(async (_role, preferred) => ({ model: preferred, budgetAction: "allow" }));
    const options = {
      registry: registry as never,
      modelPolicyService: { selectModel, finalizeUsage: vi.fn(), selectFallbackModel: vi.fn() } as never,
      modelCatalog: new ModelCatalog({ env: { OPENAI_API_KEY: "test-only" } }),
      defaultModel: "default", promptSource: { core: "core", tools: [], skills: [], rules: [] },
      resolveTools: vi.fn(async () => ({ read_file: {} })),
    };
    const resolver = new OrbitMastraAgentExecutionResolver(options);
    const identity = { mastraResourceId: "r", mastraThreadId: "t" };
    await resolver.resolve({ ...command, modelId: "configured-model", skillBindings: [], policy: { allowedToolIds: ["read_file"], allowedSkillIds: [] } }, identity);
    expect(selectModel).toHaveBeenCalledWith("coding", "configured-model", expect.any(Number));
    expect(registry.resolve).toHaveBeenCalledWith(expect.objectContaining({ model: expect.objectContaining({ modelId: "configured-model" }) }));
    await expect(resolver.resolve({ ...command, policy: { ...command.policy, allowedToolIds: ["missing"] } }, identity)).rejects.toThrow("工具不可用");
    selectModel.mockResolvedValueOnce({ model: "another", budgetAction: "allow" });
    await expect(resolver.resolve({ ...command, modelId: "configured-model", skillBindings: [] }, identity)).rejects.toThrow("不一致");
    selectModel.mockResolvedValueOnce({ model: "configured-model", budgetAction: "deny" });
    await expect(resolver.resolve({ ...command, modelId: "configured-model", skillBindings: [] }, identity)).rejects.toThrow("预算拒绝");
  });

});
