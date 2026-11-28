import type { Server } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinNodeRegistry } from "@orbit/workflow-core";
import { createBffHttpServer } from "../../src/server.js";
import { ORGANIZATION_WORKFLOW_APPROVAL_POLICY } from "../../src/identity/workflow-approval-policy.js";
import { createTestDraft } from "../unit/sops/test-fixtures.js";
import { createKeycloakFixture } from "../helpers/keycloak-fixture.js";
import { cookieJar, listenHttp, startAgentProcess, stopAgent } from "../helpers/workflow-http-fixture.js";
import { createTestHttpsProxy } from "../../../../scripts/test-https-proxy.mjs";
import { TENANT_WORKFLOW_QUOTAS } from "@orbit/service-auth";
import { TENANT_HTTP_LIMITS } from "@orbit/service-auth/http";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe.skipIf(!process.env.ORBIT_KEYCLOAK_FIXTURE_PATH)("真实 Keycloak Organizations → BFF → Agent", () => {
  it("真实组织和角色声明驱动发布/审批，跨组织拒绝，IdP 注销关闭活动 SSE", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-keycloak-workflow-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const tls = JSON.parse(await readFile(process.env.ORBIT_KEYCLOAK_FIXTURE_PATH!, "utf8")) as { keyPath: string; certPath: string };
    let backend: string | undefined;
    const proxy: Server = await createTestHttpsProxy(tls.keyPath, tls.certPath, () => backend);
    cleanup.push(() => new Promise<void>((resolve) => { proxy.closeAllConnections(); proxy.close(() => resolve()); }));
    const publicHTTP = await listenHttp(proxy);
    const baseURL = publicHTTP.replace("http:", "https:");
    const keycloak = await createKeycloakFixture(process.env.ORBIT_KEYCLOAK_FIXTURE_PATH!, baseURL);
    cleanup.push(keycloak.close);
    const token = "keycloak-smoke-service-token-0123456789abcdef";
    let agent = await startAgentProcess(root, token);
    cleanup.push(() => stopAgent(agent.child));
    const bff: Server = await createBffHttpServer({
      agentBaseUrl: agent.baseURL, agentServiceToken: token, filePath: join(root, "business.json"), skillDataRoot: join(root, "skills"), sopDataRoot: join(root, "sops"),
      identity: { mode: "saas", baseURL, issuerBaseURL: keycloak.issuer, jwksURL: `${keycloak.issuer}/protocol/openid-connect/certs`,
        clientID: keycloak.clientID, clientSecret: keycloak.clientSecret, sessionSecret: "c".repeat(64), sessionStorePath: join(root, "sessions.sqlite"), workflowAccess: "restricted" },
    });
    cleanup.push(() => new Promise<void>((resolve, reject) => { bff.closeAllConnections(); bff.close((error) => error ? reject(error) : resolve()); }));
    backend = await listenHttp(bff);
    const alice = await keycloak.login(baseURL, "alice");
    const bob = await keycloak.login(baseURL, "bob");
    const mallory = await keycloak.login(baseURL, "mallory");
    const request = (jar: ReturnType<typeof cookieJar>, path: string, body?: unknown) => fetch(`${baseURL}${path}`, {
      method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10_000), headers: {
        Cookie: jar.header(), Connection: "close", ...(body === undefined ? {} : { Origin: baseURL, "Content-Type": "application/json" }),
      }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(await (await request(alice, "/api/auth/session")).json()).toMatchObject({
      tenantId: keycloak.orgs.alpha, roles: expect.arrayContaining(["editor", "approver"]),
      organizations: [expect.objectContaining({ id: keycloak.orgs.alpha })],
    });
    expect(await (await request(mallory, "/api/auth/session")).json()).toMatchObject({ tenantId: keycloak.orgs.beta, roles: ["admin"] });
    const workflow = createTestDraft("keycloak-workflow");
    const definition = builtinNodeRegistry.get("human-approval")!;
    const config = { ...definition.createDefaultConfig(), policyId: ORGANIZATION_WORKFLOW_APPROVAL_POLICY };
    workflow.nodes.splice(1, 0, { kind: "builtin", id: "approval", type: "human-approval", version: definition.version, label: "审批", position: { x: 0, y: 80 }, config, ports: definition.createPorts(config) });
    workflow.edges = [
      { id: "start-approval", source: { nodeId: "start", portId: "out" }, target: { nodeId: "approval", portId: "in" } },
      { id: "approval-end", source: { nodeId: "approval", portId: "approved" }, target: { nodeId: "end", portId: "in" } },
    ];
    expect((await request(alice, "/api/sops", { draft: workflow })).status).toBe(201);
    // 使用页面实际调用的 autosave 入口，而非只验证 PUT 保存。
    const autosaved = await request(alice, `/api/sops/${workflow.id}/autosave`, { expectedRevision: 0, draft: workflow });
    expect(autosaved.status).toBe(200);
    expect(await autosaved.json()).toMatchObject({ data: { revision: 1 } });
    expect((await request(bob, `/api/sops/${workflow.id}/autosave`, { expectedRevision: 1, draft: workflow })).status).toBe(403);
    expect((await request(mallory, `/api/sops/${workflow.id}/autosave`, { expectedRevision: 1, draft: workflow })).status).toBe(404);
    const published = await request(bob, `/api/sops/${workflow.id}/publish`, { expectedRevision: 1 });
    expect(published.status, await published.clone().text()).toBe(201);
    const version = (await published.json() as { data: { id: string } }).data;
    const started = await request(alice, "/api/workflow-runs", { workflowId: workflow.id, versionId: version.id, mode: "production" });
    expect(started.status, await started.clone().text()).toBe(201);
    const runId = (await started.json() as { data: { id: string } }).data.id;
    let interruptId = "";
    await expect.poll(async () => {
      const body = await (await request(alice, `/api/workflow-runs/${runId}`)).json() as { data: { status: string; waiting?: { waiting?: { interruptId: string } } } };
      interruptId = body.data.waiting?.waiting?.interruptId ?? "";
      return body.data.status;
    }).toBe("waiting");
    expect((await request(mallory, `/api/workflow-runs/${runId}`)).status).toBe(404);
    const decision = { interruptId, action: "approve", idempotencyKey: "keycloak-approve", data: {} };
    expect((await request(alice, `/api/workflow-runs/${runId}/resume`, decision)).status).toBe(403);
    const stream = await request(alice, `/api/workflow-runs/${runId}/events`);
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await keycloak.logout("alice");
    const ended = (async () => { try { while (!(await reader.read()).done) { /* consume in-flight frames */ } } catch { /* server closes the revoked connection */ } })();
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([ended, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Keycloak logout did not close SSE")), 3_000); })]);
    } finally { clearTimeout(timer!); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    expect((await request(alice, `/api/workflow-runs/${runId}`)).status).toBe(401);
    const resumed = await request(bob, `/api/workflow-runs/${runId}/resume`, decision);
    expect(resumed.status, await resumed.clone().text()).toBe(200);
    expect(await resumed.json()).toMatchObject({ data: { status: "succeeded" } });

    await keycloak.setRoles("alice", ["editor", "approver", "operator"]);
    const operator = await keycloak.login(baseURL, "alice");
    const command = { workflowId: workflow.id, versionId: version.id, mode: "production" };
    const overloaded = await Promise.all(Array.from({ length: 8 }, () => request(operator, "/api/workflow-runs", command)));
    const accepted = overloaded.filter((response) => response.status === 201);
    const rejected = overloaded.filter((response) => response.status === 429);
    expect(accepted).toHaveLength(TENANT_WORKFLOW_QUOTAS.unfinishedRuns);
    expect(rejected).toHaveLength(3);
    for (const response of rejected) {
      expect(response.headers.get("retry-after")).toBe("60");
      expect(await response.json()).toMatchObject({ error: { code: "WORKFLOW_CONCURRENCY_LIMIT" } });
    }
    const ids = await Promise.all(accepted.map(async (response) => (await response.json() as { data: { id: string } }).data.id));
    await expect.poll(async () => {
      const bodies = await Promise.all(ids.map(async (id) => (await request(operator, `/api/workflow-runs/${id}`)).json() as Promise<{ data: { status: string } }>));
      return bodies.every((body) => body.data.status === "waiting");
    }, { timeout: 10_000 }).toBe(true);

    // 容量满的组织不能阻止另一组织创建相同 ID 的草稿和独立运行。
    expect((await request(mallory, "/api/sops", { draft: workflow })).status).toBe(201);
    const foreignVersion = await request(mallory, `/api/sops/${workflow.id}/publish`, { expectedRevision: 0 });
    expect(foreignVersion.status).toBe(201);
    const foreignVersionId = (await foreignVersion.json() as { data: { id: string } }).data.id;
    const foreignRun = await request(mallory, "/api/workflow-runs", { ...command, versionId: foreignVersionId });
    expect(foreignRun.status).toBe(201);
    const foreignId = (await foreignRun.json() as { data: { id: string } }).data.id;
    expect((await request(operator, `/api/workflow-runs/${foreignId}`)).status).toBe(404);

    const streams: Response[] = [];
    try {
      for (let index = 0; index < TENANT_HTTP_LIMITS.tenantStreams; index++) {
        const response = await request(operator, `/api/workflow-runs/${ids[0]}/events`);
        expect(response.status).toBe(200); streams.push(response);
      }
      const blocked = await request(operator, `/api/workflow-runs/${ids[0]}/events`);
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toMatchObject({ error: { code: "TENANT_STREAM_LIMIT" } });
      await streams.shift()!.body!.cancel();
      await expect.poll(async () => {
        const replacement = await request(operator, `/api/workflow-runs/${ids[0]}/events`);
        if (replacement.status === 200) streams.push(replacement); else await replacement.body?.cancel();
        return replacement.status;
      }).toBe(200);
    } finally { await Promise.all(streams.map((response) => response.body!.cancel())); }

    // SIGKILL 验证异常退出，而非只验证优雅关机；独占目录与原端口重用。
    const oldAgent = agent;
    const exited = new Promise<void>((resolve) => oldAgent.child.once("exit", () => resolve()));
    oldAgent.child.kill("SIGKILL"); await exited;
    const unavailable = await request(operator, `/api/workflow-runs/${ids[0]}`);
    expect(unavailable.status).toBe(502);
    agent = await startAgentProcess(root, token, Number(new URL(oldAgent.baseURL).port));
    const afterCrash = await request(operator, "/api/workflow-runs", command);
    expect(afterCrash.status).toBe(429);
    const restored = await request(bob, `/api/workflow-runs/${ids[0]}`);
    expect(restored.status).toBe(200);
    const restoredBody = await restored.json() as { data: { waiting: { waiting: { interruptId: string } } } };
    const recoveredDecision = { ...decision, interruptId: restoredBody.data.waiting.waiting.interruptId, idempotencyKey: "after-crash" };
    const approvals = await Promise.all(Array.from({ length: 4 }, () => request(bob, `/api/workflow-runs/${ids[0]}/resume`, recoveredDecision)));
    const approvalResults = await Promise.all(approvals.map(async (response) => ({ status: response.status, body: await response.json() })));
    expect(approvalResults).toEqual(Array.from({ length: 4 }, () => expect.objectContaining({ status: 200 })));
    const replacementRun = await request(operator, "/api/workflow-runs", command);
    expect(replacementRun.status).toBe(201);
    const replacementId = (await replacementRun.json() as { data: { id: string } }).data.id;
    for (const id of ids.slice(1)) expect((await request(operator, `/api/workflow-runs/${id}/cancel`, {})).status).toBe(202);

    // 用户降权后注销旧会话，新登录只能取得新的声明；旧 sid 墓碑不应阻止新 sid 登录。
    await keycloak.setRoles("bob", ["viewer"]);
    await keycloak.logout("bob");
    const downgraded = await keycloak.login(baseURL, "bob");
    expect(await (await request(downgraded, "/api/auth/session")).json()).toMatchObject({ roles: ["viewer"], permissions: ["workflow.read"] });
    expect((await request(downgraded, `/api/workflow-runs/${runId}/resume`, decision)).status).toBe(403);

    // 高频查询压满当前组织的读取窗口后，仍保留控制请求及其他组织的读取额度。
    const readStatuses: number[] = [];
    for (let batch = 0; batch < 10; batch++) {
      const responses = await Promise.all(Array.from({ length: 30 }, () => request(operator, `/api/workflow-runs/${runId}`)));
      for (const response of responses) { readStatuses.push(response.status); await response.body?.cancel(); }
    }
    expect(readStatuses.every((status) => status === 200 || status === 429)).toBe(true);
    expect(readStatuses).toContain(429);
    expect((await request(operator, `/api/workflow-runs/${replacementId}/cancel`, {})).status).toBe(202);
    expect((await request(mallory, `/api/workflow-runs/${foreignId}`)).status).toBe(200);

    // 真实已签名 Cookie、HTTP SSE 与持久化会话查询；只推进应用业务时钟，不改变 Keycloak 或定时器。
    const expiring = await request(mallory, `/api/workflow-runs/${foreignId}/events`);
    expect(expiring.status).toBe(200);
    const expirationReader = expiring.body!.getReader();
    expect((await expirationReader.read()).done).toBe(false);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301_000);
    let expiryTimer: ReturnType<typeof setTimeout>;
    try {
      const closed = (async () => { try { while (!(await expirationReader.read()).done) { /* drain */ } } catch { /* expired subscription closes */ } })();
      await Promise.race([closed, new Promise<never>((_resolve, reject) => { expiryTimer = setTimeout(() => reject(new Error("Expired session stream stayed open")), 3_000); })]);
      expect((await request(mallory, `/api/workflow-runs/${foreignId}`)).status).toBe(401);
    } finally { clock.mockRestore(); clearTimeout(expiryTimer!); await expirationReader.cancel().catch(() => undefined); expirationReader.releaseLock(); }
    await keycloak.removeMembership("mallory");
    await keycloak.logout("mallory");
    expect((await request(mallory, `/api/workflow-runs/${runId}`)).status).toBe(401);
    await expect(keycloak.login(baseURL, "mallory")).rejects.toThrow("BFF Keycloak callback failed: 401");
  }, 120_000);
});
