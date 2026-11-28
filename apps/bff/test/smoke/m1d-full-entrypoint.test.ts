import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { builtinNodeRegistry } from "@orbit/workflow-core";
import Database from "better-sqlite3";
import { WorkflowSseDecoder } from "../../src/workflow-runs/sse-decoder.js";
import { ORGANIZATION_WORKFLOW_APPROVAL_POLICY } from "../../src/identity/workflow-approval-policy.js";
import { createBffHttpServer } from "../../src/server.js";
import { cookieJar, listenHttp, startAgentProcess, stopAgent } from "../helpers/workflow-http-fixture.js";
import { createTestDraft } from "../unit/sops/test-fixtures.js";

const serviceToken = "m1d-full-entrypoint-service-token-0123456789";
const servers: Server[] = [];
const children: ChildProcess[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await Promise.all(children.splice(0).map(stopAgent));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function listen(server: Server, port = 0): Promise<string> {
  servers.push(server);
  return listenHttp(server, port);
}

async function startAgent(root: string, port = 0): Promise<string> {
  const { child, baseURL } = await startAgentProcess(root, serviceToken, port);
  children.push(child);
  return baseURL;
}

function approvalWorkflow() {
  const workflow = createTestDraft("m1d-full-chain");
  const definition = builtinNodeRegistry.get("human-approval")!;
  const config = definition.createDefaultConfig();
  config.policyId = ORGANIZATION_WORKFLOW_APPROVAL_POLICY;
  const approval = {
    kind: "builtin" as const, id: "approval", type: "human-approval" as const, version: definition.version,
    label: "审批", position: { x: 0, y: 80 }, config, ports: definition.createPorts(config),
  };
  workflow.nodes = [workflow.nodes[0]!, approval, workflow.nodes[1]!];
  workflow.edges = [
    { id: "start-approval", source: { nodeId: "start", portId: "out" }, target: { nodeId: "approval", portId: "in" } },
    { id: "approval-end", source: { nodeId: "approval", portId: "approved" }, target: { nodeId: "end", portId: "in" } },
  ];
  return workflow;
}

async function login(baseURL: string, jar = cookieJar()): Promise<ReturnType<typeof cookieJar>> {
  const start = await fetch(`${baseURL}/auth/login`, { redirect: "manual" });
  expect(start.status).toBe(302);
  jar.receive(start);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  expect(authorize.status).toBe(302);
  expect(new URL(authorize.headers.get("location")!).origin).toBe(baseURL);
  const callback = await fetch(authorize.headers.get("location")!, { headers: { Cookie: jar.header() }, redirect: "manual" });
  jar.receive(callback);
  expect(callback.status).toBe(302);
  return jar;
}

async function expectStreamClosed(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  const closed = (async () => { try { while (!(await reader.read()).done) { /* 消费关闭前已在途的 frame。 */ } } catch { /* 服务端可 destroy 连接。 */ } })();
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([closed, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Revoked stream stayed open")), 2_500); })]);
  } finally { clearTimeout(timer!); reader.releaseLock(); }
}

describe("M1-D 完整认证到 Workflow Runtime 入口", () => {
  it("登录后创建并运行，跨组织拒绝，重启后由其他成员审批并回放 SSE", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-m1d-full-entrypoint-")); roots.push(root);
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(publicKey), kid: "m1d-key", use: "sig", alg: "RS256" };
    const state: { subject: string; roles: Record<string, string[]> } = { subject: "alice", roles: { "org-a": ["editor", "approver"] } };
    let issuer = "";
    const provider = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", issuer || "http://127.0.0.1");
      const json = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
      if (url.pathname === "/.well-known/openid-configuration") {
        json(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"], grant_types_supported: ["authorization_code"], token_endpoint_auth_methods_supported: ["client_secret_basic"],
          id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"] }); return;
      }
      if (url.pathname === "/jwks") { json(200, { keys: [jwk] }); return; }
      if (url.pathname === "/authorize") {
        if (url.searchParams.get("code_challenge_method") !== "S256") { json(400, { error: "pkce_required" }); return; }
        const callback = new URL(url.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", randomUUID()); callback.searchParams.set("state", url.searchParams.get("state") ?? "");
        codes.set(callback.searchParams.get("code")!, { challenge: url.searchParams.get("code_challenge") ?? "", nonce: url.searchParams.get("nonce") ?? "" });
        res.writeHead(302, { Location: callback.toString() }); res.end(); return;
      }
      if (url.pathname === "/token" && req.method === "POST") {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const code = codes.get(body.get("code") ?? "");
        const verifier = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
        const credentials = Buffer.from(req.headers.authorization?.split(" ")[1] ?? "", "base64").toString("utf8").split(":");
        if (!code || code.challenge !== verifier || !req.headers.authorization?.startsWith("Basic ")
          || decodeURIComponent(credentials[0] ?? "") !== "orbit-web" || decodeURIComponent(credentials[1] ?? "") !== "client-secret") {
          json(401, { error: "invalid_grant" }); return;
        }
        codes.delete(body.get("code")!);
        const idToken = await new SignJWT({ nonce: code.nonce, sid: `sid-${state.subject}`, organization: { alpha: { id: "org-a" }, beta: { id: "org-b" } }, orbit_org_roles: state.roles })
          .setProtectedHeader({ alg: "RS256", kid: "m1d-key" }).setIssuer(issuer).setAudience("orbit-web").setSubject(state.subject).setIssuedAt().setExpirationTime("5m").sign(privateKey);
        json(200, { token_type: "Bearer", access_token: "unused", refresh_token: "unused", expires_in: 300, id_token: idToken }); return;
      }
      json(404, { error: "not_found" });
    });
    const codes = new Map<string, { challenge: string; nonce: string }>();
    issuer = await listen(provider);
    const agent = await startAgent(root);
    const probe = createServer();
    const bffURL = await listen(probe);
    const bffPort = Number(new URL(bffURL).port);
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    servers.splice(servers.indexOf(probe), 1);
    const startBff = async () => {
      const server = await createBffHttpServer({
      agentBaseUrl: agent, agentServiceToken: serviceToken, filePath: join(root, "business.json"), skillDataRoot: join(root, "skills"), sopDataRoot: join(root, "sops"),
      identity: { mode: "saas", baseURL: bffURL, issuerBaseURL: issuer, jwksURL: `${issuer}/jwks`, clientID: "orbit-web", clientSecret: "client-secret", sessionSecret: "b".repeat(64), sessionStorePath: join(root, "sessions.sqlite"), workflowAccess: "restricted" },
      });
      await listen(server, bffPort);
      return server;
    };
    let bff = await startBff();
    const alice = await login(bffURL);
    const request = (jar: ReturnType<typeof cookieJar>) => (path: string, init: RequestInit = {}) => fetch(`${bffURL}${path}`, {
      signal: AbortSignal.timeout(10_000), ...init,
      // 重启用例使用新 TCP 连接，避免测试客户端复用已关闭进程的 keep-alive socket。
      headers: { Cookie: jar.header(), Connection: "close", ...(init.method && init.method !== "GET" ? { Origin: bffURL, "Content-Type": "application/json" } : {}), ...init.headers },
    });
    const aliceRequest = request(alice);
    const workflow = approvalWorkflow();
    expect((await fetch(`${bffURL}/api/sops`)).status).toBe(401);
    expect((await aliceRequest("/api/sops", { method: "POST", body: JSON.stringify({ draft: workflow }), headers: { Origin: "https://evil.example" } })).status).toBe(403);
    const created = await aliceRequest("/api/sops", { method: "POST", body: JSON.stringify({ draft: workflow }) });
    expect(created.status).toBe(201);
    expect((await aliceRequest("/api/sops")).status).toBe(200);
    expect((await aliceRequest(`/api/sops/${workflow.id}`, { method: "PUT", body: JSON.stringify({ expectedRevision: 0, draft: { ...workflow, name: "M1-D verified" } }) })).status).toBe(200);
    expect((await aliceRequest(`/api/sops/${workflow.id}/publish`, { method: "POST", body: JSON.stringify({ expectedRevision: 1, createdBy: "forged" }) })).status).toBe(403);

    state.subject = "bob"; state.roles = { "org-a": ["publisher", "approver"] };
    const bob = await login(bffURL);
    const bobRequest = request(bob);
    const published = await bobRequest(`/api/sops/${workflow.id}/publish`, { method: "POST", body: JSON.stringify({ expectedRevision: 1, createdBy: "forged" }) });
    expect(published.status, await published.clone().text()).toBe(201);
    const version = (await published.json() as { data: { id: string; createdBy: string } }).data;
    expect(version.createdBy).toBe("bob");
    expect((await bobRequest(`/api/sops/${workflow.id}/versions`)).status).toBe(200);
    expect((await bobRequest(`/api/sops/${workflow.id}/versions/${version.id}`)).status).toBe(200);
    const startInput = { workflowId: workflow.id, mode: "production", versionId: version.id };
    expect((await bobRequest("/api/workflow-runs", { method: "POST", body: JSON.stringify(startInput) })).status).toBe(403);
    const started = await aliceRequest("/api/workflow-runs", { method: "POST", body: JSON.stringify({ ...startInput, initiatedBy: "bob" }),
      headers: { "x-orbit-tenant-context": "forged", "x-orbit-roles": "admin" } });
    expect(started.status).toBe(201);
    const runId = (await started.json() as { data: { id: string } }).data.id;
    let interruptId = "";
    await expect.poll(async () => {
      const response = await aliceRequest(`/api/workflow-runs/${runId}`);
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { status: string; waiting?: { waiting?: { interruptId: string } } } };
      interruptId = body.data.waiting?.waiting?.interruptId ?? "";
      return body.data.status;
    }, { timeout: 10_000 }).toBe("waiting");
    expect(interruptId).not.toBe("");
    const decision = { interruptId, action: "approve", idempotencyKey: "bob-1", data: { comment: "private-decision-text" } };
    const selfApproval = await aliceRequest(`/api/workflow-runs/${runId}/resume`, { method: "POST", body: JSON.stringify(decision) });
    expect(selfApproval.status).toBe(403);
    expect(await selfApproval.json()).toMatchObject({ error: { code: "WORKFLOW_SELF_APPROVAL_FORBIDDEN" } });
    expect((await aliceRequest(`/api/workflow-runs/${runId}/cancel`, { method: "POST", body: "{}" })).status).toBe(403);

    // 真实 HTTP SSE 收到 waiting 后断线，再从最后事件 ID 回放；断线不取消运行。
    const streamAbort = new AbortController();
    const stream = await aliceRequest(`/api/workflow-runs/${runId}/events`, { signal: AbortSignal.any([streamAbort.signal, AbortSignal.timeout(10_000)]) });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const decoder = new WorkflowSseDecoder();
    const text = new TextDecoder();
    let lastEventId = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        expect(chunk.done).toBe(false);
        const events = decoder.push(text.decode(chunk.value, { stream: true })).map(WorkflowSseDecoder.runtimeEvent).filter((event) => event !== undefined);
        lastEventId = events.at(-1)?.id ?? lastEventId;
        if (events.some((event) => event.type === "run.waiting" || (event.type === "run.status" && event.status === "waiting"))) break;
      }
      expect((await aliceRequest("/api/auth/tenant", { method: "POST", body: JSON.stringify({ tenantId: "org-b" }) })).status).toBe(200);
      // 已有连接必须关闭，而不能只让下次请求拒绝。超时/网络中断与正常 EOF 都允许。
      await expectStreamClosed(reader);
      expect((await aliceRequest("/api/auth/tenant", { method: "POST", body: JSON.stringify({ tenantId: "org-a" }) })).status).toBe(200);
    } finally { streamAbort.abort(); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    expect(lastEventId).toBeGreaterThan(0);

    await stopAgent(children[0]!);
    expect(await startAgent(root, Number(new URL(agent).port))).toBe(agent);
    bff.closeAllConnections();
    await new Promise<void>((resolve) => bff.close(() => resolve()));
    servers.splice(servers.indexOf(bff), 1);
    bff = await startBff();
    await expect.poll(async () => (await bobRequest(`/api/workflow-runs/${runId}`)).status, { timeout: 5_000 }).toBe(200);
    const resumed = await bobRequest(`/api/workflow-runs/${runId}/resume`, { method: "POST", body: JSON.stringify(decision) });
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ data: { status: "succeeded" } });
    expect((await bobRequest(`/api/workflow-runs/${runId}/resume`, { method: "POST", body: JSON.stringify(decision) })).status).toBe(200);
    const conflict = await bobRequest(`/api/workflow-runs/${runId}/resume`, { method: "POST", body: JSON.stringify({ ...decision, action: "reject" }) });
    expect(conflict.status).toBe(409);
    const replay = await bobRequest(`/api/workflow-runs/${runId}/events`, { headers: { "Last-Event-ID": String(lastEventId) } });
    expect(replay.status).toBe(200);
    const replayText = await replay.text();
    const replayEvents = replayText.split("\n\n").filter(Boolean).map(WorkflowSseDecoder.runtimeEvent).filter((event) => event !== undefined);
    expect(replayEvents.every((event) => event.id > lastEventId)).toBe(true);
    expect(replayText).toContain('"status":"succeeded"');

    state.subject = "mallory"; state.roles = { "org-a": ["viewer"], "org-b": ["admin"] };
    const mallory = await login(bffURL);
    const malloryRequest = request(mallory);
    expect((await malloryRequest(`/api/workflow-runs/${runId}/resume`, { method: "POST", body: JSON.stringify(decision) })).status).toBe(403);
    expect((await malloryRequest("/api/auth/tenant", { method: "POST", body: JSON.stringify({ tenantId: "org-b", roles: ["admin"] }) })).status).toBe(200);
    for (const [path, method, body] of [
      [`/api/sops/${workflow.id}`, "GET", undefined],
      [`/api/sops/${workflow.id}`, "PUT", { expectedRevision: 1, draft: workflow }],
      [`/api/sops/${workflow.id}/versions/${version.id}`, "GET", undefined],
      [`/api/workflow-runs/${runId}`, "GET", undefined],
      [`/api/workflow-runs/${runId}/events`, "GET", undefined],
      [`/api/workflow-runs/${runId}/resume`, "POST", decision],
      [`/api/workflow-runs/${runId}/cancel`, "POST", {}],
    ] as const) {
      const response = await malloryRequest(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(response.status, path).toBe(404);
    }
    expect(await (await malloryRequest("/api/sops")).json()).toMatchObject({ data: [] });
    for (const path of ["/api/sops/storage/health", "/api/sessions", "/api/skills", "/api/sop-templates", "/api/models", "/api/sops/m1d-full-chain/", "/api/sops/%6d1d-full-chain"]) {
      expect((await malloryRequest(path)).status, path).toBe(403);
    }

    // 只有 operator 可取消；Bob 的发布/审批权限不能自动获得取消权。
    const second = await aliceRequest("/api/workflow-runs", { method: "POST", body: JSON.stringify(startInput) });
    expect(second.status).toBe(201);
    const secondId = (await second.json() as { data: { id: string } }).data.id;
    expect((await bobRequest(`/api/workflow-runs/${secondId}/cancel`, { method: "POST", body: "{}" })).status).toBe(403);
    state.subject = "carol"; state.roles = { "org-a": ["operator"] };
    const carol = await login(bffURL);
    expect((await request(carol)(`/api/workflow-runs/${secondId}/cancel`, { method: "POST", body: "{}" })).status).toBe(202);

    const third = await aliceRequest("/api/workflow-runs", { method: "POST", body: JSON.stringify(startInput) });
    expect(third.status).toBe(201);
    const thirdId = (await third.json() as { data: { id: string } }).data.id;
    const bobStream = await bobRequest(`/api/workflow-runs/${thirdId}/events`);
    const aliceStream = await aliceRequest(`/api/workflow-runs/${thirdId}/events`);
    expect(bobStream.status).toBe(200); expect(aliceStream.status).toBe(200);
    const bobReader = bobStream.body!.getReader();
    const aliceReader = aliceStream.body!.getReader();
    expect((await bobReader.read()).done).toBe(false);
    expect((await aliceReader.read()).done).toBe(false);

    const logoutToken = await new SignJWT({ sid: "sid-bob", events: { "http://schemas.openid.net/event/backchannel-logout": {} } })
      .setProtectedHeader({ alg: "RS256", kid: "m1d-key" }).setIssuer(issuer).setAudience("orbit-web").setSubject("bob").setIssuedAt().sign(privateKey);
    expect((await fetch(`${bffURL}/auth/backchannel-logout`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ logout_token: logoutToken }) })).status).toBe(204);
    await expectStreamClosed(bobReader);
    expect((await bobRequest(`/api/workflow-runs/${runId}`)).status).toBe(401);
    expect((await aliceRequest("/api/auth/logout", { method: "POST", body: "{}" })).status).toBe(200);
    await expectStreamClosed(aliceReader);
    expect((await aliceRequest(`/api/workflow-runs/${runId}`)).status).toBe(401);
    await expect.poll(async () => (await request(carol)(`/api/workflow-runs/${thirdId}`)).json())
      .toMatchObject({ data: { status: "waiting" } });

    const database = new Database(join(root, "sops", "workflows.sqlite"), { readonly: true });
    try {
      expect(database.prepare("select issuer, tenant_id, initiated_by from workflow_runs where id = ?").get(runId)).toEqual({ issuer, tenant_id: "org-a", initiated_by: "alice" });
      const audits = database.prepare("select subject, action, detail_json from organization_audit_events where phase = 'succeeded'").all();
      expect(audits).toEqual(expect.arrayContaining([expect.objectContaining({ subject: "alice", action: "workflow.edit" }), expect.objectContaining({ subject: "bob", action: "workflow.approve" })]));
      expect(JSON.stringify(audits)).not.toContain("private-decision-text");
    } finally { database.close(); }
  }, 90_000);
});
