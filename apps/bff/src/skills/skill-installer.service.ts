import { compare, valid } from "semver";
import { Inject, Injectable } from "@nestjs/common";
import { LocalStoreService } from "../storage/local-store.service.js";
import type {
  RemoteSkillRegistry,
  SkillAuditAction,
  SkillAuditEvent,
  SkillInstallationRecord,
  SkillPackageInput,
  SkillRegistryItem,
  SkillRegistrySource,
  SkillStoreState,
  SkillSourceType,
  ValidatedSkillPackage,
} from "./skill-types.js";
import { SkillStoreService } from "./skill-store.service.js";
import { SkillValidatorService } from "./skill-validator.service.js";

const skillStoreKey = "skills";
const defaultInstalledSkillIds = ["code-workspace", "memory-context"];
const maxAuditEvents = 50;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

function normalizeSourceType(value: unknown): SkillSourceType {
  return value === "remote" || value === "custom" || value === "builtin" ? value : "builtin";
}

function normalizeRegistrySource(value: unknown): SkillRegistrySource {
  return value === "official" || value === "verified" || value === "community" || value === "private" || value === "local" ? value : "local";
}

function installationRecordFromSkill(skill: SkillRegistryItem, installedAt = Date.now()): SkillInstallationRecord {
  return {
    skillId: skill.id,
    version: skill.version,
    sourceType: skill.sourceType,
    registrySource: skill.registrySource,
    installedAt,
  };
}

function legacyInstallationRecord(skillId: string): SkillInstallationRecord {
  return {
    skillId,
    version: "",
    sourceType: "builtin",
    registrySource: "local",
    installedAt: 0,
  };
}

function normalizeInstallationRecords(value: unknown): SkillInstallationRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const records = value
    .map((item) => {
      const record = asObject(item);
      const skillId = typeof record.skillId === "string" && record.skillId.trim() ? record.skillId.trim() : "";
      if (!skillId) {
        return null;
      }
      return {
        skillId,
        version: typeof record.version === "string" ? record.version.trim() : "",
        sourceType: normalizeSourceType(record.sourceType),
        registrySource: normalizeRegistrySource(record.registrySource),
        installedAt: typeof record.installedAt === "number" && Number.isFinite(record.installedAt) ? record.installedAt : 0,
      };
    })
    .filter((item): item is SkillInstallationRecord => Boolean(item));
  const byId = new Map<string, SkillInstallationRecord>();
  for (const record of records) {
    byId.set(record.skillId, record);
  }
  return [...byId.values()];
}

function normalizeAuditEvents(value: unknown): SkillAuditEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const record = asObject(item);
      const skillId = typeof record.skillId === "string" && record.skillId.trim() ? record.skillId.trim() : "";
      const action = record.action;
      if (
        !skillId ||
        (action !== "download" &&
          action !== "upload" &&
          action !== "install" &&
          action !== "update" &&
          action !== "rollback" &&
          action !== "uninstall")
      ) {
        return null;
      }
      const status = record.status;
      return {
        id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `${record.at ?? 0}-${action}-${skillId}`,
        action,
        ok: record.ok !== false,
        code: typeof record.code === "string" ? record.code.trim().slice(0, 80) : "",
        message: typeof record.message === "string" ? record.message.trim().slice(0, 240) : "",
        skillId,
        skillName: typeof record.skillName === "string" && record.skillName.trim() ? record.skillName.trim().slice(0, 120) : skillId,
        version: typeof record.version === "string" ? record.version.trim().slice(0, 40) : "",
        status:
          status === "available" ||
          status === "downloaded" ||
          status === "installed" ||
          status === "updateAvailable" ||
          status === "invalid"
            ? status
            : "downloaded",
        at: typeof record.at === "number" && Number.isFinite(record.at) ? record.at : 0,
      };
    })
    .filter((item): item is SkillAuditEvent => Boolean(item))
    .sort((left, right) => right.at - left.at)
    .slice(0, maxAuditEvents);
}

function replaceRecord(records: SkillInstallationRecord[], next: SkillInstallationRecord): SkillInstallationRecord[] {
  return [...records.filter((record) => record.skillId !== next.skillId), next];
}

