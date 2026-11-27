import { AgentConfigurationError, normalizeAgentConfiguration, type AgentConfiguration } from "@orbit/workflow-core";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AgentProfileRepository } from "./agent-profile.repository.js";
import { SkillRegistryService } from "../skills/skill-registry.service.js";
import type { SkillRegistryItem } from "../skills/skill-types.js";
import type { SkillRegistrySource, SkillSourceType } from "../skills/skill-types.js";

/** Version-locked skill binding persisted on an agent profile. */
export type AgentSkillBinding = {
  skillId: string;
  version: string;
  sourceType: SkillSourceType;
  registrySource: SkillRegistrySource;
};

/** User-managed agent profile persisted by the BFF business store. */
export type AgentProfile = {
  id: string;
  /** 编辑并发控制版本；旧数据从 0 开始。 */
  revision: number;
  avatarId: string;
  name: string;
  description: string;
  scenario: string;
  skillIds: string[];
  skills: AgentSkillBinding[];
  actions: string[];
  systemPrompt: string;
  /** 随草稿保存并在发布时固定的运行配置。 */
  configuration?: AgentConfiguration;
  /** Optional user-picked accent color as a `#rrggbb` hex string; empty means auto (hash-based). */
  color: string;
  createdAt: number;
  updatedAt: number;
};

export type AgentSkillBindingValidationIssue = {
  skillId: string;
  code: "SKILL_NOT_INSTALLED" | "VERSION_MISMATCH" | "SOURCE_MISMATCH" | "REGISTRY_SOURCE_MISMATCH";
  message: string;
};

export class AgentSkillBindingValidationError extends Error {
  readonly code = "AGENT_SKILL_BINDING_INVALID";

  constructor(readonly issues: AgentSkillBindingValidationIssue[]) {
    super("agent skill binding is invalid");
  }
}

/** 草稿已被其他请求修改，调用方应重新读取后编辑。 */
export class AgentRevisionConflictError extends Error {
  readonly code = "AGENT_REVISION_CONFLICT";
  constructor() { super("agent revision conflict; reload the latest draft"); }
}

/** 编辑请求必须携带有效的非负整数 revision。 */
export class AgentRevisionInputError extends Error {
  readonly code = "AGENT_REVISION_INVALID";
  constructor() { super("revision must be a non-negative integer"); }
}

const defaultAgentProfile: Omit<AgentProfile, "id" | "createdAt" | "updatedAt"> = {
  revision: 0,
  avatarId: "brain",
  name: "",
  description: "",
  scenario: "",
  skillIds: [],
  skills: [],
  actions: [],
  systemPrompt: "",
  color: "",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, fallback: string, limit: number): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const next = value.trim();
  return (next || fallback).slice(0, limit);
}

function cleanOptionalText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function cleanStringList(value: unknown, limit: number, itemLimit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, itemLimit))
        .filter(Boolean),
    ),
  ].slice(0, limit);
}

function cleanAvatarId(value: unknown): string {
  const avatarIds = new Set(["brain", "bot", "code", "compass"]);
  return typeof value === "string" && avatarIds.has(value) ? value : defaultAgentProfile.avatarId;
}

/** Normalizes an accent color to a lowercase `#rrggbb` hex string, or "" (auto) when invalid. */
function cleanColor(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const next = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(next) ? next : "";
}

function cleanTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function cleanSourceType(value: unknown): SkillSourceType {
  return value === "remote" || value === "custom" || value === "builtin" ? value : "builtin";
}

function cleanRegistrySource(value: unknown, sourceType: SkillSourceType): SkillRegistrySource {
  if (value === "official" || value === "verified" || value === "community" || value === "private" || value === "local") {
    return value;
  }
  return sourceType === "remote" ? "community" : "local";
}

function legacySkillBinding(skillId: string): AgentSkillBinding {
  return {
    skillId,
    version: "",
    sourceType: "builtin",
    registrySource: "local",
  };
}

