import { Inject, Injectable } from "@nestjs/common";
import {
  createContentHash,
  assertWorkflowDefinitionBudget,
  assertWorkflowJsonBudget,
  WORKFLOW_PAYLOAD_LIMITS,
  WorkflowResourceLimitError,
  isWorkflowDraft,
  migrateSopDraftV1,
  normalizeWorkflowContent,
  normalizeWorkflowDraft,
  stableSerialize,
  validateWorkflowDraft,
  type WorkflowDraft,
  type WorkflowStageECapabilityRegistry,
  type WorkflowVersion,
  type AgentVersionResolver,
} from "@orbit/workflow-core";
import { randomUUID } from "node:crypto";
import { AGENT_VERSION_REPOSITORY } from "../agents/agent-version.repository.js";
import { SopDatabase } from "../storage/sop-database.js";
import { OrganizationOperationsService } from "../identity/organization-operations.service.js";
import { SopNotFoundError, SopRevisionConflictError, SopValidationError } from "./sops.errors.js";
import { SOPS_REPOSITORY, type SopsRepository } from "./sops.repository.js";
import { WORKFLOW_STAGE_E_CAPABILITY_REGISTRY } from "./workflow-stage-e-capabilities.js";
import type {
  PublishSopInput,
  SaveSopDraftInput,
  SaveSopTemplateInput,
  SopImportPreview,
  SopTemplate,
  SopVersionDiff,
  SopVersionSummary,
} from "./sops.types.js";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown, fallback = "", limit = 240): string {
  return typeof value === "string" ? (value.trim() || fallback).slice(0, limit) : fallback;
}

function snapshotName(version: WorkflowVersion): string {
  return cleanText(asObject(version.metadata).name, `工作流 v${version.version}`, 120);
}

function snapshotSummary(version: WorkflowVersion): string {
  return cleanText(asObject(version.metadata).summary, "从不可变版本创建的草稿。", 500);
}

function changedIds<T extends { id: string }>(from: T[], to: T[]): { added: string[]; removed: string[]; changed: string[] } {
  const fromMap = new Map(from.map((item) => [item.id, item]));
  const toMap = new Map(to.map((item) => [item.id, item]));
  return {
    added: [...toMap.keys()].filter((id) => !fromMap.has(id)).sort(),
    removed: [...fromMap.keys()].filter((id) => !toMap.has(id)).sort(),
    changed: [...toMap.keys()].filter((id) => fromMap.has(id) && stableSerialize(fromMap.get(id)) !== stableSerialize(toMap.get(id))).sort(),
  };
}

/** SOP 业务规则：草稿并发、发布预检、版本差异、导入迁移和模板生命周期。 */
@Injectable()
export class SopsService {
  constructor(
    @Inject(SOPS_REPOSITORY) private readonly repository: SopsRepository,
    @Inject(SopDatabase) private readonly storage: Pick<SopDatabase, "health" | "backup" | "restore">,
    @Inject(OrganizationOperationsService) private readonly operations: OrganizationOperationsService,
    @Inject(AGENT_VERSION_REPOSITORY) private readonly agentVersions?: AgentVersionResolver,
    @Inject(WORKFLOW_STAGE_E_CAPABILITY_REGISTRY) private readonly stageECapabilities?: WorkflowStageECapabilityRegistry,
  ) {}

  listDrafts(): WorkflowDraft[] {
    this.operations.require("workflow.read");
    return this.repository.listDrafts();
  }

  getDraft(id: string): WorkflowDraft {
    this.operations.require("workflow.read");
    const draft = this.repository.getDraft(id);
    if (!draft) throw new SopNotFoundError("草稿", id);
    return draft;
  }

  createDraft(value: unknown): WorkflowDraft {
    this.operations.require("workflow.edit");
    const { draft } = this.parseImport(value);
    if (this.repository.getDraft(draft.id)) throw new SopValidationError(`草稿 ${draft.id} 已存在。`, { id: draft.id });
    const now = Date.now();
    return this.operations.mutate({ type: "workflow", id: draft.id }, "draft.create",
      () => this.repository.createDraft(normalizeWorkflowDraft({ ...draft, revision: 0, createdAt: now, updatedAt: now })));
  }

  saveDraft(id: string, input: SaveSopDraftInput): WorkflowDraft {
    this.operations.require("workflow.edit");
    assertWorkflowDefinitionBudget(input?.draft);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new SopValidationError("expectedRevision 必须是非负整数。 ");
    if (!isWorkflowDraft(input.draft)) throw new SopValidationError("草稿必须是 workflow v2 结构。 ");
    return this.operations.mutate({ type: "workflow", id }, "draft.save", () => this.repository.updateDraft(id, input.expectedRevision, input.draft));
  }

