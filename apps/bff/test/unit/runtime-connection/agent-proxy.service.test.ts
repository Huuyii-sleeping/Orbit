import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { AgentProxyService } from "../../../src/agent-proxy.service.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function hangingServer(sendHeaders: boolean) {
  const server = createServer((_req, res) => {
    if (sendHeaders) { res.writeHead(200, { "Content-Type": "application/json" }); res.write('{"ok":'); }
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return `http://127.0.0.1:${address.port}`;
}

describe("Agent 上游超时边界", () => {
  it.each([false, true])("请求或响应体挂起能在期限内中断（已发头：%s）", async (sendHeaders) => {
    const service = new AgentProxyService({ agentBaseUrl: await hangingServer(sendHeaders), requestTimeoutMs: 80 });
    const started = Date.now();
    expect(await service.health()).toMatchObject({ ok: false, status: 504, body: { error: { code: "AGENT_UPSTREAM_TIMEOUT" } } });
    expect(Date.now() - started).toBeLessThan(2000);
  }, 3000);
  it("客户端关闭聊天流时关闭上游连接", async () => {
    let closed: (() => void) | undefined;
    const upstreamClosed = new Promise<void>((resolve) => { closed = resolve; });
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("event: message.delta\ndata: {}\n\n");
      res.once("close", () => closed?.());
    });
    servers.push(upstream);
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const service = new AgentProxyService({ agentBaseUrl: `http://127.0.0.1:${address.port}` });
    const bff = createServer((_req, res) => { void service.proxyChatMessageStream(res, "session", { message: "hello" }); });
    servers.push(bff);
    bff.listen(0, "127.0.0.1");
    await once(bff, "listening");
    const bffAddress = bff.address();
    if (!bffAddress || typeof bffAddress === "string") throw new Error("missing address");
    const response = await fetch(`http://127.0.0.1:${bffAddress.port}`);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await upstreamClosed;
  }, 3000);

});
