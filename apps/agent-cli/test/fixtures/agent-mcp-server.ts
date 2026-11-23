import { runAgentMcpServer } from "../../src/entrypoints/mcp-server.js";

// 测试 stdio 入口及标准协议，不调用云模型或持久化产品数据。
await runAgentMcpServer({
  service: {
    createSession: async () => ({ id: "stdio-session" }),
    listSessions: () => [],
    getSessionDetail: async (id) => ({ id, messages: [] }),
    toolsMetadata: async () => [],
    chat: async ({ message }) => ({ ok: true, assistant: `reply:${message}` }),
  },
});
