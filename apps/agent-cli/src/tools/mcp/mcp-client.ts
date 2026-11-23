import { randomUUID } from "node:crypto";
import { isValidationError, noopObserve } from "@mastra/core/tools";
import { MCPClient } from "@mastra/mcp";
import { standardSchemaToJSONSchema } from "@mastra/core/schema";
import { getExecutionContext, recordObservabilityEvent } from "../../observability/runtime.js";
import type { McpServerConfig } from "./mcp-config.js";
import { parseToolsList, parseCallResult } from "./mcp-protocol.js";

/** Mastra 管理进程、握手、传输和工具 schema；此处只适配 Orbit 的目录与调用结果。 */
export class McpServerClient {
  private client: MCPClient | undefined;
  private tools: Awaited<ReturnType<MCPClient["listTools"]>> | undefined;
  private starting: Promise<void> | undefined;

  constructor(private readonly config: McpServerConfig) {}

  async ensureStarted(): Promise<void> {
    if (this.tools) return;
    if (!this.starting)
      this.starting = this.start().finally(() => {
        this.starting = undefined;
      });
    await this.starting;
  }

  private async start() {
    const env = Object.fromEntries(
      Object.entries({ ...process.env, ...this.config.env }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    const client = new MCPClient({
      id: `orbit-${this.config.name}-${randomUUID()}`,
      timeout: this.config.requestTimeoutMs,
      servers: {
        [this.config.name]: {
          command: this.config.command,
          args: this.config.args,
          env,
          cwd: this.config.cwd,
          timeout: this.config.requestTimeoutMs,
          enableServerLogs: false,
        },
      },
    });
    this.client = client;
    const toolsets = await client.listToolsets();
    const tools = toolsets[this.config.name];
    if (!tools) {
      await this.close("startup_failed");
      throw new Error(`mcp server ${this.config.name} failed to connect; see Mastra error log`);
    }
    this.tools = tools;
    await recordObservabilityEvent(
      "mcp_lifecycle",
      {
        serverName: this.config.name,
        action: "initialized",
        command: this.config.command,
      },
      getExecutionContext() ?? undefined,
    );
  }

  async listTools() {
    await this.ensureStarted();
    return parseToolsList({
      tools: Object.entries(this.tools ?? {}).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema
          ? standardSchemaToJSONSchema(tool.inputSchema)
          : { type: "object", properties: {} },
      })),
    });
  }

  async callTool(remoteName: string, args: Record<string, unknown>) {
    await this.ensureStarted();
    const tool = this.tools?.[remoteName];
    if (!tool?.execute) throw new Error(`mcp tool ${remoteName} is unavailable`);
    const result: unknown = await tool.execute(args, { observe: noopObserve });
    if (isValidationError(result)) throw new Error(result.message);
    // Mastra 将 structuredContent 直接返回；旧产品接口继续保留结构化对象。
    if (result && typeof result === "object" && ("content" in result || "isError" in result))
      return parseCallResult(result);
    return { structuredContent: result };
  }

  async close(reason: string): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.tools = undefined;
    if (!client) return;
    await client.disconnect();
    await recordObservabilityEvent(
      "mcp_lifecycle",
      {
        serverName: this.config.name,
        action: "close",
        reason,
      },
      getExecutionContext() ?? undefined,
    );
  }
}
