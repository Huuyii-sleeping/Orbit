import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";
import {
  builtinNodeRegistry,
  isTerminalWorkflowRunStatus,
  type AgentVersion,
  type WorkflowDraft,
} from "@orbit/workflow-core";
import type { AgentRuntimePort, StreamAgentCommand } from "@orbit/runtime-contracts";
import { expect, it, vi } from "vitest";
import { MastraWorkflowRuntimeAdapter } from "../../src/mastra/adapters/workflow-runtime-adapter.js";
import { MastraWorkflowCompilerAdapter } from "../../src/mastra/workflows/compiler-adapter.js";
import { MastraWorkflowAgentNodeExecutor } from "../../src/mastra/workflows/agent-node-executor.js";
import { createBuiltinWorkflowExecutorRegistry } from "../../src/workflows/executors/index.js";

it("独立 Agent 与三 Agent SOP 复用固定配置、结构化交接和失败校验", async () => {
  const root = await mkdtemp(join(tmpdir(), "orbit-agent-workbench-runtime-"));
  const mastra = new Mastra({
    storage: new InMemoryStore({ id: "workbench-smoke" }),
    logger: new ConsoleLogger({ name: "workbench-smoke", level: LogLevel.ERROR }),
  });
  const commands: StreamAgentCommand[] = [];
  let invalidOutput = false;
  const port = {
    stream: async function* (command: StreamAgentCommand) {
      commands.push(command);
      const input = JSON.parse(command.messages.at(-1)!.content);
      const text = invalidOutput
        ? '{"unexpected":true}'
        : JSON.stringify({ text: `${input.previous?.text ?? input.task} → ${command.agentId}` });
      yield {
        id: 1,
        at: Date.now(),
        runId: command.runId!,
        type: "run.final",
        result: {
          id: command.runId!,
          status: "succeeded",
          createdAt: Date.now(),
          sessionId: command.sessionId,
          resourceId: command.resourceId,
          threadId: command.threadId,
          binding: { backend: "mastra", adapterVersion: "test" },
          text,
          toolExecutions: [],
        },
      };
    },
    getRun: vi.fn(),
    cancel: vi.fn(),
  } as unknown as AgentRuntimePort;
  const versions: AgentVersion[] = ["extract", "analyze", "report"].map((id) => ({
    id: `${id}-v1`,
    agentProfileId: id,
    version: 1,
    name: id,
    contentHash: `${id}-hash`,
    description: "",
    instructions: [`You are ${id}.`],
    modelId: `${id}-model`,
    toolPolicy: { allowedToolIds: id === "extract" ? ["read_file"] : [] },
    skillPolicy: { bindings: [] },
    outputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    createdBy: "test",
    releaseNotes: "",
    createdAt: 1,
  }));
  const executors = createBuiltinWorkflowExecutorRegistry().register(
    new MastraWorkflowAgentNodeExecutor({
      runtime: port,
      resolveVersion: (profile, id) =>
        versions.find((version) => version.agentProfileId === profile && version.id === id),
    }),
  );
  const runtime = new MastraWorkflowRuntimeAdapter({
    compiler: new MastraWorkflowCompilerAdapter({ mastra, executors }),
    root,
    persistenceEnabled: false,
  });
  function workflow(count: number): WorkflowDraft {
    const start = builtinNodeRegistry.get("start")!;
    const agent = builtinNodeRegistry.get("agent")!;
    const end = builtinNodeRegistry.get("end")!;
    const selected = versions.slice(0, count);
    const startConfig = start.createDefaultConfig();
    const endConfig = {
      outputs: [
        {
          id: "result",
          name: "result",
          value: {
            scope: "node-output" as const,
            nodeId: selected.at(-1)!.agentProfileId,
            portId: "result",
          },
        },
      ],
    };
    return {
      schemaVersion: 2,
      id: `workbench-${count}`,
      name: "workbench",
      summary: "",
      revision: 0,
      createdAt: 1,
      updatedAt: 1,
      nodes: [
        {
          kind: "builtin",
          id: "start",
          type: "start",
          version: 1,
          label: "start",
          position: { x: 0, y: 0 },
          config: startConfig,
          ports: start.createPorts(startConfig),
        },
        ...selected.map((version, index) => {
          const config = {
            ...agent.createDefaultConfig(),
            agentProfileId: version.agentProfileId,
            agentVersionId: version.id,
            outputSchema: version.outputSchema,
            inputBindings:
              index === 0
                ? { task: { kind: "literal" as const, value: "资料" } }
                : {
                    previous: {
                      kind: "variable" as const,
                      ref: {
                        scope: "node-output" as const,
                        nodeId: selected[index - 1]!.agentProfileId,
                        portId: "result",
                      },
                    },
                  },
          };
          return {
            kind: "builtin" as const,
            id: version.agentProfileId,
            type: "agent" as const,
            version: 1,
            label: version.name,
            position: { x: 0, y: index * 160 },
            config,
            ports: agent.createPorts(config),
          };
        }),
        {
          kind: "builtin",
          id: "end",
          type: "end",
          version: 1,
          label: "end",
          position: { x: 0, y: 600 },
          config: endConfig,
          ports: end.createPorts(endConfig),
        },
      ],
      edges: [
        ...selected.map((version, index) => ({
          id: `e${index}`,
          source: {
            nodeId: index === 0 ? "start" : selected[index - 1]!.agentProfileId,
            portId: index === 0 ? "out" : "result",
          },
          target: { nodeId: version.agentProfileId, portId: "in" },
        })),
        {
          id: "last",
          source: { nodeId: selected.at(-1)!.agentProfileId, portId: "result" },
          target: { nodeId: "end", portId: "in" },
        },
      ],
    };
  }
  async function execute(count: number) {
    const run = await runtime.start({
      workflow: workflow(count),
      agentDependencies: versions,
      mode: "draft",
      requestContext: { ownerId: "test-owner" },
    });
    for await (const event of runtime.events({ runId: run.id }))
      if (event.type === "run.status" && isTerminalWorkflowRunStatus(event.status)) break;
    return (await runtime.get(run.id))!;
  }
  try {
    const standalone = await execute(1);
    expect(standalone.status).toBe("succeeded");
    expect(standalone.output).toEqual({ result: { text: "资料 → extract" } });
    commands.length = 0;
    const composed = await execute(3);
    expect(composed.status).toBe("succeeded");
    expect(composed.output).toEqual({ result: { text: "资料 → extract → analyze → report" } });
    expect(commands.map((command) => command.modelId)).toEqual([
      "extract-model",
      "analyze-model",
      "report-model",
    ]);
    expect(commands.map((command) => command.policy.allowedToolIds)).toEqual([
      ["read_file"],
      [],
      [],
    ]);
    expect(new Set(commands.map((command) => command.sessionId)).size).toBe(3);
    invalidOutput = true;
    const failed = await execute(1);
    expect(failed.status).toBe("failed");
    expect(failed.nodeRuns.extract?.error?.code).toBe("WORKFLOW_AGENT_OUTPUT_SCHEMA_INVALID");
  } finally {
    await mastra.shutdown();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
