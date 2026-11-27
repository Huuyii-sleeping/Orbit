import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response, NextFunction } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { runWithOrganizationAuthorization } from "../../src/identity/organization-authorization.js";
import { verifiedIdentityFromClaims } from "../../src/identity/organization-claims.js";
import { createTestDraft } from "../unit/sops/test-fixtures.js";
import { createTenantHttpLimits, TENANT_HTTP_LIMITS } from "@orbit/service-auth/http";

const apps: INestApplication[] = [];
const servers: Server[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("组织业务权限的 HTTP 适配", () => {
  it("真实 Nest 装配把 service 拒绝映射为 403，授权者可操作，其他组织不可见", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-authorization-api-")); roots.push(root);
    let upstreamHits = 0;
    const upstream = createServer((_req, res) => { upstreamHits++; res.writeHead(500); res.end(); });
    servers.push(upstream); upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const app = await NestFactory.create(AppModule.register({
      agentBaseUrl: `http://127.0.0.1:${address.port}`, requireTenantContext: true,
      filePath: join(root, "business.json"), sopDataRoot: join(root, "sops"), skillDataRoot: join(root, "skills"),
    }), { logger: false });
    apps.push(app);
    // 仅此测试宿主注入固定的可信身份，以验证 controller/service 装配；生产 OIDC 白名单不改动。
    const identities = new Map([
      ["editor", { roles: ["editor"], tenantId: "org-a" }],
      ["publisher", { roles: ["publisher"], tenantId: "org-a" }],
      ["viewer", { roles: ["viewer"], tenantId: "org-a" }],
      ["outsider", { roles: ["admin"], tenantId: "org-b" }],
      ["none", { roles: [], tenantId: "org-a" }],
    ]);
    app.use((req: Request, res: Response, next: NextFunction) => {
      const selection = identities.get(String(req.headers["x-test-user"]));
      if (!selection) { res.sendStatus(401); return; }
      const identity = verifiedIdentityFromClaims({ iss: "issuer", sub: String(req.headers["x-test-user"]),
        organization: { org: { id: selection.tenantId } }, orbit_org_roles: { [selection.tenantId]: selection.roles } });
      runWithOrganizationAuthorization(identity, next);
    });
    const limits = createTenantHttpLimits(); app.use(limits.middleware);
    const originalClose = app.close.bind(app);
    app.close = async () => { limits.close(); return originalClose(); };
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const request = (user: string, path: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
      method, headers: { "x-test-user": user, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect((await request("editor", "/api/sops", "POST", { draft: createTestDraft("workflow-a") })).status).toBe(201);
    const deniedPublish = await request("editor", "/api/sops/workflow-a/publish", "POST", { expectedRevision: 0 });
    expect(deniedPublish.status).toBe(403);
    expect(await deniedPublish.json()).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
    const published = await request("publisher", "/api/sops/workflow-a/publish", "POST", { expectedRevision: 0, createdBy: "forged" });
    expect(published.status).toBe(201);
    expect(await published.json()).toMatchObject({ data: { createdBy: "publisher" } });
    expect((await request("viewer", "/api/sops/workflow-a", "DELETE")).status).toBe(403);
    expect((await request("outsider", "/api/sops/workflow-a")).status).toBe(404);
    expect((await request("outsider", "/api/sops/storage/health")).status).toBe(403);
    for (const [path, method, body] of [
      ["/api/workflow-runs", "POST", { workflowId: "workflow-a", mode: "draft" }],
      ["/api/workflow-runs/run-a/cancel", "POST", {}],
      ["/api/workflow-runs/run-a/resume", "POST", {}],
    ] as const) {
      const denied = await request("viewer", path, method, body);
      expect(denied.status, path).toBe(403);
      expect(await denied.json()).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
    }
    expect((await request("none", "/api/workflow-runs/run-a/events")).status).toBe(403);
    expect((await request("none", "/api/sop-templates")).status).toBe(403);
    expect(upstreamHits).toBe(0);
    for (let i = 0; i < TENANT_HTTP_LIMITS.readRequests; i++) await request("viewer", "/api/sops/workflow-a");
    const limited = await request("viewer", "/api/sops/workflow-a");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toMatchObject({ error: { code: "TENANT_REQUEST_RATE_LIMIT" } });
    expect((await request("outsider", "/api/sops")).status).toBe(200);
  });
});