  deleteDraft(id: string, expectedRevision?: number): void {
    this.operations.require("workflow.edit");
    this.operations.mutate({ type: "workflow", id }, "draft.delete", () => {
      if (!this.repository.deleteDraft(id, expectedRevision)) throw new SopNotFoundError("草稿", id);
    });
  }

  async publish(id: string, input: PublishSopInput): Promise<WorkflowVersion> {
    return this.operations.perform("workflow.publish", { type: "workflow", id }, async (actor) => {
      const draft = this.getDraft(id);
      if (draft.revision !== input.expectedRevision) throw new SopRevisionConflictError(draft);
      assertWorkflowDefinitionBudget(draft, { workflowVersions: {
        resolvePublishedVersion: (workflowId, versionId) => this.repository.getVersion(workflowId, versionId) ?? undefined,
      } });
      const validation = validateWorkflowDraft(draft, {
        agentVersions: this.agentVersions,
        workflowVersions: {
          resolvePublishedVersion: (workflowId, versionId) => this.repository.getVersion(workflowId, versionId) ?? undefined,
        },
        stageECapabilities: this.stageECapabilities,
      });
      if (!validation.ok) throw new SopValidationError("发布前校验未通过。", { diagnostics: validation.diagnostics });
      const contentHash = await createContentHash(normalizeWorkflowContent(draft));
      return this.repository.publishVersion({
        schemaVersion: draft.schemaVersion,
        workflowId: draft.id,
        contentHash,
        createdAt: Date.now(),
        createdBy: actor?.subject ?? cleanText(input.createdBy, "local-user", 80),
        releaseNotes: cleanText(input.releaseNotes, "", 500),
        nodes: draft.nodes,
        edges: draft.edges,
        metadata: { ...draft.metadata, name: draft.name, summary: draft.summary, sourceRevision: draft.revision },
      });
    });
  }

  listVersions(workflowId: string): SopVersionSummary[] {
    this.operations.require("workflow.read");
    this.getDraft(workflowId);
    return this.repository.listVersions(workflowId);
  }

  getVersion(workflowId: string, versionId: string): WorkflowVersion {
    this.operations.require("workflow.read");
    const version = this.repository.getVersion(workflowId, versionId);
    if (!version) throw new SopNotFoundError("版本", versionId);
    return version;
  }

  diffVersions(workflowId: string, fromVersionId: string, toVersionId: string): SopVersionDiff {
    const from = this.getVersion(workflowId, fromVersionId);
    const to = this.getVersion(workflowId, toVersionId);
    const fromMetadata = asObject(from.metadata);
    const toMetadata = asObject(to.metadata);
    return {
      fromVersionId,
      toVersionId,
      nodes: changedIds(from.nodes, to.nodes),
      edges: changedIds(from.edges, to.edges),
      fields: {
        nameChanged: fromMetadata.name !== toMetadata.name,
        summaryChanged: fromMetadata.summary !== toMetadata.summary,
        metadataChanged: stableSerialize(fromMetadata) !== stableSerialize(toMetadata),
      },
    };
  }

  createDraftFromVersion(workflowId: string, versionId: string): WorkflowDraft {
    this.operations.require("workflow.edit");
    const version = this.getVersion(workflowId, versionId);
    assertWorkflowDefinitionBudget(version);
    const now = Date.now();
    const draft: WorkflowDraft = {
      schemaVersion: version.schemaVersion,
      id: randomUUID(),
      name: `${snapshotName(version)} · 恢复草稿`,
      summary: snapshotSummary(version),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      nodes: version.nodes,
      edges: version.edges,
      metadata: { sourceWorkflowId: workflowId, sourceVersionId: versionId },
    };
    return this.operations.mutate({ type: "workflow", id: draft.id }, "draft.from-version", () => this.repository.createDraft(draft));
  }

  previewImport(value: unknown): SopImportPreview {
    this.operations.require("workflow.edit");
    const parsed = this.parseImport(value);
    const validation = validateWorkflowDraft(parsed.draft, {
      agentVersions: this.agentVersions,
      stageECapabilities: this.stageECapabilities,
    });
    return {
      draft: parsed.draft,
      diagnostics: validation.diagnostics,
      migrated: parsed.migrated,
      publishable: validation.ok,
    };
  }

