import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT, generateKeyPair } from "jose";
import { SqliteSessionStore } from "../../../src/identity/sqlite-session-store.js";

const roots: string[] = [];
const stores: SqliteSessionStore[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "orbit-auth-store-")); roots.push(root);
  const path = join(root, "sessions.sqlite");
  const store = new SqliteSessionStore(path); stores.push(store);
  return { path, store };
}

async function payload(subject: string, sid: string, tenantId = "org-a", roles: string[] = []) {
  const { privateKey } = await generateKeyPair("RS256");
  const id_token = await new SignJWT({ sid, organization: { [tenantId]: { id: tenantId } } })
    .setProtectedHeader({ alg: "RS256" }).setIssuer("issuer").setSubject(subject)
    .setAudience("orbit").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  return {
    header: { iat: Math.floor(Date.now() / 1000), uat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 },
    data: { id_token, orbitIdentity: { issuer: "issuer", subject, organizations: [{ id: tenantId, alias: tenantId, roles }], selectedTenantId: tenantId } },
    cookie: { expires: Date.now() + 300_000, maxAge: 300_000 },
  };
}

function get(store: SqliteSessionStore, id: string) {
  return new Promise<unknown>((resolve, reject) => store.get(id, (error, value) => error ? reject(error) : resolve(value)));
}
function set(store: SqliteSessionStore, id: string, value: Awaited<ReturnType<typeof payload>>) {
  return new Promise<void>((resolve, reject) => store.set(id, value, (error) => error ? reject(error) : resolve()));
}
function destroy(store: SqliteSessionStore, id: string) {
  return new Promise<void>((resolve, reject) => store.destroy(id, (error) => error ? reject(error) : resolve()));
}

describe("SQLite OIDC session adapter", () => {
  it("固定会话到期后旧角色不能因迟到写回而继续有效", async () => {
    const { store } = await setup();
    const value = await payload("user1", "sid1", "org-a", ["admin"]);
    await set(store, "privileged", value);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301_000);
    try {
      expect(await get(store, "privileged")).toBeNull();
      await set(store, "privileged", value);
      expect(await get(store, "privileged")).toBeNull();
    } finally { clock.mockRestore(); }
  });

  it("keeps a logout tombstone so delayed requests cannot resurrect a cookie", async () => {
    const { path, store } = await setup();
    const value = await payload("user1", "sid1");
    await set(store, "session1", value);
    expect(await get(store, "session1")).toMatchObject({ data: { orbitIdentity: { subject: "user1" } } });
    await destroy(store, "session1");
    await set(store, "session1", value);
    expect(await get(store, "session1")).toBeNull();
    const restarted = new SqliteSessionStore(path); stores.push(restarted);
    expect(await get(restarted, "session1")).toBeNull();
  });

  it("revokes only matching issuer and sid, or all matching subject sessions", async () => {
    const { store } = await setup();
    await set(store, "a", await payload("user1", "sid1"));
    await set(store, "b", await payload("user1", "sid2"));
    await set(store, "c", await payload("user2", "sid3"));
    store.revoke("issuer", "sid1", undefined);
    expect(await get(store, "a")).toBeNull();
    expect(await get(store, "b")).toBeTruthy();
    await set(store, "late", await payload("user1", "sid1"));
    expect(await get(store, "late")).toBeNull();
    store.revoke("issuer", undefined, "user1");
    expect(await get(store, "b")).toBeNull();
    expect(await get(store, "c")).toBeTruthy();
  });

  it("preserves the latest tenant selection when an old request finishes later", async () => {
    const { store } = await setup();
    const older = await payload("user1", "sid1");
    await set(store, "s", older);
    const newer = { ...older, data: { ...older.data, orbitIdentity: { ...older.data.orbitIdentity, selectedTenantId: "org-b", selectedAt: 20 } } };
    await set(store, "s", newer);
    await set(store, "s", older);
    expect(await get(store, "s")).toMatchObject({ data: { orbitIdentity: { selectedTenantId: "org-b" } } });
  });
});
