import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStoreService } from "../../../src/storage/local-store.service.js";
import { runWithTenant } from "../../../src/identity/tenant-context.js";

const roots: string[] = [];
const stores: LocalStoreService[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.onModuleDestroy());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("shared database tenant configuration", () => {
  it("isolates concurrent organizations, issuers and users in one database, retaining unassigned legacy data", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-tenant-store-")); roots.push(root);
    const filePath = join(root, "business.json");
    await writeFile(filePath, JSON.stringify({ profile: { displayName: "legacy-secret" } }));
    const store = new LocalStoreService({ filePath, requireTenantContext: true }); stores.push(store);
    const identities = [
      { issuer: "issuer", tenantId: "org-a", subject: "u1" }, { issuer: "issuer", tenantId: "org-b", subject: "u1" },
      { issuer: "issuer", tenantId: "org-a", subject: "u2" }, { issuer: "other", tenantId: "org-a", subject: "u1" },
    ];
    await expect(store.readSection("profile", null)).rejects.toThrow(/tenant context/i);
    await Promise.all(identities.map((identity, index) => runWithTenant(identity, async () => {
      expect(await store.readSection("profile", null)).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, index));
      await store.writeSection("profile", { displayName: String(index) });
    })));
    const other = new LocalStoreService({ filePath, requireTenantContext: true }); stores.push(other);
    for (const [index, identity] of identities.entries()) {
      expect(await runWithTenant(identity, () => other.readSection("profile", null))).toEqual({ displayName: String(index) });
    }
    const local = new LocalStoreService({ filePath }); stores.push(local);
    expect(await local.readSection("profile", null)).toEqual({ displayName: "legacy-secret" });
  });
});