  importDraft(value: unknown): WorkflowDraft {
    this.operations.require("workflow.edit");
    const parsed = this.parseImport(value);
    const now = Date.now();
    const id = this.repository.getDraft(parsed.draft.id) ? randomUUID() : parsed.draft.id;
    return this.operations.mutate({ type: "workflow", id }, "draft.import",
      () => this.repository.createDraft({ ...parsed.draft, id, revision: 0, createdAt: now, updatedAt: now }));
  }

  exportDraft(id: string): WorkflowDraft {
    return this.getDraft(id);
  }

  saveTemplate(input: SaveSopTemplateInput): SopTemplate {
    this.operations.require("workflow.edit");
    assertWorkflowJsonBudget(input, WORKFLOW_PAYLOAD_LIMITS.definitionBytes);
    const version = this.repository.getVersionById(input.sourceVersionId);
    if (!version) throw new SopNotFoundError("版本", input.sourceVersionId);
    assertWorkflowDefinitionBudget(version);
    const now = Date.now();
    const templateId = input.id || randomUUID();
    const previous = this.repository.getTemplate(templateId);
    const template: SopTemplate = {
      id: templateId,
      version: 0,
      name: cleanText(input.name, snapshotName(version), 120),
      summary: cleanText(input.summary, snapshotSummary(version), 500),
      sourceWorkflowId: version.workflowId,
      sourceVersionId: version.id,
      parameterSchema: asObject(input.parameterSchema),
      draft: {
        schemaVersion: version.schemaVersion,
        id: version.workflowId,
        name: snapshotName(version),
        summary: snapshotSummary(version),
        revision: 0,
        createdAt: version.createdAt,
        updatedAt: version.createdAt,
        nodes: version.nodes,
        edges: version.edges,
        metadata: version.metadata,
      },
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    assertWorkflowJsonBudget(template, WORKFLOW_PAYLOAD_LIMITS.definitionBytes);
    return this.operations.mutate({ type: "template", id: template.id }, "template.save", () => this.repository.createTemplate(template));
  }

  listTemplates(): SopTemplate[] {
    this.operations.require("workflow.read");
    return this.repository.listTemplates();
  }

  getTemplate(id: string, version?: number): SopTemplate {
    this.operations.require("workflow.read");
    const template = this.repository.getTemplate(id, version);
    if (!template) throw new SopNotFoundError("模板", id);
    return template;
  }

  deleteTemplate(id: string): void {
    this.operations.require("workflow.edit");
    this.operations.mutate({ type: "template", id }, "template.delete", () => {
      if (!this.repository.deleteTemplate(id)) throw new SopNotFoundError("模板", id);
    });
  }

  createDraftFromTemplate(id: string, version: number | undefined, parameters: unknown): WorkflowDraft {
    this.operations.require("workflow.edit");
    assertWorkflowJsonBudget(parameters ?? {}, WORKFLOW_PAYLOAD_LIMITS.inputBytes);
    const template = this.getTemplate(id, version);
    const now = Date.now();
    const draft: WorkflowDraft = {
      ...template.draft,
      id: randomUUID(),
      name: template.name,
      summary: template.summary,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      metadata: {
        ...template.draft.metadata,
        template: { id: template.id, version: template.version, parameters: asObject(parameters) },
      },
    };
    assertWorkflowDefinitionBudget(draft);
    return this.operations.mutate({ type: "workflow", id: draft.id }, "draft.from-template", () => this.repository.createDraft(draft));
  }

  storageHealth() {
    this.operations.requireLocalMaintenance();
    return this.storage.health();
  }

  async backup(label?: string): Promise<string> {
    this.operations.requireLocalMaintenance();
    return this.storage.backup(label);
  }

  async restore(fileName: string): Promise<void> {
    this.operations.requireLocalMaintenance();
    await this.storage.backup("before-restore");
    await this.storage.restore(fileName);
  }

  private parseImport(value: unknown): { draft: WorkflowDraft; migrated: boolean } {
    assertWorkflowDefinitionBudget(value);
    try {
      if (isWorkflowDraft(value)) return { draft: normalizeWorkflowDraft(value), migrated: false };
      const draft = migrateSopDraftV1(value);
      assertWorkflowDefinitionBudget(draft);
      return { draft, migrated: true };
    } catch (error) {
      if (error instanceof WorkflowResourceLimitError) throw error;
      throw new SopValidationError(error instanceof Error ? error.message : "SOP 导入数据无效。 ");
    }
  }
}
