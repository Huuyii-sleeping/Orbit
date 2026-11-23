import { builtinNodeRegistry, type AgentVersion, type WorkflowDraft } from "@orbit/workflow-core";

/** 创建固定版本的串行 Agent SOP，输入沿 result 端口逐步传递。 */
export function createAgentTestWorkflow(versions: AgentVersion[], task: string): WorkflowDraft {
  const start = builtinNodeRegistry.get("start")!;
  const agent = builtinNodeRegistry.get("agent")!;
  const end = builtinNodeRegistry.get("end")!;
  const startConfig = start.createDefaultConfig();
  const endConfig = {
    outputs: [
      {
        id: "result",
        name: "result",
        value: {
          scope: "node-output" as const,
          nodeId: versions.at(-1)!.agentProfileId,
          portId: "result",
        },
      },
    ],
  };
  return {
    schemaVersion: 2,
    id: "multi-model-sop",
    name: "Multi model SOP",
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
      ...versions.map((version, index) => {
        const config = {
          ...agent.createDefaultConfig(),
          agentProfileId: version.agentProfileId,
          agentVersionId: version.id,
          outputSchema: version.outputSchema,
          inputBindings:
            index === 0
              ? { task: { kind: "literal" as const, value: task } }
              : {
                  previous: {
                    kind: "variable" as const,
                    ref: {
                      scope: "node-output" as const,
                      nodeId: versions[index - 1]!.agentProfileId,
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
        position: { x: 0, y: 800 },
        config: endConfig,
        ports: end.createPorts(endConfig),
      },
    ],
    edges: [
      ...versions.map((version, index) => ({
        id: `edge-${index}`,
        source: {
          nodeId: index === 0 ? "start" : versions[index - 1]!.agentProfileId,
          portId: index === 0 ? "out" : "result",
        },
        target: { nodeId: version.agentProfileId, portId: "in" },
      })),
      {
        id: "last",
        source: { nodeId: versions.at(-1)!.agentProfileId, portId: "result" },
        target: { nodeId: "end", portId: "in" },
      },
    ],
  };
}

/** 测试中使用的不可变 Agent 版本快照，不写入产品数据库。 */
export function createTestAgentVersion(id: string, modelId: string): AgentVersion {
  return {
    id: `${id}-v1`,
    agentProfileId: id,
    version: 1,
    name: id,
    description: "",
    contentHash: `${id}-hash`,
    instructions: ['Return exactly {"text":"adapter-ok"}.'],
    modelId,
    toolPolicy: { allowedToolIds: [] },
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
  };
}
