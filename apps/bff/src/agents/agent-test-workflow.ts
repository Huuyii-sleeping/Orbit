import {
  builtinNodeRegistry,
  WORKFLOW_SCHEMA_VERSION,
  type AgentVersion,
  type WorkflowDraft,
} from "@orbit/workflow-core";

/** 用普通 Agent 节点构造独立试跑，复用 SOP 的编译、权限、取消与输出校验。 */
export function createAgentTestWorkflow(
  version: AgentVersion,
  inputs: Record<string, unknown>,
): WorkflowDraft {
  const start = builtinNodeRegistry.get("start")!;
  const agent = builtinNodeRegistry.get("agent")!;
  const end = builtinNodeRegistry.get("end")!;
  const startConfig = start.createDefaultConfig();
  const config = {
    ...agent.createDefaultConfig(),
    agentProfileId: version.agentProfileId,
    agentVersionId: version.id,
    inputBindings: Object.fromEntries(
      Object.entries(inputs).map(([key, value]) => [
        key,
        { kind: "literal" as const, value },
      ]),
    ),
    outputSchema: structuredClone(version.outputSchema),
  };
  const endConfig = {
    outputs: [
      {
        id: "result",
        name: "result",
        value: {
          scope: "node-output" as const,
          nodeId: "agent",
          portId: "result",
        },
      },
    ],
  };
  const now = Date.now();
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id: `agent-test-${version.agentProfileId}`,
    name: `${version.name} 独立试跑`,
    summary: "Agent 独立试跑",
    revision: 0,
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        kind: "builtin",
        id: "start",
        type: "start",
        version: 1,
        label: "开始",
        position: { x: 0, y: 0 },
        config: startConfig,
        ports: start.createPorts(startConfig),
      },
      {
        kind: "builtin",
        id: "agent",
        type: "agent",
        version: 1,
        label: version.name,
        position: { x: 0, y: 160 },
        config,
        ports: agent.createPorts(config),
      },
      {
        kind: "builtin",
        id: "end",
        type: "end",
        version: 1,
        label: "结果",
        position: { x: 0, y: 320 },
        config: endConfig,
        ports: end.createPorts(endConfig),
      },
    ],
    edges: [
      {
        id: "start-agent",
        source: { nodeId: "start", portId: "out" },
        target: { nodeId: "agent", portId: "in" },
        status: "valid",
      },
      {
        id: "agent-end",
        source: { nodeId: "agent", portId: "result" },
        target: { nodeId: "end", portId: "in" },
        status: "valid",
      },
    ],
  };
}
