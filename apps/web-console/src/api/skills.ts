import {
  type SkillSourceType,
  type SkillRegistrySource,
  type SkillStatus,
  type SkillPublisher,
  type SkillRegistryItem,
  type SkillAuditAction,
  type SkillAuditEvent,
  type SkillPackageInput,
  type RemoteRegistrySettings,
  type SkillHubReadiness,
} from "./types";
import {
  type JsonObject,
  asObject,
  asNumber,
  asBoolean,
  cleanText,
  cleanOptionalText,
  cleanStringList,
  cleanNumber,
  requestJson,
} from "./client";

/** 归一化技能可信来源标记。 */
export function normalizeRegistrySource(
  value: unknown,
  sourceType: SkillSourceType,
): SkillRegistrySource {
  if (
    value === "official" ||
    value === "verified" ||
    value === "community" ||
    value === "private" ||
    value === "local"
  ) {
    return value;
  }
  return sourceType === "remote" ? "community" : "local";
}

function normalizePublisher(value: unknown, fallback: string): SkillPublisher {
  const record = asObject(value);
  const id = cleanText(record.id, fallback || "unknown").slice(0, 80);
  return {
    id,
    name: cleanText(record.name, id).slice(0, 120),
    verified: record.verified === true,
  };
}

/** 归一化技能包来源类型。 */
export function normalizeSourceType(value: unknown): SkillSourceType {
  return value === "remote" || value === "custom" || value === "builtin"
    ? value
    : "builtin";
}

/** Normalize a Skill Hub registry item before it is displayed in the Web console. */
export function normalizeSkillRegistryItem(value: unknown): SkillRegistryItem {
  const record = asObject(value);
  const id = cleanText(record.id, "").slice(0, 80);
  const sourceType: SkillSourceType =
    record.sourceType === "remote" ||
    record.sourceType === "custom" ||
    record.sourceType === "builtin"
      ? record.sourceType
      : "builtin";
  const rating = cleanNumber(record.rating, Number.NaN);
  return {
    id,
    name: cleanText(record.name, id || "未命名 Skill").slice(0, 80),
    description: cleanOptionalText(record.description, 1200),
    summary: cleanOptionalText(record.summary, 220) || "暂无简介",
    category: cleanText(record.category, "未分类").slice(0, 40),
    provider: cleanText(record.provider, "Local").slice(0, 80),
    version: cleanText(record.version, "0.0.0").slice(0, 40),
    runtime: cleanText(record.runtime, "Local runtime").slice(0, 80),
    permissions: cleanStringList(record.permissions, 16, 40),
    updatedAt: cleanOptionalText(record.updatedAt, 32),
    maturity: record.maturity === "beta" ? "beta" : "stable",
    tags: cleanStringList(record.tags, 16, 40),
    entry: cleanText(record.entry, "SKILL.md").slice(0, 120),
    sourceType,
    registrySource: normalizeRegistrySource(record.registrySource, sourceType),
    publisher: normalizePublisher(
      record.publisher,
      cleanText(record.provider, "Local"),
    ),
    downloads: Math.max(0, Math.floor(cleanNumber(record.downloads, 0))),
    rating: Number.isFinite(rating) ? Math.min(5, Math.max(0, rating)) : null,
    packageSha256: cleanOptionalText(record.packageSha256, 128),
    deprecated: record.deprecated === true,
    status:
      record.status === "available" ||
      record.status === "downloaded" ||
      record.status === "installed" ||
      record.status === "updateAvailable" ||
      record.status === "invalid"
        ? record.status
        : asBoolean(record.installed)
          ? "installed"
          : "downloaded",
    installed: asBoolean(record.installed),
    installedVersion: cleanOptionalText(record.installedVersion, 40),
    installedAt:
      typeof record.installedAt === "number" &&
      Number.isFinite(record.installedAt)
        ? record.installedAt
        : null,
    availableVersion: cleanOptionalText(record.availableVersion, 40),
    previousInstalledVersion: cleanOptionalText(
      record.previousInstalledVersion,
      40,
    ),
    validationErrors: cleanStringList(record.validationErrors, 12, 180),
    versions:
      Array.isArray(record.versions) && record.versions.length > 0
        ? record.versions
            .map((v) => cleanOptionalText(v, 40))
            .filter(Boolean)
            .slice(0, 16)
        : [cleanText(record.version, "0.0.0")],
  };
}

function normalizeSkillAuditAction(value: unknown): SkillAuditAction {
  return value === "download" ||
    value === "upload" ||
    value === "install" ||
    value === "update" ||
    value === "rollback" ||
    value === "uninstall"
    ? value
    : "install";
}

function normalizeSkillStatus(value: unknown): SkillStatus {
  return value === "available" ||
    value === "downloaded" ||
    value === "installed" ||
    value === "updateAvailable" ||
    value === "invalid"
    ? value
    : "downloaded";
}

/** Normalize a Skill lifecycle audit event before it is displayed in Skill Hub. */
export function normalizeSkillAuditEvent(value: unknown): SkillAuditEvent {
  const record = asObject(value);
  const skillId = cleanText(record.skillId, "").slice(0, 80);
  return {
    id: cleanText(record.id, `${asNumber(record.at) ?? 0}-${skillId}`).slice(
      0,
      140,
    ),
    action: normalizeSkillAuditAction(record.action),
    ok: record.ok !== false,
    code: cleanOptionalText(record.code, 80),
    message: cleanOptionalText(record.message, 240),
    skillId,
    skillName: cleanText(record.skillName, skillId || "未命名 Skill").slice(
      0,
      120,
    ),
    version: cleanOptionalText(record.version, 40),
    status: normalizeSkillStatus(record.status),
    at: asNumber(record.at) ?? 0,
  };
}