function cleanAgentSkillBindings(value: unknown, legacySkillIds: string[]): AgentSkillBinding[] {
  if (!Array.isArray(value)) {
    return legacySkillIds.map(legacySkillBinding);
  }
  const byId = new Map<string, AgentSkillBinding>();
  for (const item of value) {
    const record = asRecord(item);
    const skillId = cleanOptionalText(record.skillId, 80);
    if (!skillId) {
      continue;
    }
    const sourceType = cleanSourceType(record.sourceType);
    byId.set(skillId, {
      skillId,
      version: cleanOptionalText(record.version, 40),
      sourceType,
      registrySource: cleanRegistrySource(record.registrySource, sourceType),
    });
  }
  const bindings = [...byId.values()].slice(0, 24);
  return bindings.length ? bindings : legacySkillIds.map(legacySkillBinding);
}

function mergeAgentProfileInput(base: Omit<AgentProfile, "id" | "createdAt" | "updatedAt"> | AgentProfile, input: unknown): Record<string, unknown> {
  const inputRecord = asRecord(input);
  const merged = { ...base, ...inputRecord };
  if (Array.isArray(inputRecord.skillIds) && !Array.isArray(inputRecord.skills)) {
    delete (merged as Record<string, unknown>).skills;
  }
  return merged;
}

function skillBindingFromInstalled(skill: SkillRegistryItem): AgentSkillBinding {
  return {
    skillId: skill.id,
    version: skill.installedVersion || skill.version,
    sourceType: skill.sourceType,
    registrySource: skill.registrySource,
  };
}

/** Normalizes an agent profile before it leaves or enters the business store. */
export function normalizeAgentProfile(value: unknown, fallbackId: string = randomUUID(), fallbackTime = Date.now()): AgentProfile {
  const record = asRecord(value);
  const id = cleanText(record.id, fallbackId, 80);
  const createdAt = cleanTimestamp(record.createdAt, fallbackTime);
  const legacySkillIds = cleanStringList(record.skillIds, 24, 80);
  const skills = cleanAgentSkillBindings(record.skills, legacySkillIds);
  return {
    id,
    revision: Number.isSafeInteger(record.revision) && Number(record.revision) >= 0 ? Number(record.revision) : 0,
    avatarId: cleanAvatarId(record.avatarId),
    name: cleanText(record.name, defaultAgentProfile.name, 36),
    description: cleanOptionalText(record.description, 140) || defaultAgentProfile.description,
    scenario: cleanOptionalText(record.scenario, 180) || defaultAgentProfile.scenario,
    skillIds: skills.map((skill) => skill.skillId),
    skills,
    actions: cleanStringList(record.actions, 24, 80),
    systemPrompt: cleanOptionalText(record.systemPrompt, 1600) || defaultAgentProfile.systemPrompt,
    configuration: normalizeAgentConfiguration(record.configuration),
    color: cleanColor(record.color),
    createdAt,
    updatedAt: cleanTimestamp(record.updatedAt, createdAt),
  };
}

@Injectable()
export class AgentProfileService {
  constructor(
    @Inject(AgentProfileRepository) private readonly store: AgentProfileRepository,
    @Inject(SkillRegistryService) private readonly skillRegistryService: Pick<SkillRegistryService, "listSkills">,
  ) {}

