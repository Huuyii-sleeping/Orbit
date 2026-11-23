import { ModelCatalog } from "../../src/mastra/models/model-catalog.js";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";
import type { AgentRuntimeEvent } from "@orbit/runtime-contracts";
import { expect, it, vi } from "vitest";
import { MastraAgentDefinitionRegistry } from "../../src/mastra/agents/definition-registry.js";
import { OrbitMastraAgentExecutionResolver } from "../../src/mastra/agents/execution-resolver.js";
import { MastraAgentRuntimeAdapter } from "../../src/mastra/adapters/agent-runtime-adapter.js";
import { createOrbitMastraMemory } from "../../src/mastra/memory/factory.js";

it("模型返回额度耗尽时收敛失败，后续请求仍能执行且没有未处理的拒绝", async () => {
  let unavailable = true;
  const provider = createServer((request, response) => {
    request.resume();
    if (unavailable) {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: {
        message: "Free quota exhausted.", type: "AllocationQuota.FreeTierOnly",
        code: "AllocationQuota.FreeTierOnly",
      } }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const choice of [
      { delta: { role: "assistant", content: "provider recovered" }, finish_reason: null },
      { delta: {}, finish_reason: "stop" },
    ]) response.write(`data: ${JSON.stringify({
      id: "test-response", object: "chat.completion.chunk", created: 1,
      model: "test-model", choices: [{ index: 0, ...choice }],
    })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("Provider did not start");
  const storage = new LibSQLStore({ id: "provider-failure", url: ":memory:" });
  await storage.init();
  const memory = createOrbitMastraMemory(storage);
  const mastra = new Mastra({
    storage,
    logger: new ConsoleLogger({ name: "provider-failure", level: LogLevel.ERROR }),
  });
  const resolver = new OrbitMastraAgentExecutionResolver({
    registry: new MastraAgentDefinitionRegistry({ mastra }),
    modelPolicyService: {
      selectModel: vi.fn(async () => ({ model: "test-model", budgetAction: "allow" as const })),
      selectFallbackModel: vi.fn(async () => null), finalizeUsage: vi.fn(),
    },
    defaultModel: "test-model", promptSource: { core: "Test agent", tools: [], skills: [], rules: [] },
    memory,
    modelCatalog: new ModelCatalog({ env: { OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, OPENAI_API_KEY: "test-only" } }),
  });
  const port = new MastraAgentRuntimeAdapter({ resolver, persistenceEnabled: false });
  async function run(runId: string) {
    const events: AgentRuntimeEvent[] = [];
    for await (const event of port.stream({
      runId, agentId: "provider-test", agentVersion: "1", sessionId: runId,
      resourceId: "test", threadId: runId, messages: [{ role: "user", content: "hello" }],
      requestContext: { ownerId: "test" }, policy: { allowedToolIds: [], allowedSkillIds: [] },
    })) events.push(event);
    return events;
  }
  try {
    const failed = await run("quota-failure");
    expect(failed.at(-1)).toMatchObject({ type: "run.final", result: {
      status: "failed", error: { code: "MASTRA_AGENT_EXECUTION_FAILED", message: "Free quota exhausted." },
    } });
    // 未被接管的流属性 promise 会在下一个事件循环被 Vitest 报为 unhandled rejection。
    await delay(20);
    unavailable = false;
    const recovered = await run("recovered");
    expect(recovered.at(-1)).toMatchObject({ type: "run.final", result: {
      status: "succeeded", text: "provider recovered",
    } });
  } finally {
    await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
    await mastra.shutdown();
  }
}, 15_000);
