import { Inject, Injectable } from "@nestjs/common";
import {
  createContentHash,
  normalizeAgentConfiguration,
  DEFAULT_AGENT_CONFIGURATION,
  type AgentVersion,
} from "@orbit/workflow-core";
import { AgentProfileService, type AgentProfile } from "./agent-profile.service.js";
import { AGENT_VERSION_REPOSITORY, type AgentVersionRepository } from "./agent-version.repository.js";

/** AgentVersion 发布或查询找不到产品实体。 */
export class AgentVersionNotFoundError extends Error {
  readonly code = "AGENT_VERSION_NOT_FOUND";

  constructor(readonly entity: "profile" | "version", readonly id: string) {
    super(`${entity === "profile" ? "AgentProfile" : "AgentVersion"} ${id} 不存在。`);
  }
}

/** 兼容既有调用方的默认文本输出契约。 */
export const DEFAULT_AGENT_VERSION_OUTPUT_SCHEMA = DEFAULT_AGENT_CONFIGURATION.outputSchema;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown, fallback = "", limit = 500): string {
  return typeof value === "string" ? (value.trim() || fallback).slice(0, limit) : fallback;
}

/** 从当前 AgentProfile 生成不可变发布版本并提供只读查询。 */
@Injectable()
export class AgentVersionService {
  constructor(
    @Inject(AgentProfileService) private readonly profiles: AgentProfileService,
    @Inject(AGENT_VERSION_REPOSITORY) private readonly versions: AgentVersionRepository,
  ) {}

  /** 发布请求仅接受审计元数据，运行字段全部来自服务端 profile 快照。 */
  async publish(agentProfileId: string, input: unknown): Promise<AgentVersion> {
    const profile = await this.profiles.getAgent(agentProfileId);
    if (!profile) throw new AgentVersionNotFoundError("profile", agentProfileId);
    const metadata = asRecord(input);
    const snapshot = this.snapshot(profile);
    return this.versions.publish({
      ...snapshot,
      contentHash: await createContentHash(snapshot),
      createdBy: cleanText(metadata.createdBy, "local-user", 80),
      releaseNotes: cleanText(metadata.releaseNotes, "", 500),
      createdAt: Date.now(),
    });
  }

  /** 用于独立试跑的草稿快照；不写入发布版本目录。 */
  async draftSnapshot(agentProfileId: string): Promise<AgentVersion> {
    const profile = await this.profiles.getAgent(agentProfileId);
    if (!profile) throw new AgentVersionNotFoundError("profile", agentProfileId);
    const snapshot = this.snapshot(profile);
    const contentHash = await createContentHash(snapshot);
    return { ...snapshot, id: `draft-${contentHash}`, version: 1, contentHash, createdAt: Date.now(), createdBy: "local-user", releaseNotes: "草稿试跑" };
  }

  private snapshot(profile: AgentProfile) {
    const config = normalizeAgentConfiguration(profile.configuration);
    return {
      agentProfileId: profile.id, name: profile.name, description: profile.description,
      instructions: [profile.systemPrompt], modelId: config.modelId,
      toolPolicy: { allowedToolIds: config.allowedToolIds },
      skillPolicy: { bindings: profile.skills.map((skill) => ({ ...skill })) },
      outputSchema: config.outputSchema,
    };
  }

  /** 列出全部版本，或按 AgentProfile 过滤。 */
  list(agentProfileId?: string): AgentVersion[] {
    return this.versions.list(cleanText(agentProfileId, "", 80) || undefined);
  }

  /** 查询单个不可变版本。 */
  get(agentVersionId: string): AgentVersion {
    const version = this.versions.getById(agentVersionId);
    if (!version) throw new AgentVersionNotFoundError("version", agentVersionId);
    return version;
  }
}
