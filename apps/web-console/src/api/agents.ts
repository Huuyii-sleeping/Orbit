import { getErrorMessage } from "../lib/errors/error-factory";
import {
  type AgentSkillBinding,
  type AgentRuntimeContext,
  type AgentResolvedSkillSummary,
  type AgentSkillPreflightIssue,
  type AgentSkillPreflightResult,
  type AgentProfile,
  type AgentProfileInput,
  type AgentVersionCatalogItem,
  type PublishAgentVersionInput,
} from "./types";
import {
  type JsonObject,
  asObject,
  asNumber,
  cleanText,
  cleanOptionalText,
  cleanColor,
  cleanStringList,
  cleanNumber,
  requestJson,
  ApiRequestError,
  jsonRequest,
} from "./client";
import { normalizeRegistrySource, normalizeSourceType } from "./skills";

export const defaultAgentProfileInput: AgentProfileInput = {
  avatarId: "brain",
  name: "本地研发 Agent",
  description: "面向代码、文档和自动化执行的本地 agent。",
  scenario: "本地研发、资料整理、任务拆解和交付验证。",
  skillIds: ["code-workspace", "memory-context", "quality-gate"],
  skills: [
    {
      skillId: "code-workspace",
      version: "",
      sourceType: "builtin",
      registrySource: "local",
    },
    {
      skillId: "memory-context",
      version: "",
      sourceType: "builtin",
      registrySource: "local",
    },
    {
      skillId: "quality-gate",
      version: "",
      sourceType: "builtin",
      registrySource: "local",
    },
  ],
  actions: ["分析需求", "执行任务", "验证结果"],
  systemPrompt:
    "你是一个严谨的本地工作台 agent，优先明确目标、执行验证，并给出可复查的结果。",
  color: "",
};

function legacyAgentSkillBinding(skillId: string): AgentSkillBinding {
  return {
    skillId,
    version: "",
    sourceType: "builtin",
    registrySource: "local",
  };
}

function normalizeAgentSkillBindings(
  value: unknown,
  legacySkillIds: string[],
): AgentSkillBinding[] {
  if (!Array.isArray(value)) {
    return legacySkillIds.map(legacyAgentSkillBinding);
  }
  const byId = new Map<string, AgentSkillBinding>();
  for (const item of value) {
    const record = asObject(item);
    const skillId = cleanOptionalText(record.skillId, 80);
    if (!skillId) {
      continue;
    }
    const sourceType = normalizeSourceType(record.sourceType);
    byId.set(skillId, {
      skillId,
      version: cleanOptionalText(record.version, 40),
      sourceType,
      registrySource: normalizeRegistrySource(
        record.registrySource,
        sourceType,
      ),
    });
  }
  const bindings = [...byId.values()].slice(0, 24);
  return bindings.length
    ? bindings
    : legacySkillIds.map(legacyAgentSkillBinding);
}

/** 归一化会话绑定的最小 Agent 上下文。 */
export function normalizeAgentRuntimeContext(
  value: unknown,
): AgentRuntimeContext | null {
  const record = asObject(value);
  const id = cleanOptionalText(record.id, 80);
  if (!id) {
    return null;
  }
  const legacySkillIds = cleanStringList(record.skillIds, 24, 80);
  return {
    id,
    name: cleanText(record.name, "Agent").slice(0, 36),
    skills: normalizeAgentSkillBindings(record.skills, legacySkillIds),
  };
}

function normalizeResolvedSkillSummary(
  value: unknown,
): AgentResolvedSkillSummary {
  const record = asObject(value);
  return {
    name: cleanText(record.name, "未命名 Skill").slice(0, 80),
    sourceType: normalizeSourceType(record.sourceType),
    path: cleanOptionalText(record.path, 600),
    contentLength: Math.max(
      0,
      Math.floor(cleanNumber(record.contentLength, 0)),
    ),
  };
}

