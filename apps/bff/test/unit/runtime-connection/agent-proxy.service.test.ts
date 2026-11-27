import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProxyService } from "../../../src/runtime-connection/agent-proxy.service.js";
import { runWithTenant } from "../../../src/identity/tenant-context.js";
import { SERVICE_TENANT_HEADER, decodeServiceTenant } from "@orbit/service-auth";

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
  it("保留上游配额 Retry-After，拒绝无效值并限制传播范围", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const proxy = new AgentProxyService({ agentBaseUrl: "http://127.0.0.1:3181", fetchImpl });
    for (const [raw, expected] of [["60", 60], ["99999", 3600], ["invalid", undefined], ["-1", undefined]] as const) {
      fetchImpl.mockResolvedValueOnce(new Response('{"ok":false,"error":{"code":"WORKFLOW_CONCURRENCY_LIMIT"}}', { status: 429, headers: { "Retry-After": raw } }));
      expect(await proxy.startWorkflowRun({})).toMatchObject({ status: 429 });
      fetchImpl.mockResolvedValueOnce(new Response('{}', { status: 429, headers: { "Retry-After": raw } }));
      const result = await proxy.startWorkflowRun({});
      expect(result.ok && result.retryAfterSeconds).toBe(expected);
    }
  });

  it("JSON 与 SSE 从可信上下文生成租户身份，缺少服务凭据时不能发送身份", async () => {
    const identity = { issuer: "https://id.example", tenantId: "org-a", subject: "user-a" };
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"ok":true}'));
    const proxy = new AgentProxyService({ agentBaseUrl: "http://127.0.0.1:3181", agentServiceToken: "test-agent-service-token-0123456789abcdef", fetchImpl });
    await runWithTenant(identity, async () => {
      await proxy.startWorkflowRun({});
      await proxy.workflowEventStream("run", "", undefined, new AbortController().signal);
    });
    for (const [, init] of fetchImpl.mock.calls) {
      expect(decodeServiceTenant(new Headers(init?.headers).get(SERVICE_TENANT_HEADER)!)).toEqual(identity);
    }
    const untrusted = new AgentProxyService({ agentBaseUrl: "http://127.0.0.1:3181", fetchImpl });
    await expect(runWithTenant(identity, () => untrusted.workflowEventStream("run", "", undefined, new AbortController().signal)))
      .rejects.toThrow(/service credentials/i);
  });
  it("JSON 和 Workflow SSE 使用服务凭据并禁止重定向", async () => {
    const token = "test-agent-service-token-0123456789abcdef";
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"ok":true}'));
    const service = new AgentProxyService({ agentBaseUrl: "http://127.0.0.1:3181", agentServiceToken: token, fetchImpl });
    await service.sendMessage("session", { message: "hello" });
    await service.workflowEventStream("run", "?since_id=7", "7", new AbortController().signal);
    const jsonInit = fetchImpl.mock.calls[0]![1]!;
    expect(new Headers(jsonInit.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(new Headers(jsonInit.headers).get("content-type")).toBe("application/json");
    expect(jsonInit.redirect).toBe("error");
    const streamInit = fetchImpl.mock.calls[1]![1]!;
    expect(new Headers(streamInit.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(new Headers(streamInit.headers).get("last-event-id")).toBe("7");
    expect(new Headers(streamInit.headers).get("accept")).toBe("text/event-stream");
    expect(streamInit.redirect).toBe("error");
  });

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