  /** Lists user-managed agent profiles from newest update to oldest. */
  async listAgents(): Promise<AgentProfile[]> {
    const agents = await this.readAgents();
    return [...agents].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  /** Returns one current editable profile, or null when it does not exist. */
  async getAgent(agentId: string): Promise<AgentProfile | null> {
    return (await this.readAgents()).find((agent) => agent.id === agentId) ?? null;
  }

  /** Creates and persists a new agent profile. */
  async createAgent(input: unknown): Promise<AgentProfile> {
    const now = Date.now();
    const inputRecord = asRecord(input);
    const agent = normalizeAgentProfile(
      { ...mergeAgentProfileInput(defaultAgentProfile, input), id: randomUUID(), revision: 0, createdAt: now, updatedAt: now },
      randomUUID(),
      now,
    );
    this.validateRequiredFields(agent);
    const validated = await this.validateAgentSkillBindings(agent, {
      dropUnavailable: !Array.isArray(inputRecord.skillIds) && !Array.isArray(inputRecord.skills),
    });
    await this.store.update((agents) => [validated, ...agents]);
    return validated;
  }

  /** Updates an existing agent profile and returns null when the id is unknown. */
  async updateAgent(agentId: string, input: unknown): Promise<AgentProfile | null> {
    const agents = await this.readAgents();
    const current = agents.find((agent) => agent.id === agentId);
    if (!current) {
      return null;
    }
    const requestedRevision = asRecord(input).revision;
    if (requestedRevision !== undefined && (!Number.isSafeInteger(requestedRevision) || Number(requestedRevision) < 0)) {
      throw new AgentRevisionInputError();
    }
    if (requestedRevision !== undefined && requestedRevision !== current.revision) throw new AgentRevisionConflictError();
    const updated = normalizeAgentProfile(
      {
        ...mergeAgentProfileInput(current, input),
        id: current.id,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        updatedAt: Date.now(),
      },
      current.id,
      current.createdAt,
    );
    this.validateRequiredFields(updated);
    const validated = await this.validateAgentSkillBindings(updated);
    await this.store.update((latest) => {
      const persisted = latest.find((agent) => agent.id === agentId);
      if (!persisted || normalizeAgentProfile(persisted).revision !== current.revision) throw new AgentRevisionConflictError();
      return latest.map((agent) => agent.id === agentId ? validated : agent);
    });
    return validated;
  }

  /** Deletes an existing agent profile and reports whether a record was removed. */
  async deleteAgent(agentId: string): Promise<boolean> {
    let deleted = false;
    await this.store.update((agents) => {
      const next = agents.filter((agent) => agent.id !== agentId);
      deleted = next.length !== agents.length;
      return next;
    });
    return deleted;
  }

  private async readAgents(): Promise<AgentProfile[]> {
    const value = await this.store.list();
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => normalizeAgentProfile(item))
      .filter((agent, index, agents) => agents.findIndex((candidate) => candidate.id === agent.id) === index);
  }

  private validateRequiredFields(agent: AgentProfile) {
    if (!agent.name) throw new AgentConfigurationError("请填写 Agent 名称。");
    if (!agent.systemPrompt) throw new AgentConfigurationError("请填写 Agent 职责。");
  }

  private async validateAgentSkillBindings(
    agent: AgentProfile,
    options: { dropUnavailable?: boolean } = {},
  ): Promise<AgentProfile> {
    const installedSkills = (await this.skillRegistryService.listSkills()).filter((skill) => skill.installed);
    const installedById = new Map(installedSkills.map((skill) => [skill.id, skill]));
    const issues: AgentSkillBindingValidationIssue[] = [];
    const nextSkills: AgentSkillBinding[] = [];

    for (const binding of agent.skills) {
      const installed = installedById.get(binding.skillId);
      if (!installed) {
        if (!options.dropUnavailable) {
          issues.push({
            skillId: binding.skillId,
            code: "SKILL_NOT_INSTALLED",
            message: `skill ${binding.skillId} is not installed`,
          });
        }
        continue;
      }
      const expected = skillBindingFromInstalled(installed);
      if (binding.version && binding.version !== expected.version) {
        issues.push({
          skillId: binding.skillId,
          code: "VERSION_MISMATCH",
          message: `skill ${binding.skillId} is installed at ${expected.version || "(unknown)"}, not ${binding.version}`,
        });
        continue;
      }
      if (binding.sourceType !== expected.sourceType) {
        issues.push({
          skillId: binding.skillId,
          code: "SOURCE_MISMATCH",
          message: `skill ${binding.skillId} source type is ${expected.sourceType}, not ${binding.sourceType}`,
        });
        continue;
      }
      if (binding.registrySource !== expected.registrySource) {
        issues.push({
          skillId: binding.skillId,
          code: "REGISTRY_SOURCE_MISMATCH",
          message: `skill ${binding.skillId} registry source is ${expected.registrySource}, not ${binding.registrySource}`,
        });
        continue;
      }
      nextSkills.push(expected);
    }

    if (issues.length) {
      throw new AgentSkillBindingValidationError(issues);
    }
    return {
      ...agent,
      skillIds: nextSkills.map((skill) => skill.skillId),
      skills: nextSkills,
    };
  }
}
