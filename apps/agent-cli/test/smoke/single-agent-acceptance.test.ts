import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { afterEach, expect, it, vi } from "vitest";
import { isTerminalWorkflowRunStatus, type AgentVersion } from "@orbit/workflow-core";
import { ModelCatalog } from "../../src/mastra/models/model-catalog.js";
import { ModelConnectionStore } from "../../src/services/model-connection-store.js";
import { MastraAgentDefinitionRegistry } from "../../src/mastra/agents/definition-registry.js";
import { OrbitMastraAgentExecutionResolver } from "../../src/mastra/agents/execution-resolver.js";
import { MastraAgentRuntimeAdapter } from "../../src/mastra/adapters/agent-runtime-adapter.js";
import { MastraWorkflowRuntimeAdapter } from "../../src/mastra/adapters/workflow-runtime-adapter.js";
import { MastraWorkflowCompilerAdapter } from "../../src/mastra/workflows/compiler-adapter.js";
import { MastraWorkflowAgentNodeExecutor, deriveChildAgentRunId } from "../../src/mastra/workflows/agent-node-executor.js";
import { createBuiltinWorkflowExecutorRegistry } from "../../src/workflows/executors/index.js";
import { createAgentTestWorkflow, createTestAgentVersion } from "../fixtures/agent-workflow.js";
import { startModelProvider } from "../fixtures/model-provider.js";

afterEach(() => vi.unstubAllEnvs());