export function defaultSkillStoreState(): SkillStoreState {
  const installedSkills = defaultInstalledSkillIds.map(legacyInstallationRecord);
  return {
    installedSkillIds: defaultInstalledSkillIds,
    installedSkills,
    previousInstalledSkills: [],
    auditEvents: [],
    downloadedSkillIds: [],
    customSkillIds: [],
  };
}

export function normalizeSkillStoreState(value: unknown): SkillStoreState {
  const record = asObject(value);
  const legacyIds = normalizeIds(record.installedSkillIds);
  const installedSkills = normalizeInstallationRecords(record.installedSkills);
  const normalizedInstalledSkills = installedSkills.length
    ? installedSkills
    : (legacyIds.length ? legacyIds : defaultInstalledSkillIds).map(legacyInstallationRecord);
  return {
    installedSkillIds: normalizedInstalledSkills.map((item) => item.skillId),
    installedSkills: normalizedInstalledSkills,
    previousInstalledSkills: normalizeInstallationRecords(record.previousInstalledSkills),
    auditEvents: normalizeAuditEvents(record.auditEvents),
    downloadedSkillIds: normalizeIds(record.downloadedSkillIds),
    customSkillIds: normalizeIds(record.customSkillIds),
  };
}

/** Handles lifecycle transitions for downloaded, installed, and custom skill packages. */
@Injectable()
export class SkillInstallerService {
  constructor(
    @Inject(LocalStoreService) private readonly localStore: LocalStoreService,
    @Inject(SkillStoreService) private readonly skillStore: SkillStoreService,
    @Inject(SkillValidatorService) private readonly validator: SkillValidatorService,
  ) {}

  /** Reads persisted Skill Hub lifecycle state. */
  async readState(): Promise<SkillStoreState> {
    return normalizeSkillStoreState(await this.localStore.readSection(skillStoreKey, defaultSkillStoreState()));
  }

  private async updateState(update: (state: SkillStoreState) => SkillStoreState): Promise<SkillStoreState> {
    return this.localStore.updateSection(skillStoreKey, defaultSkillStoreState(), (current) => {
      const state = update(normalizeSkillStoreState(current));
      const installedSkills = normalizeInstallationRecords(state.installedSkills);
      return {
        installedSkillIds: [...new Set(installedSkills.map((record) => record.skillId))],
        installedSkills,
        previousInstalledSkills: normalizeInstallationRecords(state.previousInstalledSkills),
        auditEvents: normalizeAuditEvents(state.auditEvents),
        downloadedSkillIds: [...new Set(state.downloadedSkillIds)],
        customSkillIds: [...new Set(state.customSkillIds)],
      };
    });
  }

  /** Lists recent Skill lifecycle audit events. */
  async listAuditEvents(): Promise<SkillAuditEvent[]> {
    return (await this.readState()).auditEvents;
  }

  /** Appends a successful Skill lifecycle audit event. */
  async appendAuditEvent(action: SkillAuditAction, skill: SkillRegistryItem): Promise<SkillAuditEvent> {
    const at = Date.now();
    const event: SkillAuditEvent = {
      id: `${at}-${action}-${skill.id}`,
      action,
      ok: true,
      code: "",
      message: "",
      skillId: skill.id,
      skillName: skill.name,
      version: skill.installedVersion || skill.version,
      status: skill.status,
      at,
    };
    await this.updateState((state) => ({
      ...state,
      auditEvents: [event, ...state.auditEvents].slice(0, maxAuditEvents),
    }));
    return event;
  }

  /** Appends a failed Skill lifecycle audit event. */
  async appendAuditFailure(action: SkillAuditAction, skillId: string, code: string, message: string): Promise<SkillAuditEvent> {
    const at = Date.now();
    const event: SkillAuditEvent = {
      id: `${at}-${action}-${skillId}-failed`,
      action,
      ok: false,
      code: code.slice(0, 80),
      message: message.slice(0, 240),
      skillId,
      skillName: skillId,
      version: "",
      status: "invalid",
      at,
    };
    await this.updateState((state) => ({
      ...state,
      auditEvents: [event, ...state.auditEvents].slice(0, maxAuditEvents),
    }));
    return event;
  }

