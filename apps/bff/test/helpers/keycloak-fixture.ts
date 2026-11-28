import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { cookieJar } from "./workflow-http-fixture.js";

/** 只接收本轮 Docker runner 生成的 loopback 配置，创建专用 realm，不操作现有组织。 */
export async function createKeycloakFixture(configPath: string, bffURL: string) {
  const config = JSON.parse(await readFile(configPath, "utf8")) as { baseURL: string; admin: string; password: string; keyPath: string; certPath: string };
  if (new URL(config.baseURL).hostname !== "127.0.0.1") throw new Error("Keycloak fixture requires loopback");
  const realm = `orbit-m1-${randomUUID()}`;
  const clientID = "orbit-web";
  const clientSecret = randomUUID();
  const password = randomUUID();
  let token = "";
  let tokenExpiresAt = 0;
  const authenticateAdmin = async () => {
    const tokenResponse = await fetch(`${config.baseURL}/realms/master/protocol/openid-connect/token`, {
      method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: config.admin, password: config.password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new Error(`Keycloak test admin authentication failed: ${tokenResponse.status}`);
    const body = await tokenResponse.json() as { access_token: string; expires_in: number };
    token = body.access_token; tokenExpiresAt = Date.now() + body.expires_in * 1_000;
  };
  await authenticateAdmin();
  const api = async (path: string, method = "GET", body?: unknown) => {
    // 长于一分钟的验收也须删除 realm；只续期隔离测试的管理员身份。
    if (Date.now() >= tokenExpiresAt - 5_000) await authenticateAdmin();
    const response = await fetch(`${config.baseURL}/admin${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Keycloak fixture admin ${method} failed: ${response.status} ${path}`);
    return response;
  };
  await api("/realms", "POST", { realm, enabled: true, organizationsEnabled: true, sslRequired: "all", registrationAllowed: false });
  const prefix = `/realms/${realm}`;
  const close = async () => { await api(prefix, "DELETE"); };
  try {
    const orgs: Record<string, string> = {};
    for (const alias of ["alpha", "beta"]) {
      const response = await api(`${prefix}/organizations`, "POST", { name: alias, alias, enabled: true });
      orgs[alias] = response.headers.get("location")!.split("/").at(-1)!;
    }
    const scopes = await (await api(`${prefix}/client-scopes`)).json() as Array<{ id: string; name: string }>;
    const organization = scopes.find((scope) => scope.name === "organization")!;
    const mappers = await (await api(`${prefix}/client-scopes/${organization.id}/protocol-mappers/models`)).json() as Array<{ id: string; config: Record<string, string> }>;
    for (const mapper of mappers) await api(`${prefix}/client-scopes/${organization.id}/protocol-mappers/models/${mapper.id}`, "PUT", {
      ...mapper, config: { ...mapper.config, addOrganizationId: "true" },
    });

    // 角色声明来源必须仅管理员可写；用户自助资料页不能修改它。
    const profile = await (await api(`${prefix}/users/profile`)).json() as { attributes: unknown[] };
    await api(`${prefix}/users/profile`, "PUT", { ...profile, attributes: [...profile.attributes, {
      name: "orbit_org_roles", displayName: "Orbit organization roles", permissions: { view: ["admin"], edit: ["admin"] },
    }] });
    const client = await api(`${prefix}/clients`, "POST", { clientId: clientID, secret: clientSecret, protocol: "openid-connect", publicClient: false,
      standardFlowEnabled: true, directAccessGrantsEnabled: false, redirectUris: [`${bffURL}/auth/callback`],
      attributes: { "pkce.code.challenge.method": "S256", "backchannel.logout.url": `${bffURL.replace("127.0.0.1", "host.docker.internal")}/auth/backchannel-logout`, "backchannel.logout.session.required": "true" },
    });
    const clientId = client.headers.get("location")!.split("/").at(-1)!;
    await api(`${prefix}/clients/${clientId}/optional-client-scopes/${organization.id}`, "PUT");
    await api(`${prefix}/clients/${clientId}/protocol-mappers/models`, "POST", {
      name: "orbit organization roles", protocol: "openid-connect", protocolMapper: "oidc-usermodel-attribute-mapper",
      config: { "user.attribute": "orbit_org_roles", "claim.name": "orbit_org_roles", "jsonType.label": "JSON", "id.token.claim": "true", "access.token.claim": "false", multivalued: "false" },
    });
    const users: Record<string, string> = {};
    for (const [username, org, roles] of [["alice", "alpha", ["editor", "approver"]], ["bob", "alpha", ["publisher", "approver"]], ["mallory", "beta", ["admin"]]] as const) {
      const response = await api(`${prefix}/users`, "POST", { username, enabled: true, email: `${username}@example.test`, emailVerified: true,
        firstName: username, lastName: "Test", credentials: [{ type: "password", value: password, temporary: false }],
        attributes: { orbit_org_roles: [JSON.stringify({ [orgs[org]!]: roles })] },
      });
      const id = response.headers.get("location")!.split("/").at(-1)!;
      users[username] = id;
      await api(`${prefix}/organizations/${orgs[org]}/members`, "POST", id);
    }
    const login = async (baseURL: string, username: string) => {
      const appCookies = cookieJar(); const providerCookies = cookieJar();
      const start = await fetch(`${baseURL}/auth/login`, { redirect: "manual" }); appCookies.receive(start);
      let authorized = await fetch(start.headers.get("location")!, { redirect: "manual" });
      // Organizations 的真实浏览器流程先识别用户，再进入密码页；最多处理三个预期表单。
      for (let step = 0; step < 3 && authorized.status === 200; step++) {
        providerCookies.receive(authorized);
        const html = await authorized.text();
        const action = /<form\b[^>]*\baction="([^"]+)"/.exec(html)?.[1]?.replaceAll("&amp;", "&");
        if (!action || new URL(action).origin !== config.baseURL) throw new Error("Keycloak login form missing or outside fixture origin");
        authorized = await fetch(action, { method: "POST", redirect: "manual", headers: { Cookie: providerCookies.header() }, body: new URLSearchParams({ username, password, credentialId: "" }) });
      }
      const callbackURL = authorized.headers.get("location");
      if (authorized.status !== 302 || !callbackURL || new URL(callbackURL).origin !== baseURL) throw new Error(`Keycloak authorization failed: ${authorized.status}`);
      const callback = await fetch(callbackURL, { redirect: "manual", headers: { Cookie: appCookies.header() } }); appCookies.receive(callback);
      if (callback.status !== 302) throw new Error(`BFF Keycloak callback failed: ${callback.status}`);
      if (!callback.headers.getSetCookie().some((cookie) => cookie.startsWith("orbit_session=") && /;\s*Secure/i.test(cookie))) throw new Error("HTTPS session cookie must be Secure");
      return appCookies;
    };
    return { issuer: `${config.baseURL}/realms/${realm}`, clientID, clientSecret, orgs, login, close,
      browserCredentials: (username: string) => ({ username, password }),
      createOrganizationUser: async (alias: string, username: string) => {
        const organization = await api(`${prefix}/organizations`, "POST", { name: alias, alias, enabled: true });
        const tenantId = organization.headers.get("location")!.split("/").at(-1)!;
        orgs[alias] = tenantId;
        const response = await api(`${prefix}/users`, "POST", { username, enabled: true, email: `${username}@example.test`, emailVerified: true,
          firstName: username, lastName: "Load", credentials: [{ type: "password", value: password, temporary: false }],
          attributes: { orbit_org_roles: [JSON.stringify({ [tenantId]: ["admin"] })] },
        });
        const userId = response.headers.get("location")!.split("/").at(-1)!;
        users[username] = userId;
        await api(`${prefix}/organizations/${tenantId}/members`, "POST", userId);
        return tenantId;
      },
      addMembership: async (username: string, alias: string, roles: string[]) => {
        await api(`${prefix}/organizations/${orgs[alias]}/members`, "POST", users[username]);
        const user = await (await api(`${prefix}/users/${users[username]}`)).json() as { attributes: Record<string, string[]> };
        const existing = JSON.parse(user.attributes.orbit_org_roles[0]);
        await api(`${prefix}/users/${users[username]}`, "PUT", { ...user, attributes: { ...user.attributes,
          orbit_org_roles: [JSON.stringify({ ...existing, [orgs[alias]]: roles })],
        } });
      },
      setRoles: async (username: string, roles: string[]) => {
        const user = await (await api(`${prefix}/users/${users[username]}`)).json() as { attributes: Record<string, string[]> };
        await api(`${prefix}/users/${users[username]}`, "PUT", { ...user, attributes: { ...user.attributes,
          orbit_org_roles: [JSON.stringify({ [orgs[username === "mallory" ? "beta" : "alpha"]!]: roles })],
        } });
      },
      removeMembership: async (username: string) => { await api(`${prefix}/organizations/${orgs[username === "mallory" ? "beta" : "alpha"]}/members/${users[username]}`, "DELETE"); },
      logout: async (username: string) => { await api(`${prefix}/users/${users[username]}/logout`, "POST"); } };
  } catch (error) { await close(); throw error; }
}