it("单 Agent 实际执行固定职责、权限、技能、连接修订与输出校验，并收敛失败、取消和超时", async () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-single-agent-"));
  const skillFolder = join(root, "skills", "remote", "qa-style", "1.0.0");
  mkdirSync(skillFolder, { recursive: true });
  writeFileSync(join(skillFolder, "skill.json"), JSON.stringify({ id: "qa-style", version: "1.0.0", entry: "SKILL.md" }));
  writeFileSync(join(skillFolder, "SKILL.md"), "---\nname: qa-style\ndescription: QA\n---\nQA_SKILL_EVIDENCE: Always preserve numbers.");
  vi.stubEnv("SKILLHUB_DATA_ROOT", join(root, "skills"));
  let invalidOutput = false;
  const provider = await startModelProvider({ tool: { name: "read_file", input: { path: "fixture.txt" } }, text: (body) => {
    if (invalidOutput) return '{"wrong":true}';
    const role = JSON.stringify(body.messages).includes("TRANSLATOR_V1") ? "translated" : "reviewed";
    return JSON.stringify({ text: role });
  } });
  const catalog = new ModelCatalog({ env: {}, connections: new ModelConnectionStore(join(root, "models")) });
  const connectionInput = { name: "QA", provider: "openai-compatible", modelId: "before", baseUrl: provider.baseUrl, apiKey: "fixture-secret" };
  const original = catalog.createConnection(connectionInput);
  const mastra = new Mastra({ storage: new InMemoryStore({ id: randomUUID() }), logger: new ConsoleLogger({ name: "single-agent", level: LogLevel.ERROR }) });
  const execute = vi.fn(async () => ({ content: "fixture data" }));
  const agent = new MastraAgentRuntimeAdapter({ persistenceEnabled: false, resolver: new OrbitMastraAgentExecutionResolver({
    registry: new MastraAgentDefinitionRegistry({ mastra }), modelCatalog: catalog, defaultModel: "unset-model",
    modelPolicyService: { selectModel: vi.fn(async (_role, model) => ({ model, budgetAction: "allow" as const })), selectFallbackModel: vi.fn(), finalizeUsage: vi.fn() },
    promptSource: { core: "HOST_CLI_ROLE", tools: [], skills: [], rules: [] },
    resolveTools: async () => ({ read_file: createTool({ id: "read_file", description: "Read QA fixture", inputSchema: z.object({ path: z.string() }), execute }) }),
  }) });
  const initial = createTestAgentVersion("qa", original.reference);
  initial.instructions = ["TRANSLATOR_V1: translate the source."];
  initial.skillPolicy.bindings = [{ skillId: "qa-style", version: "1.0.0", sourceType: "remote", registrySource: "official" }];
  const versions = new Map<string, AgentVersion>([[initial.id, initial]]);
  const executors = createBuiltinWorkflowExecutorRegistry().register(new MastraWorkflowAgentNodeExecutor({ runtime: agent, resolveVersion: (_id, version) => versions.get(version) }));
  const workflow = new MastraWorkflowRuntimeAdapter({ persistenceEnabled: false, compiler: new MastraWorkflowCompilerAdapter({ mastra, executors }) });
  async function start(version: AgentVersion, timeoutMs?: number) {
    versions.set(version.id, version);
    const draft = createAgentTestWorkflow([version], "Translate: Sales rose 12%.");
    if (timeoutMs) draft.nodes.find((node) => node.id === "qa")!.execution = { timeoutMs };
    return workflow.start({ workflow: draft, agentDependencies: [version], mode: "draft", requestContext: { ownerId: "qa" } });
  }
  async function finish(id: string) {
    await vi.waitFor(async () => expect(isTerminalWorkflowRunStatus((await workflow.get(id))!.status)).toBe(true), { timeout: 6000, interval: 20 });
    return (await workflow.get(id))!;
  }
  try {
    const first = await finish((await start(initial)).id);
    expect(first).toMatchObject({ status: "succeeded", output: { result: { text: "translated" } } });
    expect(execute).not.toHaveBeenCalled();
    expect(provider.requests[0]!.body.tools ?? []).toEqual([]);
    expect(JSON.stringify(provider.requests[0]!.body)).toContain("QA_SKILL_EVIDENCE");
    expect(JSON.stringify(provider.requests[0]!.body)).not.toContain("HOST_CLI_ROLE");
    const edited = catalog.updateConnection(original.id, { ...connectionInput, modelId: "after", reference: original.reference });
    const revision = structuredClone(initial);
    revision.id = "qa-v2"; revision.version = 2; revision.contentHash = "qa-v2-hash";
    revision.modelId = edited.reference; revision.instructions = ["REVIEWER_V2: review translation."];
    revision.toolPolicy.allowedToolIds = ["read_file"];
    const changed = await finish((await start(revision)).id);
    expect(changed).toMatchObject({ status: "succeeded", output: { result: { text: "reviewed" } } });
    expect(execute).toHaveBeenCalledOnce();
    expect(provider.requests.at(-1)!.body.model).toBe("after");
    catalog.deleteConnection(original.id, { reference: edited.reference });
    expect((await finish((await start(initial)).id)).output).toEqual(first.output);
    expect(provider.requests.at(-1)!.body.model).toBe("before");
    expect(execute).toHaveBeenCalledOnce();
    invalidOutput = true;
    const malformed = await finish((await start(initial)).id);
    expect(malformed.nodeRuns.qa?.error?.code).toBe("WORKFLOW_AGENT_OUTPUT_SCHEMA_INVALID");
    invalidOutput = false;
    for (const [statusCode, message] of [[401, "Incorrect API key provided"], [402, "Insufficient Balance"], [403, "Free quota exhausted."]] as const) {
      provider.state.statusCode = statusCode; provider.state.errorMessage = message;
      const failed = await finish((await start(initial)).id);
      expect(failed.status).toBe("failed");
      expect(failed.nodeRuns.qa?.error?.message).toContain(message);
    }
    provider.state.statusCode = 200;
    const missing = structuredClone(initial); missing.id = "qa-unset"; missing.modelId = "";
    const noModel = await finish((await start(missing)).id);
    expect(noModel.status).toBe("failed");
    expect(noModel.nodeRuns.qa?.error?.message).toContain("请选择模型");
    provider.state.hold = true;
    const before = provider.requests.length;
    const cancelled = await start(initial);
    await vi.waitFor(() => expect(provider.requests.length).toBeGreaterThan(before));
    await workflow.cancel({ runId: cancelled.id });
    expect((await finish(cancelled.id)).status).toBe("cancelled");
    await vi.waitFor(async () => expect((await agent.getRun(deriveChildAgentRunId(cancelled.id, "qa", 1)))?.status).toBe("cancelled"));
    const timed = await start(initial, 150);
    const timeout = await finish(timed.id);
    expect(timeout.status).toBe("failed");
    expect(timeout.nodeRuns.qa?.error?.code).toBe("WORKFLOW_NODE_TIMEOUT");
    await vi.waitFor(async () => expect((await agent.getRun(deriveChildAgentRunId(timed.id, "qa", 1)))?.status).toBe("cancelled"));
    provider.state.hold = false;
    expect((await finish((await start(initial)).id)).status).toBe("succeeded");
  } finally { await mastra.shutdown(); await provider.close(); rmSync(root, { recursive: true, force: true }); }
}, 25_000);
