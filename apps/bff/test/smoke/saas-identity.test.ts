import { browserOrganizationContext } from "@orbit/runtime-contracts";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createBffHttpServer } from "../../src/server.js";

const servers: Server[] = [];
const roots: string[] = [];

async function listen(server: Server, port = 0) {
  servers.push(server);
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

async function availablePort() {
  const probe = createServer();
  const url = await listen(probe);
  const port = Number(new URL(url).port);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  servers.splice(servers.indexOf(probe), 1);
  return port;
}

afterEach(async () => {
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "orbit-saas-identity-")); roots.push(root);
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const { privateKey: wrongPrivateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", use: "sig", alg: "RS256" };
  const codes = new Map<string, { challenge: string; nonce: string }>();
  const state = { tokenHits: 0, upstreamHits: 0, clientAuthValid: false, pkceValid: false, variant: "valid", audience: "orbit-web", organization: { alpha: { id: "org-a" }, beta: { id: "org-b" } } as Record<string, { id: string }>, organizationRoles: undefined as unknown };
  let issuer = "";
  const provider = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", issuer || "http://127.0.0.1");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      json(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"], grant_types_supported: ["authorization_code"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"], id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"] });
      return;
    }
    if (url.pathname === "/jwks") { json(200, { keys: [jwk] }); return; }
    if (url.pathname === "/authorize") {
      if (url.searchParams.get("code_challenge_method") !== "S256") { json(400, { error: "pkce_required" }); return; }
      const code = randomUUID();
      codes.set(code, { challenge: url.searchParams.get("code_challenge") ?? "", nonce: url.searchParams.get("nonce") ?? "" });
      const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { Location: callback.toString() }); res.end();
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      state.tokenHits++;
      const raw: Buffer[] = [];
      for await (const chunk of req) raw.push(Buffer.from(chunk));
      const body = new URLSearchParams(Buffer.concat(raw).toString("utf8"));
      const challenge = codes.get(body.get("code") ?? "");
      const digest = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
      const basicParts = Buffer.from(req.headers.authorization?.split(" ")[1] ?? "", "base64").toString("utf8").split(":");
      state.clientAuthValid = req.headers.authorization?.startsWith("Basic ") === true && decodeURIComponent(basicParts[0] ?? "") === "orbit-web" && decodeURIComponent(basicParts[1] ?? "") === "client-secret";
      state.pkceValid = !!challenge && challenge.challenge === digest;
      if (!state.clientAuthValid || !state.pkceValid) {
        json(401, { error: "invalid_grant" }); return;
      }
      codes.delete(body.get("code") ?? "");
      const id_token = await new SignJWT({ nonce: state.variant === "nonce" ? "wrong-nonce" : challenge.nonce, sid: "sid-1", organization: state.variant === "organization" ? {} : state.organization,
        ...(state.organizationRoles === undefined ? {} : { orbit_org_roles: state.organizationRoles }) })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(state.variant === "issuer" ? "https://wrong.example" : issuer)
        .setAudience(state.variant === "audience" ? "other-client" : state.audience)
        .setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(state.variant === "signature" ? wrongPrivateKey : privateKey);
      json(200, { token_type: "Bearer", access_token: "access-secret-not-to-persist", refresh_token: "refresh-secret-not-to-persist", expires_in: 300, id_token });
      return;
    }
    json(404, { error: "not_found" });
  });
  issuer = await listen(provider);
  const upstream = await listen(createServer((_req, res) => { state.upstreamHits++; res.end("upstream"); }));
  const port = await availablePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const sessionStorePath = join(root, ".sessions", "session.sqlite");
  const bff = await createBffHttpServer({
    agentBaseUrl: upstream, agentServiceToken: "test-service-token-0123456789abcdef",
    filePath: join(root, "business.json"), skillDataRoot: join(root, "skills"), sopDataRoot: join(root, "sops"),
    identity: { mode: "saas", baseURL, issuerBaseURL: issuer, jwksURL: `${issuer}/jwks`, clientID: "orbit-web", clientSecret: "client-secret", sessionSecret: "a1".repeat(32), sessionStorePath },
  });
  await listen(bff, port);
  return { baseURL, issuer, privateKey, root, sessionStorePath, state };
}

