import type { Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it, afterEach, expect } from "vitest";
import { createBffHttpServer } from "../../src/server.js";
import { createKeycloakFixture } from "../helpers/keycloak-fixture.js";
import { cleanupFixture, cookieJar, listenHttp, startAgentProcess, stopAgent } from "../helpers/workflow-http-fixture.js";
import { createTestHttpsProxy } from "../../../../scripts/test-https-proxy.mjs";
import { createOrganizationApprovalWorkflow } from "../../../web-console/src/features/tenant-workflows/approval-workflow.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(() => cleanupFixture(cleanup));
const closeServer = (server: Server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });

describe.skipIf(!process.env.ORBIT_KEYCLOAK_FIXTURE_PATH || !process.env.ORBIT_CAPACITY_SMOKE)("M1 小规模混合负载", () => {
  it("10 组织同时持有 10 个审批运行和 10 条 SSE，持续查询一分钟后仍能取消与再运行", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-m1-capacity-")); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const configPath = process.env.ORBIT_KEYCLOAK_FIXTURE_PATH!;
    const tls = JSON.parse(await readFile(configPath, "utf8")) as { keyPath: string; certPath: string };
    let backend: string | undefined;
    const proxy: Server = await createTestHttpsProxy(tls.keyPath, tls.certPath, () => backend); cleanup.push(() => closeServer(proxy));
    const baseURL = (await listenHttp(proxy)).replace("http:", "https:");
    const keycloak = await createKeycloakFixture(configPath, baseURL); cleanup.push(keycloak.close);
    const token = "capacity-service-token-0123456789abcdef";
    const agent = await startAgentProcess(root, token); cleanup.push(() => stopAgent(agent.child));
    const bff = await createBffHttpServer({
      agentBaseUrl: agent.baseURL, agentServiceToken: token, filePath: join(root, "business.json"), skillDataRoot: join(root, "skills"), sopDataRoot: join(root, "sops"),
      identity: { mode: "saas", baseURL, issuerBaseURL: keycloak.issuer, jwksURL: `${keycloak.issuer}/protocol/openid-connect/certs`, clientID: keycloak.clientID,
        clientSecret: keycloak.clientSecret, sessionSecret: "e".repeat(64), sessionStorePath: join(root, "sessions.sqlite"), workflowAccess: "restricted" },
    });
    cleanup.push(() => closeServer(bff)); backend = await listenHttp(bff);
    const request = (jar: ReturnType<typeof cookieJar>, path: string, body?: unknown) => fetch(`${baseURL}${path}`, {
      method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(5_000), headers: { Cookie: jar.header(),
        ...(body === undefined ? {} : { Origin: baseURL, "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    // 使用页面的真实模板，避免容量验收只运行特制空流程。
    const draft = createOrganizationApprovalWorkflow("容量验收", "需组织成员审批的正文。".repeat(100));
    const clients = [];
    for (let index = 0; index < 10; index++) {
      const tenantId = await keycloak.createOrganizationUser(`capacity-${index}`, `capacity-${index}`);
      const jar = await keycloak.login(baseURL, `capacity-${index}`);
      expect((await request(jar, "/api/sops", { draft })).status).toBe(201);
      const published = await request(jar, `/api/sops/${draft.id}/publish`, { expectedRevision: 0 });
      expect(published.status).toBe(201);
      const versionId = (await published.json() as { data: { id: string } }).data.id;
      clients.push({ tenantId, jar, versionId, runId: "" });
    }
    expect(new Set(clients.map((client) => client.tenantId)).size).toBe(10);
    const starts = await Promise.all(clients.map(async (client) => {
      const response = await request(client.jar, "/api/workflow-runs", { workflowId: draft.id, versionId: client.versionId, mode: "production" });
      expect(response.status, await response.clone().text()).toBe(201);
      client.runId = (await response.json() as { data: { id: string } }).data.id;
    }));
    expect(starts).toHaveLength(10);
    await expect.poll(async () => Promise.all(clients.map(async (client) => {
      const response = await request(client.jar, `/api/workflow-runs/${client.runId}`);
      expect(response.status).toBe(200);
      return (await response.json() as { data: { status: string } }).data.status;
    })), { timeout: 15_000 }).toEqual(Array(10).fill("waiting"));
    const controller = new AbortController(); cleanup.push(async () => { controller.abort(); });
    const streams = await Promise.all(clients.map((client) => fetch(`${baseURL}/api/workflow-runs/${client.runId}/events`, {
      headers: { Cookie: client.jar.header() }, signal: controller.signal,
    })));
    const readers = streams.map((stream) => { expect(stream.status).toBe(200); return stream.body!.getReader(); });
    const ended = new Set<number>();
    const streamErrors: string[] = [];
    const drains = readers.map(async (reader, index) => {
      try { while (!(await reader.read()).done) { /* 消费真实事件和心跳，不把 SSE 留在未读取状态。 */ } }
      catch (error) { if (!controller.signal.aborted) streamErrors.push(String(error)); }
      finally { ended.add(index); reader.releaseLock(); }
    });
    cleanup.push(async () => { controller.abort(); await Promise.allSettled(drains); });
    const latency: number[] = [];
    const startedAt = performance.now();
    for (let batch = 0; batch < 60; batch++) {
      const tick = performance.now();
      await Promise.all(clients.map(async (client) => {
        const started = performance.now();
        const response = await request(client.jar, `/api/workflow-runs/${client.runId}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ data: { id: client.runId, status: "waiting" } });
        latency.push(performance.now() - started);
      }));
      expect(ended.size).toBe(0);
      expect(streamErrors).toEqual([]);
      await delay(Math.max(0, 1_000 - (performance.now() - tick)));
    }
    latency.sort((left, right) => left - right);
    console.info("M1 capacity measurements", JSON.stringify({ organizations: 10, unfinishedRuns: 10, sseConnections: 10, queries: latency.length,
      durationSeconds: Number(((performance.now() - startedAt) / 1_000).toFixed(2)),
      p95Ms: Number(latency[Math.ceil(latency.length * 0.95) - 1].toFixed(2)), p99Ms: Number(latency[Math.ceil(latency.length * 0.99) - 1].toFixed(2)), maxMs: Number(latency.at(-1)!.toFixed(2)) }));
    // 查询压力不应夺走控制操作额度；每个组织仍只能访问自己的运行。
    for (let index = 0; index < clients.length; index++) {
      const client = clients[index]!;
      expect((await request(client.jar, `/api/workflow-runs/${clients[(index + 1) % clients.length]!.runId}`)).status).toBe(404);
    }
    await Promise.all(clients.map(async (client) => {
      expect((await request(client.jar, `/api/workflow-runs/${client.runId}/cancel`, {})).status).toBe(202);
    }));
    await expect.poll(() => ended.size).toBe(10);
    await Promise.all(clients.map(async (client) => {
      const replacement = await request(client.jar, "/api/workflow-runs", { workflowId: draft.id, versionId: client.versionId, mode: "production" });
      expect(replacement.status).toBe(201);
      const id = (await replacement.json() as { data: { id: string } }).data.id;
      expect((await request(client.jar, `/api/workflow-runs/${id}/cancel`, {})).status).toBe(202);
    }));
  }, 150_000);
});
