import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTenantHttpLimits, TENANT_HTTP_LIMITS } from "../../src/tenant-http-limits.js";
import { runWithServiceTenant } from "../../src/tenant-context.js";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(stream = false) {
  const app = express();
  const limits = createTenantHttpLimits(); cleanup.push(limits.close);
  app.use((req, _res, next) => {
    runWithServiceTenant({ issuer: String(req.headers["x-test-issuer"] ?? "issuer"),
      tenantId: String(req.headers["x-test-org"] ?? "org"), subject: String(req.headers["x-test-user"] ?? "alice") }, next);
  });
  app.use(limits.middleware);
  app.use((_req, res) => {
    if (stream) { res.setHeader("Content-Type", "text/event-stream"); res.flushHeaders(); res.write(": ready\n\n"); }
    else res.json({ ok: true });
  });
  const server: Server = await new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return `http://127.0.0.1:${address.port}`;
}

describe("可信组织 HTTP 配额", () => {
  it("单组织被拒绝请求不耗尽全局额度，多组织总请求仍受全局上限保护", async () => {
    const base = await fixture();
    for (let index = 0; index < TENANT_HTTP_LIMITS.globalRequests + 1; index++) {
      const response = await fetch(`${base}/workflow-runs`, { method: "POST" });
      expect(response.status).toBe(index < TENANT_HTTP_LIMITS.executionRequests ? 200 : 429);
      await response.body?.cancel();
    }
    expect((await fetch(`${base}/workflow-runs/r`, { headers: { "x-test-org": "healthy" } })).status).toBe(200);
    const remaining = TENANT_HTTP_LIMITS.globalRequests - TENANT_HTTP_LIMITS.executionRequests - 1;
    for (let index = 0; index < remaining; index++) {
      const response = await fetch(`${base}/workflow-runs/r`, { headers: { "x-test-org": `org-${Math.floor(index / TENANT_HTTP_LIMITS.readRequests)}` } });
      expect(response.status).toBe(200); await response.body?.cancel();
    }
    const response = await fetch(`${base}/workflow-runs/r`, { headers: { "x-test-org": "new-org" } });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  }, 15_000);

  it("多个组织的 SSE 合计不能突破全局连接上限", async () => {
    const base = await fixture(true);
    const controllers: AbortController[] = [];
    cleanup.push(() => controllers.forEach((controller) => controller.abort()));
    for (let index = 0; index < TENANT_HTTP_LIMITS.globalStreams; index++) {
      const controller = new AbortController(); controllers.push(controller);
      expect((await fetch(`${base}/workflow-runs/r/events`, { headers: { "x-test-org": `org-${Math.floor(index / TENANT_HTTP_LIMITS.tenantStreams)}` }, signal: controller.signal })).status).toBe(200);
    }
    const rejected = await fetch(`${base}/workflow-runs/r/events`, { headers: { "x-test-org": "new-org" } });
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toMatchObject({ error: { code: "TENANT_STREAM_LIMIT" } });
  });

  it("并发启动请求按组织共享额度，换成员不能绕过，其他 issuer 独立且控制/读请求保留额度", async () => {
    const base = await fixture();
    const responses = await Promise.all(Array.from({ length: 25 }, (_, index) => fetch(`${base}/workflow-runs`, {
      method: "POST", headers: { "x-test-user": `member-${index}`, "x-forwarded-for": `10.0.0.${index}` },
    })));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(TENANT_HTTP_LIMITS.executionRequests);
    const rejected = responses.find((response) => response.status === 429)!;
    expect(Number(rejected.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await rejected.json()).toMatchObject({ error: { code: "TENANT_REQUEST_RATE_LIMIT" } });
    expect((await fetch(`${base}/workflow-runs/r/cancel`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`${base}/workflow-runs/r`)).status).toBe(200);
    expect((await fetch(`${base}/workflow-runs`, { method: "POST", headers: { "x-test-issuer": "another" } })).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + TENANT_HTTP_LIMITS.windowMs + 1);
    expect((await fetch(`${base}/workflow-runs`, { method: "POST" })).status).toBe(200);
  });

  it("SSE 达到并发上限时拒绝，断开后释放一次，其他组织仍可连接", async () => {
    const base = await fixture(true);
    const controllers = Array.from({ length: TENANT_HTTP_LIMITS.tenantStreams }, () => new AbortController());
    cleanup.push(() => controllers.forEach((controller) => controller.abort()));
    await Promise.all(controllers.map((controller) => fetch(`${base}/workflow-runs/r/events`, { signal: controller.signal })));
    const rejected = await fetch(`${base}/WORKFLOW-RUNS/r/EVENTS/`);
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toMatchObject({ error: { code: "TENANT_STREAM_LIMIT" } });
    const other = new AbortController(); controllers.push(other);
    expect((await fetch(`${base}/workflow-runs/r/events`, { headers: { "x-test-org": "other" }, signal: other.signal })).status).toBe(200);
    controllers[0]!.abort();
    const replacement = new AbortController(); controllers.push(replacement);
    await vi.waitFor(async () => {
      const response = await fetch(`${base}/workflow-runs/r/events`, { signal: replacement.signal });
      expect(response.status).toBe(200);
    });
  });
});
