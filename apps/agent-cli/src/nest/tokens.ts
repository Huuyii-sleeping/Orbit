/** 各 HTTP 领域仅注入自己需要的宿主能力。 */
export const AGENT_CHAT_SERVICE = Symbol("AGENT_CHAT_SERVICE");
export const AGENT_SESSIONS_SERVICE = Symbol("AGENT_SESSIONS_SERVICE");
export const AGENT_TOOLS_SERVICE = Symbol("AGENT_TOOLS_SERVICE");
export const AGENT_SKILLS_SERVICE = Symbol("AGENT_SKILLS_SERVICE");
export const AGENT_HOST_EVENTS = Symbol("AGENT_HOST_EVENTS");
export const AGENT_RUNTIME_INFO = Symbol("AGENT_RUNTIME_INFO");

/** Nest 宿主注入 AgentRuntimePort 的稳定 token。 */
export const AGENT_RUNTIME_PORT = Symbol("AGENT_RUNTIME_PORT");

/** Nest 宿主注入 WorkflowRuntimePort 的稳定 token。 */
export const WORKFLOW_RUNTIME_PORT = Symbol("WORKFLOW_RUNTIME_PORT");

/** Nest 宿主注入 ToolExecutionPort 的稳定 token。 */
export const TOOL_EXECUTION_PORT = Symbol("TOOL_EXECUTION_PORT");

/** Nest 宿主注入 MemoryRuntimePort 的稳定 token。 */
export const MEMORY_RUNTIME_PORT = Symbol("MEMORY_RUNTIME_PORT");

/** Nest 宿主暴露给 stdio/HTTP MCP 适配器的产品服务 token。 */
export const AGENT_MCP_SERVICE = Symbol("AGENT_MCP_SERVICE");

/** Nest 应用关闭时执行的 Mastra runtime cleanup。 */
export const MASTRA_RUNTIME_CLEANUP = Symbol("MASTRA_RUNTIME_CLEANUP");
