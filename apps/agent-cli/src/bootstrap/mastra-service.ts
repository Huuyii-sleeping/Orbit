import { createRuntimeGateway, type RuntimeGateway } from "@orbit/runtime-contracts";
import type { AgentVersion } from "@orbit/workflow-core";
import type { AgentAppRuntimeDeps } from "./app-runtime.js";
import { ModelCatalog } from "../mastra/models/model-catalog.js";
import type { AgentHost } from "../host/agent-host.js";
import {
  MASTRA_AGENT_ADAPTER_VERSION,
  MastraAgentRuntimeAdapter,
  MastraWorkflowRuntimeAdapter,
} from "../mastra/adapters/index.js";
import { MastraAgentDefinitionRegistry } from "../mastra/agents/definition-registry.js";
import { OrbitMastraAgentExecutionResolver } from "../mastra/agents/execution-resolver.js";
import { getOrCreateMastraRuntime } from "../mastra/instance/factory.js";
import { MastraMemoryRuntimeAdapter } from "../mastra/memory/memory-runtime-adapter.js";
import { MastraToolExecutionAdapter } from "../mastra/tools/tool-execution-adapter.js";
import { MASTRA_WORKFLOW_ADAPTER_VERSION, MastraWorkflowCompilerAdapter } from "../mastra/workflows/compiler-adapter.js";
import { MastraWorkflowAgentExecutor } from "../mastra/workflows/agent-executor.js";
import { MastraWorkflowAgentNodeExecutor } from "../mastra/workflows/agent-node-executor.js";
import { OrbitMastraWorkflowAgentResolver } from "../mastra/workflows/agent-step-resolver.js";
import { MastraWorkflowToolExecutor } from "../mastra/workflows/tool-executor.js";
import { AgentService } from "../service-api/index.js";
import { resolveBoundSkills, toPromptSkillBlocks } from "../skills/loader.js";
import { ToolServiceExecutionPort } from "../tools/tool-execution-port.js";
import { createBuiltinWorkflowExecutorRegistry } from "../workflows/executors/index.js";

const MASTRA_RUNTIME_VERSION = "1.52.1";

/** 为生产宿主装配唯一 Mastra RuntimeGateway。 */
export async function createMastraAgentService(
  deps: Pick<AgentAppRuntimeDeps, "toolService" | "modelPolicyService" | "model" | "promptSource">,
  host: AgentHost,
): Promise<AgentService> {
  const modelCatalog = new ModelCatalog();
  const shared = await getOrCreateMastraRuntime();
  const memory = new MastraMemoryRuntimeAdapter(shared.memory);
  const productTools = new ToolServiceExecutionPort(deps.toolService, memory);
  const tools = new MastraToolExecutionAdapter(productTools);
  const agentRegistry = new MastraAgentDefinitionRegistry({ mastra: shared.mastra });
  const agentResolver = new OrbitMastraAgentExecutionResolver({
    registry: agentRegistry,
    modelCatalog,
    modelPolicyService: deps.modelPolicyService,
    defaultModel: deps.model,
    promptSource: deps.promptSource,
    memory: shared.memory,
    resolveTools: (command) => tools.resolveForAgent(command),
    resolveSkillInstructions: async (command) => {
      const session = host.getSession(command.sessionId);
      if (!session?.agent) return [];
      const resolved = resolveBoundSkills(session.agent);
      if (!resolved.ok) throw new Error("agent skill binding could not be loaded");
      return toPromptSkillBlocks(resolved.skills, { sessionId: command.sessionId });
    },
  });
  const agent = new MastraAgentRuntimeAdapter({ resolver: agentResolver });
  const workflowExecutors = createBuiltinWorkflowExecutorRegistry()
    .register(new MastraWorkflowAgentExecutor(new OrbitMastraWorkflowAgentResolver({
      registry: agentRegistry,
      modelCatalog,
      modelPolicyService: deps.modelPolicyService,
    })))
    .register(new MastraWorkflowAgentNodeExecutor({
      runtime: agent,
      resolveVersion: (agentProfileId, agentVersionId, context) => {
        const versions = Array.isArray(context.requestContext?.__workflowAgentVersions)
          ? context.requestContext.__workflowAgentVersions as AgentVersion[]
          : [];
        return versions.find((version) => version.agentProfileId === agentProfileId && version.id === agentVersionId);
      },
    }))
    .register(new MastraWorkflowToolExecutor(tools));
  const workflow = new MastraWorkflowRuntimeAdapter({
    compiler: new MastraWorkflowCompilerAdapter({
      mastra: shared.mastra,
      executors: workflowExecutors,
    }),
  });
  const gateway: RuntimeGateway = createRuntimeGateway({ agent, workflow, tools, memory });
  return new AgentService(deps, host, {
    runtimeGateway: gateway,
    runtimeInfo: async () => ({
      mode: "mastra-only",
      runtimeVersion: MASTRA_RUNTIME_VERSION,
      backends: {
        agent: {
          backend: "mastra",
          adapterVersion: MASTRA_AGENT_ADAPTER_VERSION,
          capabilities: await gateway.agent.capabilities(),
        },
        workflow: {
          backend: "mastra",
          adapterVersion: MASTRA_WORKFLOW_ADAPTER_VERSION,
          capabilities: await gateway.workflow.capabilities(),
        },
      },
    }),
  });
}
