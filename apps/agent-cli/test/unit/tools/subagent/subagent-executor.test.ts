import { describe, expect, it, vi } from "vitest";
import { ModelCatalog } from "../../../../src/mastra/models/model-catalog.js";
import { MastraAgentDefinitionRegistry } from "../../../../src/mastra/agents/definition-registry.js";
import { SubagentExecutor } from "../../../../src/tools/subagent/subagent-executor.js";

function fixture() {
  const generate = vi.fn(async () => ({
    text: "done",
    finishReason: "stop",
    totalUsage: { inputTokens: 8, outputTokens: 4 },
  }));
  const createAgent = vi.fn(() => ({ generate }) as never);
  const policy = {
    selectModel: vi.fn(async () => ({
      model: "local/main",
      fallbackModel: "local/backup",
      budgetAction: "allow",
      budgetReason: null,
    })),
    finalizeUsage: vi.fn(),
    selectFallbackModel: vi.fn(),
  };
  const runTool = vi.fn(async () => "tool output");
  const executor = new SubagentExecutor({
    registry: new MastraAgentDefinitionRegistry({ mastra: { addAgent: vi.fn() }, createAgent }),
    modelPolicyService: policy as never,
    modelCatalog: new ModelCatalog({
      env: {},
      config: {
        providers: { local: { provider: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1" } },
      },
    }),
    tools: [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "read",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      },
    ],
    runTool,
  });
  return { executor, generate, createAgent, policy, runTool };
}

describe("tools/subagent/subagent-executor", () => {
  it("委托给 Mastra，传递工具、轮数、用量和 trace", async () => {
    const { executor, generate, createAgent, policy, runTool } = fixture();
    expect(await executor.execute("finish this", "trace-1")).toEqual({
      status: "completed",
      output: "done",
    });
    expect(generate).toHaveBeenCalledWith(
      "finish this",
      expect.objectContaining({
        maxSteps: expect.any(Number),
        modelSettings: { maxOutputTokens: expect.any(Number) },
      }),
    );
    const definition = createAgent.mock.calls[0]![0] as never as {
      tools: Record<string, { execute(input: unknown): Promise<unknown> }>;
    };
    expect(await definition.tools.read_file.execute({ path: "README.md" })).toBe("tool output");
    expect(runTool).toHaveBeenCalledWith("read_file", '{"path":"README.md"}');
    expect(policy.finalizeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "local/main",
        promptTokens: 8,
        completionTokens: 4,
        fallbackUsed: false,
      }),
      "trace-1",
    );
  });

  it("预算拒绝不执行模型，轮数耗尽不能伪装成功", async () => {
    const { executor, generate, policy } = fixture();
    policy.selectModel.mockResolvedValueOnce({
      model: "local/main",
      fallbackModel: null,
      budgetAction: "deny",
      budgetReason: "daily_budget_exceeded",
    } as never);
    expect(await executor.execute("blocked")).toEqual({
      status: "failed",
      error: "MODEL_BUDGET_DENIED:daily_budget_exceeded",
    });
    expect(generate).not.toHaveBeenCalled();
    generate.mockResolvedValueOnce({
      text: "",
      finishReason: "tool-calls",
      totalUsage: {},
    } as never);
    expect(await executor.execute("too many steps")).toEqual({
      status: "failed",
      error: "SUBAGENT_MAX_ROUNDS_EXCEEDED",
    });
  });

  it("可重试错误按配置选择备用模型，其他错误明确失败", async () => {
    const { executor, generate, createAgent, policy } = fixture();
    generate.mockRejectedValueOnce(Object.assign(new Error("rate limit"), { status: 429 }));
    expect(await executor.execute("retry")).toEqual({ status: "completed", output: "done" });
    expect(createAgent).toHaveBeenCalledTimes(2);
    expect(policy.finalizeUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: "local/backup", fallbackUsed: true }),
      undefined,
    );
    generate.mockRejectedValueOnce(new Error("invalid model"));
    expect(await executor.execute("bad model")).toEqual({
      status: "failed",
      error: "invalid model",
    });
  });
});
