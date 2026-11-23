import OpenAI from "openai";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentAppRuntime } from "../../../src/bootstrap/app-runtime.js";
import { AgentHost } from "../../../src/host/agent-host.js";
import { shutdownMastraRuntime } from "../../../src/mastra/instance/factory.js";
import { createMastraAgentService } from "../../../src/runtime/mastra-default-service.js";

const previousPersistence = process.env.AGENT_PRIVACY_PERSISTENCE_MODE;

afterEach(async () => {
  await shutdownMastraRuntime();
  if (previousPersistence === undefined) delete process.env.AGENT_PRIVACY_PERSISTENCE_MODE;
  else process.env.AGENT_PRIVACY_PERSISTENCE_MODE = previousPersistence;
});

describe("runtime/mastra-default-service", () => {
  it("binds new sessions to Mastra in mastra-only mode", async () => {
    process.env.AGENT_PRIVACY_PERSISTENCE_MODE = "disabled";
    const deps = createAgentAppRuntime({
      client: new OpenAI({ apiKey: "test-key" }),
      model: "fake-model",
      promptSource: { core: "test", tools: [], skills: [], rules: [] },
    });
    const host = new AgentHost(deps);
    const service = await createMastraAgentService(deps, host);
    const session = service.createSession({ id: "agent-1", name: "Agent 1", skills: [] });

    expect(session.runtimeBinding).toMatchObject({
      backend: "mastra",
      adapterVersion: "mastra-agent-v1",
      runtimeVersion: "1.52.1",
      selectionReason: "mastra-only runtime",
    });
    await expect(service.runtimeInfo()).resolves.toMatchObject({
      mode: "mastra-only",
      runtimeVersion: "1.52.1",
      backends: {
        agent: {
          backend: "mastra",
          adapterVersion: "mastra-agent-v1",
          capabilities: { generate: true, stream: true, sessionMemory: true },
        },
        workflow: {
          backend: "mastra",
          adapterVersion: "mastra-workflow-v2",
          capabilities: { start: true, cancel: true, restartRecovery: true },
        },
      },
    });
    expect(service.runtimeGateway.agent).toBeDefined();
    expect(service.runtimeGateway.workflow).toBeDefined();
    expect(service.runtimeGateway.tools).toBeDefined();
    expect(service.runtimeGateway.memory).toBeDefined();
  });
});
