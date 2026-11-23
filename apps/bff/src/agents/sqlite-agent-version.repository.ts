import { Inject, Injectable } from "@nestjs/common";
import type { AgentVersion } from "@orbit/workflow-core";
import { randomUUID } from "node:crypto";
import { SopDatabase } from "../storage/sop-database.js";
import { SopStorageError } from "../sops/sops.errors.js";
import type { AgentVersionRepository, PublishAgentVersionRecord } from "./agent-version.repository.js";

type AgentVersionRow = { snapshot_json: string };

function parseVersion(raw: string): AgentVersion {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("snapshot must be an object");
    return value as AgentVersion;
  } catch (error) {
    throw new SopStorageError("AgentVersion 快照 JSON 已损坏。", { cause: String(error) });
  }
}

/** 使用产品 SQLite 持久化不可变 AgentVersion。 */
@Injectable()
export class SqliteAgentVersionRepository implements AgentVersionRepository {
  constructor(@Inject(SopDatabase) private readonly storage: SopDatabase) {}

  publish(input: PublishAgentVersionRecord): AgentVersion {
    return this.storage.database.transaction(() => {
      const { issuer, tenantId } = this.storage.tenantScope();
      const next = this.storage.database.prepare(`
        select coalesce(max(version), 0) + 1 as version
        from agent_versions
        where agent_profile_id = ? and issuer is ? and tenant_id is ?
      `).get(input.agentProfileId, issuer, tenantId) as { version: number };
      const version: AgentVersion = { ...input, id: randomUUID(), version: next.version };
      this.storage.database.prepare(`
        insert into agent_versions(
          id, agent_profile_id, version, content_hash, name, description,
          snapshot_json, created_by, release_notes, created_at, issuer, tenant_id
        ) values (
          @id, @agentProfileId, @version, @contentHash, @name, @description,
          @snapshotJson, @createdBy, @releaseNotes, @createdAt, @issuer, @tenantId
        )
      `).run({
        issuer, tenantId,
        id: version.id,
        agentProfileId: version.agentProfileId,
        version: version.version,
        contentHash: version.contentHash,
        name: version.name,
        description: version.description,
        snapshotJson: JSON.stringify(version),
        createdBy: version.createdBy,
        releaseNotes: version.releaseNotes,
        createdAt: version.createdAt,
      });
      return version;
    })();
  }

  list(agentProfileId?: string): AgentVersion[] {
    const { issuer, tenantId } = this.storage.tenantScope();
    const rows = agentProfileId
      ? this.storage.database.prepare(`
          select snapshot_json from agent_versions
          where agent_profile_id = ? and issuer is ? and tenant_id is ?
          order by version desc
        `).all(agentProfileId, issuer, tenantId) as AgentVersionRow[]
      : this.storage.database.prepare(`
          select snapshot_json from agent_versions
          where issuer is ? and tenant_id is ?
          order by created_at desc, agent_profile_id, version desc
        `).all(issuer, tenantId) as AgentVersionRow[];
    return rows.map((row) => parseVersion(row.snapshot_json));
  }

  getById(agentVersionId: string): AgentVersion | undefined {
    const { issuer, tenantId } = this.storage.tenantScope();
    const row = this.storage.database.prepare("select snapshot_json from agent_versions where id = ? and issuer is ? and tenant_id is ?")
      .get(agentVersionId, issuer, tenantId) as AgentVersionRow | undefined;
    return row ? parseVersion(row.snapshot_json) : undefined;
  }

  resolvePublishedVersion(agentProfileId: string, agentVersionId: string): AgentVersion | undefined {
    const { issuer, tenantId } = this.storage.tenantScope();
    const row = this.storage.database.prepare(`
      select snapshot_json from agent_versions
      where id = ? and agent_profile_id = ? and issuer is ? and tenant_id is ?
    `).get(agentVersionId, agentProfileId, issuer, tenantId) as AgentVersionRow | undefined;
    return row ? parseVersion(row.snapshot_json) : undefined;
  }
}
