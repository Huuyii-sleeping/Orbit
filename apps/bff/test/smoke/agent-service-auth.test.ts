import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBffHttpServer } from "../../src/server.js";
import { AgentProxyService } from "../../src/runtime-connection/agent-proxy.service.js";

const servers: Server[] = [];
const roots: string[] = [];
const token = "test-agent-service-token-0123456789abcdef";

async function listen(server: Server) {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing server address");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("BFF service credential boundary", () => {
  it("uses configured credentials for JSON, chat, global events and Workflow SSE without exposing them", async () => {
    const seen: Array<{ path: string; authorization: string | undefined; cursor: string | undefined }> = [];
    const upstream = await listen(createServer((req, res) => {
      req.resume();
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      seen.push({ path, authorization: req.headers.authorization, cursor: req.headers["last-event-id"] as string | undefined });
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"ok":false}');
        return;
      }
      const streaming = path === "/chat/stream" || path.endsWith("/events");
      res.writeHead(200, { "Content-Type": streaming ? "text/event-stream" : "application/json" });
      res.end(streaming ? "id: 8\nevent: test.ready\ndata: {}\n\n" : '{"ok":true,"sessions":[]}');
    }));
    const root = await mkdtemp(join(tmpdir(), "orbit-bff-service-auth-"));
    roots.push(root);
    const bff = await listen(await createBffHttpServer({
      agentBaseUrl: upstream, agentServiceToken: token,
      filePath: join(root, "business.json"), skillDataRoot: join(root, "skills"), sopDataRoot: join(root, "sops"),
    }));
    const cases: Array<[string, RequestInit]> = [
      ["/api/sessions", {}],
      ["/api/sessions/s1/messages/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"message":"hello"}' }],
      ["/api/events/stream", { headers: { "Last-Event-ID": "7" } }],
    ];
    for (const [path, init] of cases) {
      const headers = new Headers(init.headers);
      headers.set("Authorization", "Bearer browser-credential");
      const response = await fetch(`${bff}${path}`, { ...init, headers });
      expect(response.status, path).toBe(200);
      expect(await response.text()).not.toContain(token);
      expect(JSON.stringify([...response.headers])).not.toContain(token);
    }
    const proxy = new AgentProxyService({ agentBaseUrl: upstream, agentServiceToken: token });
    const workflow = await proxy.workflowEventStream("run", "?since_id=7", "7", new AbortController().signal);
    expect(await workflow.text()).toContain("id: 8");
    expect(seen.map((item) => item.path)).toEqual(["/sessions", "/chat/stream", "/events", "/workflow-runs/run/events"]);
    expect(seen.every((item) => item.authorization === `Bearer ${token}`)).toBe(true);
    expect(seen.slice(2).every((item) => item.cursor === "7")).toBe(true);
  });

  it("rejects missing production credentials before creating BFF data directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-bff-auth-config-"));
    roots.push(root);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_SERVICE_TOKEN", undefined);
    await expect(createBffHttpServer({
      agentBaseUrl: "http://127.0.0.1:3181", filePath: join(root, "business", "state.json"),
      skillDataRoot: join(root, "skills"), sopDataRoot: join(root, "sops"),
      identity: { mode: "saas", baseURL: "https://orbit.example.com", issuerBaseURL: "https://id.example.com/realms/orbit", jwksURL: "https://id.example.com/realms/orbit/protocol/openid-connect/certs", clientID: "orbit-web", clientSecret: "client-secret", sessionSecret: "a1".repeat(32), sessionStorePath: join(root, "sessions", "session.sqlite") },
    })).rejects.toThrow(/AGENT_SERVICE_TOKEN/);
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses upstream redirects without sending a request to the target", async () => {
    let hits = 0;
    const target = await listen(createServer((_req, res) => { hits += 1; res.end("unexpected"); }));
    const redirector = await listen(createServer((_req, res) => { res.writeHead(307, { Location: target }); res.end(); }));
    const proxy = new AgentProxyService({ agentBaseUrl: redirector, agentServiceToken: token });
    expect(await proxy.health()).toMatchObject({ ok: false, status: 502 });
    await expect(proxy.workflowEventStream("run", "", undefined, new AbortController().signal)).rejects.toThrow();
    expect(hits).toBe(0);
  });
});