function cookieJar() {
  const jar = new Map<string, string>();
  return {
    header: () => [...jar.values()].join("; "),
    names: () => [...jar.keys()],
    receive(response: Response) {
      for (const item of response.headers.getSetCookie()) {
        const cookie = item.split(";")[0];
        const name = cookie.split("=")[0];
        if (cookie.endsWith("=")) jar.delete(name); else jar.set(name, cookie);
      }
    },
  };
}

async function login(baseURL: string, issuer: string) {
  const jar = cookieJar();
  const start = await fetch(`${baseURL}/auth/login?returnTo=https%3A%2F%2Fevil.example`, { redirect: "manual" });
  expect(start.status).toBe(302);
  jar.receive(start);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  expect(authorize.status).toBe(302);
  const callbackUrl = authorize.headers.get("location")!;
  expect(new URL(callbackUrl).origin).toBe(baseURL);
  const callback = await fetch(callbackUrl, { headers: { Cookie: jar.header() }, redirect: "manual" });
  jar.receive(callback);
  return { jar, callback };
}

describe("SaaS identity and shared database boundary", () => {
  it("权限只来自签名组织声明，切换组织不能沿用权限或通过请求提权", async () => {
    const { baseURL, issuer, state } = await fixture();
    state.organizationRoles = { "org-a": ["admin"], "org-b": ["viewer"] };
    const { jar, callback } = await login(baseURL, issuer);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${baseURL}/studio`);
    const headers = { Cookie: jar.header(), "x-orbit-roles": "admin", "x-orbit-tenant-context": "forged" };
    const publicConfig = await fetch(`${baseURL}/api/auth/config`);
    expect(publicConfig.status).toBe(200);
    expect(await publicConfig.json()).toEqual({ ok: true, mode: "saas", workflowAccess: "disabled" });
    expect(publicConfig.headers.get("cache-control")).toBe("no-store");
    expect(publicConfig.headers.get("access-control-allow-origin")).toBeNull();
    const session = await fetch(`${baseURL}/api/auth/session`, { headers });
    expect(await session.json()).toMatchObject({ issuer, tenantId: "org-a", roles: ["admin"], permissions: expect.arrayContaining(["workflow.approve", "workflow.publish"]) });
    const switched = await fetch(`${baseURL}/api/auth/tenant`, {
      method: "POST", headers: { ...headers, Origin: baseURL, "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "org-b", roles: ["admin"], permissions: ["workflow.approve"] }),
    });
    expect(switched.status).toBe(200);
    const oldContext = browserOrganizationContext({ issuer, user: { subject: "user-1" }, tenantId: "org-a" });
    const staleRequest = await fetch(`${baseURL}/api/auth/session`, { headers: { ...headers, "X-Orbit-Organization-Context": oldContext } });
    expect(staleRequest.status).toBe(409);
    expect(await staleRequest.json()).toMatchObject({ error: { code: "ORGANIZATION_CONTEXT_CHANGED" } });
    const foreignSubject = browserOrganizationContext({ issuer, user: { subject: "different-user" }, tenantId: "org-b" });
    expect((await fetch(`${baseURL}/api/auth/session`, { headers: { ...headers, "X-Orbit-Organization-Context": foreignSubject } })).status).toBe(409);
    expect(await switched.json()).toEqual({ ok: true, tenantId: "org-b", roles: ["viewer"], permissions: ["workflow.read"] });
    expect(await (await fetch(`${baseURL}/api/auth/session?roles=admin&tenantId=org-a`, { headers })).json())
      .toMatchObject({ tenantId: "org-b", roles: ["viewer"], permissions: ["workflow.read"] });
    // 管理员角色不能越过未完成隔离的能力白名单。
    expect((await fetch(`${baseURL}/api/workflow-runs/run/events`, { headers })).status).toBe(403);
    expect(state.upstreamHits).toBe(0);
  }, 15_000);

  it("无角色会话不给业务权限；新登录读取降权结果，签名注销撤销旧授权会话", async () => {
    const { baseURL, issuer, privateKey, state } = await fixture();
    const withoutRoles = await login(baseURL, issuer);
    expect(await (await fetch(`${baseURL}/api/auth/session`, { headers: { Cookie: withoutRoles.jar.header() } })).json())
      .toMatchObject({ roles: [], permissions: [] });
    state.organizationRoles = { "org-a": ["admin"] };
    const elevated = await login(baseURL, issuer);
    const oldHeaders = { Cookie: elevated.jar.header() };
    state.organizationRoles = { "org-a": ["viewer"] };
    const downgraded = await login(baseURL, issuer);
    expect(await (await fetch(`${baseURL}/api/auth/session`, { headers: { Cookie: downgraded.jar.header() } })).json())
      .toMatchObject({ roles: ["viewer"], permissions: ["workflow.read"] });
    // 声明为固定会话快照；变更 IdP 角色本身不会主动推送到已有会话。
    expect(await (await fetch(`${baseURL}/api/auth/session`, { headers: oldHeaders })).json()).toMatchObject({ roles: ["admin"] });
    const token = await new SignJWT({ sid: "sid-1", events: { "http://schemas.openid.net/event/backchannel-logout": {} } })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(issuer).setAudience("orbit-web")
      .setSubject("user-1").setIssuedAt().sign(privateKey);
    expect((await fetch(`${baseURL}/auth/backchannel-logout`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ logout_token: token }),
    })).status).toBe(204);
    expect((await fetch(`${baseURL}/api/auth/session`, { headers: oldHeaders })).status).toBe(401);
  }, 15_000);

  it("签名正确但角色映射畸形或为非成员组织授权时仍拒绝登录", async () => {
    const { baseURL, issuer, state } = await fixture();
    for (const roles of [null, { "org-x": ["admin"] }, { "org-a": ["root"] }, { "org-a": "admin" }]) {
      state.organizationRoles = roles;
      const { jar, callback } = await login(baseURL, issuer);
      expect(callback.status).toBe(401);
      expect((await fetch(`${baseURL}/api/auth/session`, { headers: { Cookie: jar.header() } })).status).toBe(401);
    }
  }, 15_000);

  it("completes real code+PKCE login, isolates selected tenant, and denies unisolated routes", async () => {
    const { baseURL, issuer, sessionStorePath, state } = await fixture();
    const anonymous = await fetch(`${baseURL}/api/sessions`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("access-control-allow-origin")).toBeNull();
    const { jar, callback } = await login(baseURL, issuer);
    expect(state).toMatchObject({ clientAuthValid: true, pkceValid: true });
    expect(callback.status).toBe(302);
    expect(state.tokenHits).toBe(1);
    const authorized = (path: string, init: RequestInit = {}) => fetch(`${baseURL}${path}`, { ...init, headers: { Cookie: jar.header(), ...init.headers } });
    const session = await authorized("/api/auth/session");
    const db = new Database(sessionStorePath, { readonly: true });
    const rows = db.prepare("SELECT revoked, expires_at, length(payload_json) as size, payload_json FROM oidc_sessions").all() as Array<{ revoked: number; expires_at: number; size: number; payload_json: string }>;
    db.close();
    const sessionMetadata = rows.map((row) => { const payload = JSON.parse(row.payload_json); return { revoked: row.revoked, hasIdToken: !!payload.data?.id_token, hasIdentity: !!payload.data?.orbitIdentity, expValid: row.expires_at > Date.now() }; });
    expect({ cookieNames: jar.names(), sessionMetadata }).toEqual({ cookieNames: ["orbit_session"], sessionMetadata: [{ revoked: 0, hasIdToken: true, hasIdentity: true, expValid: true }] });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ tenantId: "org-a", organizations: [{ id: "org-a" }, { id: "org-b" }] });
    expect(session.headers.get("access-control-allow-origin")).toBeNull();
    const stored = await readFile(sessionStorePath, "utf8");
    expect(stored.toString()).not.toContain("access-secret-not-to-persist");
    expect(stored.toString()).not.toContain("refresh-secret-not-to-persist");
    const write = (path: string, method: string, body: unknown, headers: Record<string, string> = {}) => authorized(path, {
      method, headers: { Origin: baseURL, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
    });
    expect((await write("/api/profile", "PUT", { displayName: "Alpha" })).status).toBe(200);
    expect((await write("/api/auth/tenant", "POST", { tenantId: "org-x" })).status).toBe(403);
    expect((await write("/api/auth/tenant", "POST", { tenantId: "org-b" })).status).toBe(200);
    const switched = await authorized("/api/profile");
    expect(await switched.json()).toMatchObject({ profile: { displayName: "本地用户" } });
    expect((await write("/api/profile", "PUT", { displayName: "Beta" }, { Origin: "https://evil.example" })).status).toBe(403);
    for (const path of ["/api/sessions", "/api/sops", "/api/skills", "/api/workflow-runs/run/events", "/api/events/stream", "/api/audit/events", "/api/profile/", "/api/%70rofile"]) {
      const response = await authorized(path);
      expect(response.status, path).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "SAAS_CAPABILITY_NOT_ISOLATED" } });
    }
    expect(state.upstreamHits).toBe(0);
  }, 15_000);

  it("rejects forged state and enforces logout replay and signed backchannel logout", async () => {
    const { baseURL, issuer, privateKey } = await fixture();
    const start = await fetch(`${baseURL}/auth/login`, { redirect: "manual" });
    const provider = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const forged = new URL(provider.headers.get("location")!);
    forged.searchParams.set("state", "forged-state");
    const transaction = start.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
    expect((await fetch(forged, { headers: { Cookie: transaction }, redirect: "manual" })).status).toBe(401);
    const { jar, callback } = await login(baseURL, issuer);
    expect(callback.status).toBe(302);
    const oldCookie = jar.header();
    const logout = await fetch(`${baseURL}/api/auth/logout`, { method: "POST", headers: { Cookie: oldCookie, Origin: baseURL }, redirect: "manual" });
    expect(logout.status).toBe(200);
    expect((await fetch(`${baseURL}/api/auth/session`, { headers: { Cookie: oldCookie } })).status).toBe(401);
    const second = await login(baseURL, issuer);
    expect(second.callback.status).toBe(302);
    const { privateKey: forgedKey } = await generateKeyPair("RS256");
    const forgedToken = await new SignJWT({ sid: "sid-1", events: { "http://schemas.openid.net/event/backchannel-logout": {} } })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(issuer).setAudience("orbit-web")
      .setSubject("user-1").setIssuedAt().sign(forgedKey);
    const forgedLogout = await fetch(`${baseURL}/auth/backchannel-logout`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ logout_token: forgedToken }),
    });
    expect(forgedLogout.status).toBeGreaterThanOrEqual(400);
    expect((await fetch(`${baseURL}/api/auth/session`, { headers: { Cookie: second.jar.header() } })).status).toBe(200);
    const token = await new SignJWT({ sid: "sid-1", events: { "http://schemas.openid.net/event/backchannel-logout": {} } })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(issuer).setAudience("orbit-web")
      .setSubject("user-1").setIssuedAt().sign(privateKey);
    const revoke = await fetch(`${baseURL}/auth/backchannel-logout`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ logout_token: token }) });
    expect(revoke.status).toBe(204);
    expect((await fetch(`${baseURL}/api/auth/session`, { headers: { Cookie: second.jar.header() } })).status).toBe(401);
  }, 15_000);

  it("refuses invalid issuer, audience, nonce, signature and missing organization", async () => {
    const { baseURL, issuer, state } = await fixture();
    for (const variant of ["issuer", "audience", "nonce", "signature", "organization"]) {
      state.variant = variant;
      const { jar, callback } = await login(baseURL, issuer);
      expect(callback.status, variant).toBe(401);
      expect(jar.names(), variant).not.toContain("orbit_session");
      expect((await fetch(`${baseURL}/api/auth/session`, { headers: { Cookie: jar.header() } })).status, variant).toBe(401);
    }
  }, 15_000);
});
