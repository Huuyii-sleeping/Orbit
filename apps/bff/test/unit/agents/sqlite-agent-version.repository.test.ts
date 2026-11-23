import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentVersion } from "@orbit/workflow-core";
import { SopDatabase } from "../../../src/storage/sop-database.js";
import { SqliteAgentVersionRepository } from "../../../src/agents/sqlite-agent-version.repository.js";
import { runWithTenant } from "../../../src/identity/tenant-context.js";

const roots: string[] = [];

function snapshot(agentProfileId: string, name: string): Omit<AgentVersion, "id" | "version"> {
  return {
    agentProfileId,
    contentHash: `${agentProfileId}-${name}-hash`,
    name,
    description: `${name} description`,
    instructions: [`${name} instructions`],
    toolPolicy: { allowedToolIds: [] },
    skillPolicy: { bindings: [] },
    outputSchema: { type: "object" },
    createdBy: "tester",
    releaseNotes: "",
    createdAt: Date.now(),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SqliteAgentVersionRepository", () => {
  it("追加不可变版本并通过 profile/version 双 identity 解析", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-agent-version-repository-"));
    roots.push(root);
    const database = new SopDatabase({ sopDataRoot: root });
    try {
      const repository = new SqliteAgentVersionRepository(database);
      const first = repository.publish(snapshot("profile-1", "Agent v1"));
      const second = repository.publish(snapshot("profile-1", "Agent v2"));
      const other = repository.publish(snapshot("profile-2", "Other Agent"));

      expect([first.version, second.version, other.version]).toEqual([1, 2, 1]);
      expect(repository.list("profile-1").map((item) => item.id)).toEqual([second.id, first.id]);
      expect(repository.resolvePublishedVersion("profile-1", first.id)).toEqual(first);
      expect(repository.resolvePublishedVersion("profile-2", first.id)).toBeUndefined();
      expect(repository.getById(other.id)).toEqual(other);

      expect(() => database.database.prepare("update agent_versions set name = ? where id = ?").run("mutated", first.id)).toThrow(/immutable/i);
      expect(() => database.database.prepare("delete from agent_versions where id = ?").run(first.id)).toThrow(/immutable/i);
      expect(repository.getById(first.id)).toEqual(first);
    } finally {
      database.onModuleDestroy();
    }
  });

  it("相同 profile ID 在不同租户分别从版本 1 发布，旧本地版本和其他租户版本不可见", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-agent-version-tenants-"));
    roots.push(root);
    const localDatabase = new SopDatabase({ sopDataRoot: root });
    const localVersion = new SqliteAgentVersionRepository(localDatabase).publish(snapshot("shared-profile", "旧本地"));
    localDatabase.onModuleDestroy();
    const database = new SopDatabase({ sopDataRoot: root, requireTenantContext: true });
    const repository = new SqliteAgentVersionRepository(database);
    const alpha = { issuer: "issuer", tenantId: "org-a", subject: "u1" };
    const beta = { issuer: "issuer", tenantId: "org-b", subject: "u1" };
    try {
      expect(() => repository.list()).toThrow(/tenant context/i);
      const alphaVersion = runWithTenant(alpha, () => {
        expect(repository.getById(localVersion.id)).toBeUndefined();
        return repository.publish(snapshot("shared-profile", "组织 A"));
      });
      runWithTenant(beta, () => {
        expect(repository.getById(alphaVersion.id)).toBeUndefined();
        expect(repository.resolvePublishedVersion("shared-profile", alphaVersion.id)).toBeUndefined();
        const own = repository.publish(snapshot("shared-profile", "组织 B"));
        expect(own.version).toBe(1);
        expect(repository.list("shared-profile")).toEqual([own]);
      });
      runWithTenant(alpha, () => expect(repository.list()).toEqual([alphaVersion]));
    } finally { database.onModuleDestroy(); }
  });
});
