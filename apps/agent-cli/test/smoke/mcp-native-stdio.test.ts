import path from "node:path";
import { MCPClient } from "@mastra/mcp";
import { noopObserve } from "@mastra/core/tools";
import { expect, it } from "vitest";

it("Mastra MCPClient 经标准 stdio 调用 Orbit 的原生 MCPServer 入口", async () => {
  const client = new MCPClient({
    id: "orbit-native-stdio-test",
    timeout: 20_000,
    servers: {
      orbit: {
        command: process.execPath,
        args: [
          path.resolve("node_modules/tsx/dist/cli.mjs"),
          "--tsconfig",
          path.resolve("tsconfig.json"),
          path.resolve("test/fixtures/agent-mcp-server.ts"),
        ],
        cwd: process.cwd(),
        enableServerLogs: false,
      },
    },
  });
  try {
    const tools = (await client.listToolsets()).orbit;
    expect(Object.keys(tools)).toHaveLength(5);
    expect(
      await tools.agent_chat.execute?.({ message: "hello" }, { observe: noopObserve }),
    ).toEqual({ ok: true, assistant: "reply:hello" });
    expect(await tools.agent_create_session.execute?.({}, { observe: noopObserve })).toEqual({
      ok: true,
      session: { id: "stdio-session" },
    });
  } finally {
    await client.disconnect();
  }
}, 25_000);
