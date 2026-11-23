import { Readable, Writable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentMcpServer,
  runAgentMcpServer,
  type AgentMcpServiceLike,
} from "../../../src/entrypoints/mcp-server.js";
import { AgentHost } from "../../../src/host/agent-host.js";
import { createAgentAppRuntime } from "../../../src/bootstrap/app-runtime.js";
import { shutdownMastraRuntime } from "../../../src/mastra/instance/factory.js";

function createService(): AgentMcpServiceLike {
  return {
    createSession: vi.fn(async () => ({ id: "new-session" })),
    listSessions: vi.fn(() => [{ id: "s01" }]),
    getSessionDetail: vi.fn(async (id) => (id === "s01" ? { id, messages: [] } : null)),
    toolsMetadata: vi.fn(async () => [{ name: "read_file" }]),
    chat: vi.fn(async (input) => ({
      ok: true,
      assistant: `reply:${input.message}`,
      session: { id: input.session_id ?? "new-session" },
    })),
  };
}

afterEach(async () => {
  await shutdownMastraRuntime();
});

describe("entrypoints/mcp-server", () => {
  it("通过标准 MCP 客户端握手、列举工具并调用共享服务，保留结构化结果", async () => {
    const service = createService();
    const server = createAgentMcpServer(service);
    const client = new Client({ name: "orbit-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.getServer().connect(serverTransport);
    try {
      await client.connect(clientTransport);
      expect(client.getServerVersion()?.name).toBe("agent-cli");
      expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
        "agent_chat",
        "agent_create_session",
        "agent_get_session",
        "agent_list_sessions",
        "agent_list_tools",
      ]);
      const chat = await client.callTool({
        name: "agent_chat",
        arguments: { message: "hello", session_id: "s01" },
      });
      expect(chat).toMatchObject({
        isError: false,
        structuredContent: { ok: true, assistant: "reply:hello" },
      });
      expect(service.chat).toHaveBeenCalledWith({ message: "hello", session_id: "s01" });
      expect(await client.callTool({ name: "agent_create_session", arguments: {} })).toMatchObject({
        structuredContent: { session: { id: "new-session" } },
      });
      expect(
        await client.callTool({ name: "agent_get_session", arguments: { session_id: "s01" } }),
      ).toMatchObject({ structuredContent: { session: { id: "s01" } } });
      expect(await client.callTool({ name: "agent_list_sessions", arguments: {} })).toMatchObject({
        structuredContent: { sessions: [{ id: "s01" }] },
      });
      expect(await client.callTool({ name: "agent_list_tools", arguments: {} })).toMatchObject({
        structuredContent: { tools: [{ name: "read_file" }] },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("由 Mastra 拒绝非法参数、未知工具和业务失败，不调用错误的业务入口", async () => {
    const service = createService();
    const server = createAgentMcpServer(service);
    const client = new Client({ name: "orbit-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.getServer().connect(serverTransport);
    try {
      await client.connect(clientTransport);
      expect(await client.callTool({ name: "agent_chat", arguments: {} })).toMatchObject({
        isError: true,
      });
      expect(service.chat).not.toHaveBeenCalled();
      expect(await client.callTool({ name: "missing", arguments: {} })).toMatchObject({
        isError: true,
      });
      expect(
        await client.callTool({ name: "agent_get_session", arguments: { session_id: "missing" } }),
      ).toMatchObject({
        isError: true,
        content: [expect.objectContaining({ text: expect.stringContaining("SESSION_NOT_FOUND") })],
      });
      vi.mocked(service.chat).mockResolvedValueOnce({
        ok: false,
        error: { code: "MODEL_UNAVAILABLE" },
      });
      expect(
        await client.callTool({ name: "agent_chat", arguments: { message: "hello" } }),
      ).toMatchObject({
        isError: true,
        content: [expect.objectContaining({ text: expect.stringContaining("MODEL_UNAVAILABLE") })],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("初始化显式宿主，或优先使用已有 daemon 服务", async () => {
    const output = () =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
    const host = new AgentHost();
    vi.spyOn(host, "initialize").mockResolvedValue(undefined);
    await runAgentMcpServer({ input: Readable.from([]), output: output(), host, app: createAgentAppRuntime({ model: "test-model" }) });
    expect(host.initialize).toHaveBeenCalledOnce();
    const resolveDaemonService = vi.fn(async () => createService());
    await runAgentMcpServer({ input: Readable.from([]), output: output(), resolveDaemonService });
    expect(resolveDaemonService).toHaveBeenCalledOnce();
  });
});
