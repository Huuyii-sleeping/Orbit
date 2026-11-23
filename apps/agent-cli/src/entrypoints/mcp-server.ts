import type { Readable, Writable } from "node:stream";
import { stdin, stdout } from "node:process";
import { MCPServer } from "@mastra/mcp";
import { createTool } from "@mastra/core/tools";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveRunningDaemonServiceClient } from "../service-api/daemon-client.js";
import { createAgentAppRuntime, type AgentAppRuntimeDeps } from "../bootstrap/app-runtime.js";
import { AgentHost } from "../host/agent-host.js";
import { createMastraAgentService } from "../bootstrap/mastra-service.js";

/** MCP 工具复用现有 AgentService，不创建另一套 Agent 执行循环。 */
export type AgentMcpServiceLike = {
  createSession(): { id: string } | Promise<{ id: string }>;
  listSessions(): unknown[];
  getSessionDetail(
    sessionId: string,
  ): Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
  toolsMetadata(): Promise<Array<Record<string, string>>>;
  chat(input: { session_id?: string; message?: string }): Promise<Record<string, unknown>>;
};

/** Mastra 负责协议、参数校验与工具分发；工具只连接 Orbit 的业务服务。 */
export function createAgentMcpServer(service: AgentMcpServiceLike) {
  const outputSchema = z.object({ ok: z.boolean() }).passthrough();
  return new MCPServer({
    id: "orbit-agent-mcp",
    name: "agent-cli",
    version: "0.1.0",
    tools: {
      agent_chat: createTool({
        id: "agent_chat",
        description: "Run one message through the Agent CLI runtime.",
        inputSchema: z
          .object({ message: z.string().min(1), session_id: z.string().optional() })
          .strict(),
        outputSchema,
        execute: async (input) => {
          const result = await service.chat(input);
          if (result.ok === false) throw new Error(JSON.stringify(result.error));
          return outputSchema.parse(result);
        },
      }),
      agent_create_session: createTool({
        id: "agent_create_session",
        description: "Create a new AgentService session.",
        inputSchema: z.object({}).strict(),
        outputSchema,
        execute: async () => ({ ok: true, session: await service.createSession() }),
      }),
      agent_list_sessions: createTool({
        id: "agent_list_sessions",
        description: "List AgentService sessions.",
        inputSchema: z.object({}).strict(),
        outputSchema,
        execute: async () => ({ ok: true, sessions: service.listSessions() }),
      }),
      agent_get_session: createTool({
        id: "agent_get_session",
        description: "Read one AgentService session transcript.",
        inputSchema: z.object({ session_id: z.string().min(1) }).strict(),
        outputSchema,
        execute: async ({ session_id }) => {
          const session = await service.getSessionDetail(session_id);
          if (!session) throw new Error(`SESSION_NOT_FOUND: session not found: ${session_id}`);
          return { ok: true, session };
        },
      }),
      agent_list_tools: createTool({
        id: "agent_list_tools",
        description: "List tools available to the Agent CLI runtime.",
        inputSchema: z.object({}).strict(),
        outputSchema,
        execute: async () => ({ ok: true, tools: await service.toolsMetadata() }),
      }),
    },
  });
}

/** MCP stdio 入口的宿主依赖；可注入流用于原生协议回归。 */
export type AgentMcpServerOptions = {
  input?: Readable;
  output?: Writable;
  service?: AgentMcpServiceLike;
  host?: AgentHost;
  app?: AgentAppRuntimeDeps;
  resolveDaemonService?: () => Promise<AgentMcpServiceLike | null>;
};

/** 解析共享宿主后连接标准 stdio transport，不自行处理 JSON-RPC 或握手。 */
export async function runAgentMcpServer(opts: AgentMcpServerOptions = {}): Promise<void> {
  let service = opts.service;
  if (!service && !opts.host) {
    service =
      (await (
        opts.resolveDaemonService ??
        (async () => {
          const resolved = await resolveRunningDaemonServiceClient();
          return resolved?.client ?? null;
        })
      )()) ?? undefined;
  }
  if (!service) {
    const host = opts.host ?? new AgentHost();
    await host.initialize();
    service = await createMastraAgentService(opts.app ?? createAgentAppRuntime(), host);
  }
  const server = createAgentMcpServer(service);
  const input = opts.input ?? stdin;
  const transport = new StdioServerTransport(input, opts.output ?? stdout);
  const finished = new Promise<void>((resolve, reject) => {
    input.once("end", resolve);
    input.once("error", reject);
  });
  try {
    await server.getServer().connect(transport);
    await finished;
  } finally {
    await server.close();
  }
}