/** Normalize remote registry settings before displaying them in Skill Hub. */
export function normalizeRemoteRegistrySettings(
  value: unknown,
): RemoteRegistrySettings {
  const record = asObject(value);
  return {
    url: cleanOptionalText(record.url, 400),
    managedByService: asBoolean(record.managedByService),
    lastSyncedAt: asNumber(record.lastSyncedAt),
    lastSyncError: cleanOptionalText(record.lastSyncError, 400),
    skillCount: Number(record.skillCount ?? 0),
  };
}

export function normalizeSkillHubReadiness(value: unknown): SkillHubReadiness {
  const record = asObject(value);
  const store = asObject(record.store);
  const counts = asObject(record.counts);
  const status =
    record.status === "blocked" ||
    record.status === "degraded" ||
    record.status === "ready"
      ? record.status
      : "blocked";
  return {
    status,
    registry: normalizeRemoteRegistrySettings(record.registry),
    store: {
      readable: asBoolean(store.readable),
      message: cleanOptionalText(store.message, 240),
    },
    counts: {
      total: Math.max(0, Math.floor(cleanNumber(counts.total, 0))),
      installed: Math.max(0, Math.floor(cleanNumber(counts.installed, 0))),
      updateAvailable: Math.max(
        0,
        Math.floor(cleanNumber(counts.updateAvailable, 0)),
      ),
      invalid: Math.max(0, Math.floor(cleanNumber(counts.invalid, 0))),
      failedAudit: Math.max(0, Math.floor(cleanNumber(counts.failedAudit, 0))),
    },
  };
}

/** Fetches local skill registry items through the BFF business API. */
export async function fetchSkills(): Promise<SkillRegistryItem[]> {
  const response = await requestJson<JsonObject>("/api/skills");
  const skills = Array.isArray(response.skills) ? response.skills : [];
  return skills.map(normalizeSkillRegistryItem).filter((skill) => skill.id);
}

/** Fetches recent Skill lifecycle audit events through the BFF business API. */
export async function fetchSkillAuditEvents(): Promise<SkillAuditEvent[]> {
  const response = await requestJson<JsonObject>("/api/skills/audit");
  const events = Array.isArray(response.events) ? response.events : [];
  return events.map(normalizeSkillAuditEvent).filter((event) => event.skillId);
}

/** Fetches the configured remote skill registry connection. */
export async function fetchSkillRegistrySettings(): Promise<RemoteRegistrySettings> {
  const response = await requestJson<JsonObject>("/api/skills/registry");
  return normalizeRemoteRegistrySettings(response.registry);
}

/** Synchronizes the configured remote skill registry index. */
export async function syncSkillRegistry(): Promise<RemoteRegistrySettings> {
  const response = await requestJson<JsonObject>("/api/skills/registry/sync", {
    method: "POST",
  });
  return normalizeRemoteRegistrySettings(response.registry);
}

/** Fetches BFF-computed SkillHub production readiness. */
export async function fetchSkillHubReadiness(): Promise<SkillHubReadiness> {
  const response = await requestJson<JsonObject>("/api/skills/readiness");
  return normalizeSkillHubReadiness(response.readiness);
}

/** Installs one local skill through the BFF business API. */
export async function installSkill(
  skillId: string,
): Promise<SkillRegistryItem> {
  const response = await requestJson<JsonObject>(
    `/api/skills/${encodeURIComponent(skillId)}/install`,
    {
      method: "POST",
    },
  );
  return normalizeSkillRegistryItem(response.skill);
}

/** Updates one installed skill to the newest available version through the BFF business API. */
export async function updateSkill(skillId: string): Promise<SkillRegistryItem> {
  const response = await requestJson<JsonObject>(
    `/api/skills/${encodeURIComponent(skillId)}/update`,
    {
      method: "POST",
    },
  );
  return normalizeSkillRegistryItem(response.skill);
}

/** Rolls one installed skill back to the previous local version through the BFF business API. */
export async function rollbackSkill(
  skillId: string,
): Promise<SkillRegistryItem> {
  const response = await requestJson<JsonObject>(
    `/api/skills/${encodeURIComponent(skillId)}/rollback`,
    {
      method: "POST",
    },
  );
  return normalizeSkillRegistryItem(response.skill);
}

/** Downloads one remote skill through the BFF business API. */
export async function downloadSkill(
  skillId: string,
): Promise<SkillRegistryItem> {
  const response = await requestJson<JsonObject>(
    `/api/skills/${encodeURIComponent(skillId)}/download`,
    {
      method: "POST",
    },
  );
  return normalizeSkillRegistryItem(response.skill);
}

/** Uninstalls one local skill through the BFF business API. */
export async function uninstallSkill(
  skillId: string,
): Promise<SkillRegistryItem> {
  const response = await requestJson<JsonObject>(
    `/api/skills/${encodeURIComponent(skillId)}/uninstall`,
    {
      method: "POST",
    },
  );
  return normalizeSkillRegistryItem(response.skill);
}

/** Uploads a custom skill package through the BFF business API. */
export async function uploadSkillPackage(
  input: SkillPackageInput,
): Promise<SkillRegistryItem> {
  const response = await requestJson<JsonObject>("/api/skills/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return normalizeSkillRegistryItem(response.skill);
}
