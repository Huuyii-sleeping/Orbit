import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentProfileRepository } from "../../../src/agents/agent-profile.repository.js";
import { runWithTenant } from "../../../src/identity/tenant-context.js";
import { LocalStoreService } from "../../../src/storage/local-store.service.js";
import { SopDatabase } from "../../../src/storage/sop-database.js";
import type { AgentProfile } from "../../../src/agents/agent-profile.service.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("AgentProfileRepository", () => {
  it("同组织用户共享 profile，不同组织和旧本地配置互不可见", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-agent-profile-tenants-"));
    roots.push(root);
    const local = new LocalStoreService({ filePath: join(root, "business.json") });
    const legacy = { id: "same-profile", revision: 0, name: "旧本地 Agent", createdAt: 1, updatedAt: 1 } as AgentProfile;
    await local.writeSection("agents", [legacy]);
    const database = new SopDatabase({ sopDataRoot: root, requireTenantContext: true });
    const repository = new AgentProfileRepository(local, database);
    const alpha = { issuer: "issuer", tenantId: "org-a", subject: "user-a" };
    const colleague = { ...alpha, subject: "user-b" };
    const beta = { ...alpha, tenantId: "org-b" };
    try {
      await expect(repository.list()).rejects.toThrow(/tenant context/i);
      const own = { ...legacy, name: "组织 A Agent" };
      await runWithTenant(alpha, () => repository.update(() => [own]));
      expect(await runWithTenant(colleague, () => repository.list())).toEqual([own]);
      expect(await runWithTenant(beta, () => repository.list())).toEqual([]);
      await runWithTenant(beta, () => repository.update(() => [{ ...own, name: "组织 B Agent" }]));
      expect(await runWithTenant(alpha, () => repository.list())).toEqual([own]);
      expect(await local.readSection("agents", [])).toEqual([legacy]);
    } finally { database.onModuleDestroy(); local.onModuleDestroy(); }
  });
});