  /** Downloads a remote skill package into the local remote store. */
  async downloadSkill(
    skillId: string,
    registry?: RemoteSkillRegistry,
    remoteRegistryUrl?: string,
    version?: string,
  ): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    const targetRegistry = registry ?? (await this.skillStore.readRemoteRegistry(remoteRegistryUrl));
    const entry = targetRegistry.skills
      .filter((item) => item.id === skillId && (!version || item.version === version))
      .sort((left, right) => compareVersion(right.version, left.version))[0];
    if (!entry) {
      return { ok: false, code: "SKILL_NOT_FOUND", message: `skill ${skillId} was not found` };
    }
    const remotePackage = await this.skillStore.readRemotePackage(entry, remoteRegistryUrl);
    const validated = this.validator.validatePackage(remotePackage);
    if (!validated.ok) {
      return { ok: false, code: "SKILL_PACKAGE_INVALID", message: validated.errors.join("; ") };
    }
    await this.skillStore.writePackage("remote", validated.package);
    await this.updateState((state) => ({
      ...state,
      downloadedSkillIds: [...new Set([...state.downloadedSkillIds, validated.package.manifest.id])],
    }));
    return { ok: true };
  }

  /** Stores a validated custom skill package. */
  async uploadCustomSkill(input: SkillPackageInput): Promise<
    | { ok: true; skillPackage: ValidatedSkillPackage }
    | { ok: true; skillPackage: ValidatedSkillPackage; publishedToRegistry: true }
    | { ok: false; code: string; message: string; errors: string[] }
  > {
    const validated = this.validator.validatePackage(input);
    if (!validated.ok) {
      return { ok: false, code: "SKILL_PACKAGE_INVALID", message: "skill package is invalid", errors: validated.errors };
    }
    const published = await this.skillStore.publishPackageToRegistry(input);
    if (published) {
      return { ok: true, skillPackage: validated.package, publishedToRegistry: true };
    }
    await this.skillStore.writePackage("custom", validated.package);
    await this.updateState((state) => ({
      ...state,
      customSkillIds: [...new Set([...state.customSkillIds, validated.package.manifest.id])],
      downloadedSkillIds: [...new Set([...state.downloadedSkillIds, validated.package.manifest.id])],
    }));
    return { ok: true, skillPackage: validated.package };
  }

  /** Marks an existing local skill package as installed. */
  async installSkill(skillId: string, localSkills: SkillRegistryItem[], version?: string): Promise<boolean> {
    const target = localSkills
      .filter((skill) => skill.id === skillId && (!version || skill.version === version) && skill.status !== "available" && skill.status !== "invalid")
      .sort((left, right) => compareVersion(right.version, left.version))[0];
    if (!target) {
      return false;
    }
    await this.updateState((state) => {
      const previous = state.installedSkills.find((record) => record.skillId === skillId);
      const nextRecord = installationRecordFromSkill(target);
      const previousInstalledSkills =
        previous && previous.version && previous.version !== nextRecord.version
          ? replaceRecord(state.previousInstalledSkills, previous)
          : state.previousInstalledSkills;
      return {
        ...state,
        installedSkills: replaceRecord(state.installedSkills, nextRecord),
        previousInstalledSkills,
      };
    });
    return true;
  }

  /** Restores the previous installed version if that package is still local. */
  async rollbackSkill(skillId: string, localSkills: SkillRegistryItem[]): Promise<boolean> {
    let rolledBack = false;
    await this.updateState((state) => {
      const current = state.installedSkills.find((record) => record.skillId === skillId);
      const previous = state.previousInstalledSkills.find((record) => record.skillId === skillId);
      if (!previous) return state;
      const target = localSkills.find((skill) => skill.id === skillId && skill.version === previous.version && skill.status !== "available" && skill.status !== "invalid");
      if (!target) return state;
      rolledBack = true;
      return {
        ...state,
        installedSkills: replaceRecord(state.installedSkills, { ...previous, sourceType: target.sourceType, registrySource: target.registrySource, installedAt: Date.now() }),
        previousInstalledSkills: current?.version ? replaceRecord(state.previousInstalledSkills, current) : state.previousInstalledSkills,
      };
    });
    return rolledBack;
  }

  /** Removes an installed marker while keeping the package available locally. */
  async uninstallSkill(skillId: string): Promise<void> {
    await this.updateState((state) => ({
      ...state,
      installedSkills: state.installedSkills.filter((record) => record.skillId !== skillId),
    }));
  }
}

function compareVersion(left: string, right: string): number {
  return compare(valid(left) ?? "0.0.0", valid(right) ?? "0.0.0");
}
