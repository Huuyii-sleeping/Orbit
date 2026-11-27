import { once } from "node:events";
import { createServer, request, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { currentServiceTenant, encodeServiceTenant, SERVICE_TENANT_HEADER } from "@orbit/service-auth";
import { createAgentTenantMiddleware, resolveAgentDeploymentMode } from "../../../src/nest/agent-tenant.middleware.js";
import { createAgentServiceAuthMiddleware } from "../../../src/nest/agent-service-auth.middleware.js";

const servers: Server[] = [];
const token = "test-agent-service-token-0123456789abcdef";
const tenant = { issuer: "https://id.example", tenantId: "org-a", subject: "user-a" };
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("Agent tenant HTTP boundary", () => {
  it("生产强制 SaaS，SaaS 必须配置服务凭据", () => {
    expect(resolveAgentDeploymentMode(undefined, { NODE_ENV: "production" })).toBe("saas");
    expect(() => resolveAgentDeploymentMode("local", { NODE_ENV: "production" })).toThrow(/Production/);
    expect(() => createAgentTenantMiddleware("saas", undefined)).toThrow(/credentials/);
  });

  it("只在服务认证后接受单一合法身份，缺失身份与未隔离入口被拒绝", async () => {
    const auth = createAgentServiceAuthMiddleware(token);
    const boundary = createAgentTenantMiddleware("saas", token);
    const server = createServer((req, res) => auth(req, res, () => boundary(req, res, () => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ identity: currentServiceTenant() ?? null }));
    })));
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { Authorization: `Bearer ${token}`, [SERVICE_TENANT_HEADER]: encodeServiceTenant(tenant) };
    expect((await fetch(`${base}/workflow-runs/run`, { headers: { [SERVICE_TENANT_HEADER]: headers[SERVICE_TENANT_HEADER] } })).status).toBe(401);
    expect((await fetch(`${base}/workflow-runs/run`, { headers: { Authorization: headers.Authorization } })).status).toBe(401);
    expect((await fetch(`${base}/workflow-runs/run`, { headers: { ...headers, [SERVICE_TENANT_HEADER]: "invalid" } })).status).toBe(401);
    expect(await (await fetch(`${base}/workflow-runs/run`, { headers })).json()).toEqual({ identity: tenant });
    for (const path of ["/sessions", "/internal/mastra/workflows", "/events", "/models", "/workflow-runs/%72un"]) {
      expect((await fetch(`${base}${path}`, { headers })).status, path).toBe(403);
    }
    const duplicateStatus = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/workflow-runs/run`, {
        headers: { Authorization: headers.Authorization, [SERVICE_TENANT_HEADER]: [headers[SERVICE_TENANT_HEADER], headers[SERVICE_TENANT_HEADER]] },
      }, (res) => { res.resume(); resolve(res.statusCode!); });
      req.on("error", reject); req.end();
    });
    expect(duplicateStatus).toBe(401);
  });
});