function normalizePreflightIssue(value: unknown): AgentSkillPreflightIssue {
  const record = asObject(value);
  return {
    skillId: cleanOptionalText(record.skillId, 80),
    version: cleanOptionalText(record.version, 40),
    sourceType: normalizeSourceType(record.sourceType),
    code: cleanText(record.code, "SKILL_PRECHECK_FAILED").slice(0, 80),
    message: getErrorMessage(record),
  };
}

function normalizeAgentSkillPreflightResult(
  value: unknown,
): AgentSkillPreflightResult {
  const record = asObject(value);
  const agent = normalizeAgentRuntimeContext(record.agent);
  if (record.ok !== false) {
    const skills = Array.isArray(record.skills) ? record.skills : [];
    return {
      ok: true,
      agent,
      skills: skills.map(normalizeResolvedSkillSummary),
    };
  }
  const error = asObject(record.error);
  const details = Array.isArray(error.details) ? error.details : [];
  return {
    ok: false,
    code: cleanText(error.code, "AGENT_SKILL_PREFLIGHT_FAILED").slice(0, 80),
    message: getErrorMessage(error),
    agent,
    issues: details
      .map(normalizePreflightIssue)
      .filter((issue) => issue.skillId),
  };
}

/** Normalize an agent profile before it is displayed in the Web console. */
export function normalizeAgentProfile(value: unknown): AgentProfile {
  const record = asObject(value);
  const legacySkillIds = cleanStringList(record.skillIds, 24, 80);
  const skills = normalizeAgentSkillBindings(record.skills, legacySkillIds);
  return {
    id: cleanText(record.id, "").slice(0, 80),
    avatarId: cleanText(
      record.avatarId,
      defaultAgentProfileInput.avatarId,
    ).slice(0, 40),
    name: cleanText(record.name, defaultAgentProfileInput.name).slice(0, 36),
    description:
      cleanOptionalText(record.description, 140) ||
      defaultAgentProfileInput.description,
    scenario:
      cleanOptionalText(record.scenario, 180) ||
      defaultAgentProfileInput.scenario,
    skillIds: skills.map((skill) => skill.skillId),
    skills,
    actions: cleanStringList(record.actions, 24, 80),
    systemPrompt:
      cleanOptionalText(record.systemPrompt, 1600) ||
      defaultAgentProfileInput.systemPrompt,
    color: cleanColor(record.color),
    createdAt: asNumber(record.createdAt),
    updatedAt: asNumber(record.updatedAt),
  };
}

/** Normalize editable agent profile input before sending it to the BFF. */
export function normalizeAgentProfileInput(value: unknown): AgentProfileInput {
  const agent = normalizeAgentProfile(value);
  return {
    avatarId: agent.avatarId,
    name: agent.name,
    description: agent.description,
    scenario: agent.scenario,
    skillIds: agent.skillIds,
    skills: agent.skills,
    actions: agent.actions,
    systemPrompt: agent.systemPrompt,
    color: agent.color,
  };
}

/** Normalize an immutable AgentVersion returned by the BFF catalog. */
export function normalizeAgentVersion(value: unknown): AgentVersionCatalogItem {
  const record = asObject(value);
  const toolPolicy = asObject(record.toolPolicy);
  const skillPolicy = asObject(record.skillPolicy);
  return {
    id: cleanText(record.id, "").slice(0, 80),
    agentProfileId: cleanText(record.agentProfileId, "").slice(0, 80),
    version: Math.max(0, Math.trunc(asNumber(record.version) ?? 0)),
    contentHash: cleanText(record.contentHash, "").slice(0, 64),
    name: cleanText(record.name, "未命名 Agent 版本").slice(0, 120),
    description: cleanOptionalText(record.description, 500),
    instructions: cleanStringList(record.instructions, 32, 4000),
    toolPolicy: {
      allowedToolIds: cleanStringList(toolPolicy.allowedToolIds, 128, 160),
    },
    skillPolicy: {
      bindings: normalizeAgentSkillBindings(skillPolicy.bindings, []),
    },
    outputSchema: asObject(record.outputSchema),
    createdBy: cleanText(record.createdBy, "local-user").slice(0, 80),
    releaseNotes: cleanOptionalText(record.releaseNotes, 500),
    createdAt: asNumber(record.createdAt) ?? 0,
  };
}

