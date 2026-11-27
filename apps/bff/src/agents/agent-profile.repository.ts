import { Inject, Injectable } from "@nestjs/common";
import { LocalStoreService } from "../storage/local-store.service.js";
import { SopDatabase } from "../storage/sop-database.js";
import type { AgentProfile } from "./agent-profile.service.js";

const LOCAL_STORE_KEY = "agents";

/** 本地模式沿用旧配置；SaaS profile 在产品库按组织归属。 */
@Injectable()
export class AgentProfileRepository {
  constructor(
    @Inject(LocalStoreService) private readonly local: LocalStoreService,
    @Inject(SopDatabase) private readonly storage: SopDatabase,
  ) {}

  /** 读取当前组织的 profile；不同成员共享同一组织列表。 */
  async list(): Promise<AgentProfile[]> {
    const { issuer, tenantId } = this.storage.tenantScope();
    if (!issuer) return this.local.readSection(LOCAL_STORE_KEY, []);
    return this.rows(issuer, tenantId);
  }

  /** 在同一事务内执行配置变更，保留调用方的 revision 冲突检查。 */
  async update(change: (profiles: AgentProfile[]) => AgentProfile[]): Promise<AgentProfile[]> {
    const { issuer, tenantId } = this.storage.tenantScope();
    if (!issuer) return this.local.updateSection(LOCAL_STORE_KEY, [], change);
    return this.storage.database.transaction(() => {
      const current = this.rows(issuer, tenantId);
      const next = change(current);
      const ids = new Set(next.map((profile) => profile.id));
      if (ids.size !== next.length) throw new Error("duplicate AgentProfile id");
      const remove = this.storage.database.prepare("delete from agent_profiles where issuer = ? and tenant_id = ? and id = ?");
      for (const profile of current) if (!ids.has(profile.id)) remove.run(issuer, tenantId, profile.id);
      const save = this.storage.database.prepare(`
        insert into agent_profiles(issuer, tenant_id, id, revision, profile_json, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(issuer, tenant_id, id) do update set
          revision = excluded.revision, profile_json = excluded.profile_json, updated_at = excluded.updated_at
      `);
      for (const profile of next) {
        save.run(issuer, tenantId, profile.id, profile.revision, JSON.stringify(profile), profile.createdAt, profile.updatedAt);
      }
      return next;
    }).immediate();
  }

  private rows(issuer: string, tenantId: string): AgentProfile[] {
    const rows = this.storage.database.prepare("select profile_json from agent_profiles where issuer = ? and tenant_id = ?")
      .all(issuer, tenantId) as Array<{ profile_json: string }>;
    return rows.map(({ profile_json }) => JSON.parse(profile_json) as AgentProfile);
  }
}