/** Fetches locally persisted agent profiles through the BFF business API. */
export async function fetchAgents(): Promise<AgentProfile[]> {
  const response = await requestJson<JsonObject>("/api/agents");
  const agents = Array.isArray(response.agents) ? response.agents : [];
  return agents.map(normalizeAgentProfile).filter((agent) => agent.id);
}

/** Creates a locally persisted agent profile through the BFF business API. */
export async function createAgentProfile(
  input: Partial<AgentProfileInput> = {},
): Promise<AgentProfile> {
  const inputRecord = asObject(input);
  const mergedInput: Partial<AgentProfileInput> = {
    ...defaultAgentProfileInput,
    ...input,
  };
  if (
    Array.isArray(inputRecord.skillIds) &&
    !Array.isArray(inputRecord.skills)
  ) {
    delete mergedInput.skills;
  }
  const response = await requestJson<JsonObject>("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizeAgentProfileInput(mergedInput)),
  });
  return normalizeAgentProfile(response.agent);
}

/** Updates a locally persisted agent profile through the BFF business API. */
export async function updateAgentProfile(
  agentId: string,
  input: AgentProfileInput,
): Promise<AgentProfile> {
  const response = await requestJson<JsonObject>(
    `/api/agents/${encodeURIComponent(agentId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizeAgentProfileInput(input)),
    },
  );
  return normalizeAgentProfile(response.agent);
}

/** Deletes a locally persisted agent profile through the BFF business API. */
export async function deleteAgentProfile(agentId: string): Promise<void> {
  await requestJson<JsonObject>(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
  });
}

/** Publishes the current AgentProfile as a new immutable version. */
export async function publishAgentVersion(
  agentProfileId: string,
  input: PublishAgentVersionInput = {},
): Promise<AgentVersionCatalogItem> {
  const response = await requestJson<{ version?: unknown }>(
    `/api/agents/${encodeURIComponent(agentProfileId)}/versions`,
    jsonRequest("POST", {
      createdBy: cleanOptionalText(input.createdBy, 80),
      releaseNotes: cleanOptionalText(input.releaseNotes, 500),
    }),
  );
  return normalizeAgentVersion(response.version);
}

/** Fetches the read-only AgentVersion catalog, optionally filtered by profile. */
export async function fetchAgentVersions(
  agentProfileId?: string,
): Promise<AgentVersionCatalogItem[]> {
  const query = agentProfileId
    ? `?agentProfileId=${encodeURIComponent(agentProfileId)}`
    : "";
  const response = await requestJson<{ versions?: unknown }>(
    `/api/agent-versions${query}`,
  );
  return (Array.isArray(response.versions) ? response.versions : [])
    .map(normalizeAgentVersion)
    .filter(
      (version) => version.id && version.agentProfileId && version.version > 0,
    );
}

/** Fetches one immutable AgentVersion by its stable id. */
export async function fetchAgentVersion(
  agentVersionId: string,
): Promise<AgentVersionCatalogItem> {
  const response = await requestJson<{ version?: unknown }>(
    `/api/agent-versions/${encodeURIComponent(agentVersionId)}`,
  );
  return normalizeAgentVersion(response.version);
}

/** Checks whether an Agent profile's version-bound skills can be loaded by the runtime. */
export async function resolveAgentSkills(
  agent: AgentRuntimeContext,
): Promise<AgentSkillPreflightResult> {
  try {
    const parsed = await requestJson<JsonObject>("/api/agent-skills/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
    });
    return normalizeAgentSkillPreflightResult(parsed);
  } catch (error) {
    // 技能预检失败是可编辑的业务结果；连接失败和其他异常继续上抛。
    if (!(error instanceof ApiRequestError) || !["AGENT_SKILL_LOAD_FAILED", "AGENT_SKILL_PREFLIGHT_FAILED"].includes(error.code)) throw error;
    return normalizeAgentSkillPreflightResult({
      ok: false, agent, error: { ...error.metadata, code: error.code, message: error.message },
    });
  }
}
