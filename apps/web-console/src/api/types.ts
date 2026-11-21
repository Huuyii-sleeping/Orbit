import {
  type AgentVersion,
  type WorkflowDiagnostic,
  type WorkflowDraft,
  type WorkflowRunMode,
  type WorkflowVersion,
} from "@orbit/workflow-core";

/** Role names returned by the agent service transcript API. */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** Chat transcript message shape consumed by the Web console. */
export type ChatMessage = {
  role: ChatRole;
  content?: string | null;
  tool_call_id?: string;
  name?: string;
};

/** Compact session record used by the session list and status panel. */
export type SessionSummary = {
  id: string;
  createdAt: number | null;
  updatedAt: number | null;
  busy: boolean;
  messageCount: number;
  rounds: number | null;
  agent: AgentRuntimeContext | null;
};

/** Session detail DTO with normalized transcript messages. */
export type SessionDetail = SessionSummary & {
  messages: ChatMessage[];
};

/** BFF and upstream agent health state displayed in the top bar. */
export type HealthStatus = {
  ok: boolean;
  connected: boolean;
  bffStatus: string;
  agentStatus: string;
};

/** BFF 返回的不可变 SOP 版本摘要。 */
export type SopVersionSummary = Omit<WorkflowVersion, "nodes" | "edges"> & {
  nodeCount: number;
  edgeCount: number;
};

/** SOP 导入预检结果。 */
export type SopImportPreview = {
  draft: WorkflowDraft;
  diagnostics: WorkflowDiagnostic[];
  migrated: boolean;
  publishable: boolean;
};

/** Web 调试面板启动运行时的参数。 */
export type StartWorkflowRunInput = {
  workflowId: string;
  mode: WorkflowRunMode;
  versionId?: string;
  draft?: WorkflowDraft;
  inputs?: Record<string, unknown>;
  targetNodeId?: string;
  nodeInputs?: Record<string, unknown>;
};

/** 可关闭的工作流 SSE 订阅。 */
export type WorkflowRunEventStream = { close(): void };

/** Local Web Console profile managed by the BFF business API. */
export type UserProfile = {
  displayName: string;
  description: string;
};

/** Where a skill entered the local Skill Hub from. */
export type SkillSourceType = "builtin" | "remote" | "custom";

/** Trust channel claimed by a registry entry or assigned by the local hub. */
export type SkillRegistrySource =
  | "official"
  | "verified"
  | "community"
  | "private"
  | "local";

/** Version-locked skill binding stored by an Agent profile. */
export type AgentSkillBinding = {
  skillId: string;
  version: string;
  sourceType: SkillSourceType;
  registrySource: SkillRegistrySource;
};

/** Minimal Agent context passed into the runtime session APIs. */
export type AgentRuntimeContext = {
  id: string;
  name: string;
  skills: AgentSkillBinding[];
};

export type AgentResolvedSkillSummary = {
  name: string;
  sourceType: SkillSourceType;
  path: string;
  contentLength: number;
};

export type AgentSkillPreflightIssue = {
  skillId: string;
  version: string;
  sourceType: SkillSourceType;
  code: string;
  message: string;
};

export type AgentSkillPreflightResult =
  | {
      ok: true;
      agent: AgentRuntimeContext | null;
      skills: AgentResolvedSkillSummary[];
    }
  | {
      ok: false;
      code: string;
      message: string;
      agent: AgentRuntimeContext | null;
      issues: AgentSkillPreflightIssue[];
    };

/** User-managed agent profile displayed and edited in the Agent management workspace. */
export type AgentProfile = {
  id: string;
  avatarId: string;
  name: string;
  description: string;
  scenario: string;
  skillIds: string[];
  skills: AgentSkillBinding[];
  actions: string[];
  systemPrompt: string;
  /** Optional user-picked accent color as a `#rrggbb` hex string; empty means auto (hash-based). */
  color: string;
  createdAt: number | null;
  updatedAt: number | null;
};

/** Editable payload accepted by the BFF agent profile APIs. */
export type AgentProfileInput = Pick<
  AgentProfile,
  | "avatarId"
  | "name"
  | "description"
  | "scenario"
  | "skillIds"
  | "skills"
  | "actions"
  | "systemPrompt"
  | "color"
>;

/** Web 只读展示和选择使用的不可变 AgentVersion。 */
export type AgentVersionCatalogItem = AgentVersion;

/** AgentVersion 发布只接受审计元数据。 */
export type PublishAgentVersionInput = {
  createdBy?: string;
  releaseNotes?: string;
};

/** Local skill registry item returned by the BFF Skill Hub APIs. */
export type SkillStatus =
  | "available"
  | "downloaded"
  | "installed"
  | "updateAvailable"
  | "invalid";

export type SkillPublisher = {
  id: string;
  name: string;
  verified: boolean;
};

export type SkillRegistryItem = {
  id: string;
  name: string;
  description: string;
  summary: string;
  category: string;
  provider: string;
  version: string;
  runtime: string;
  permissions: string[];
  updatedAt: string;
  maturity: "stable" | "beta";
  tags: string[];
  entry: string;
  sourceType: SkillSourceType;
  registrySource: SkillRegistrySource;
  publisher: SkillPublisher;
  downloads: number;
  rating: number | null;
  packageSha256: string;
  deprecated: boolean;
  status: SkillStatus;
  installed: boolean;
  installedVersion: string;
  installedAt: number | null;
  availableVersion: string;
  previousInstalledVersion: string;
  validationErrors: string[];
  /** Installable versions offered at install time (e.g. a version picker). */
  versions: string[];
};

export type SkillAuditAction =
  | "download"
  | "upload"
  | "install"
  | "update"
  | "rollback"
  | "uninstall";

export type SkillAuditEvent = {
  id: string;
  action: SkillAuditAction;
  ok: boolean;
  code: string;
  message: string;
  skillId: string;
  skillName: string;
  version: string;
  status: SkillStatus;
  at: number;
};

/** JSON package accepted by the custom Skill Hub upload API. */
export type SkillPackageInput = {
  skillPackageVersion?: "1.0";
  files: Array<{ path: string; content: string }>;
};

/** Remote Skill Registry connection settings returned by BFF. */
export type RemoteRegistrySettings = {
  url: string;
  managedByService: boolean;
  lastSyncedAt: number | null;
  lastSyncError: string;
  skillCount: number;
};

export type SkillHubReadiness = {
  status: "ready" | "degraded" | "blocked";
  registry: RemoteRegistrySettings;
  store: {
    readable: boolean;
    message: string;
  };
  counts: {
    total: number;
    installed: number;
    updateAvailable: number;
    invalid: number;
    failedAudit: number;
  };
};

/** Result returned after sending a user message to the active session. */
export type SendMessageResult = {
  ok: boolean;
  assistant?: string;
  session?: SessionSummary;
  error?: {
    code: string;
    message: string;
  };
};

export type StreamMessageEvent =
  | { type: "message.start"; data: { session_id?: string } }
  | { type: "message.delta"; data: { delta?: string } }
  | { type: "message.done"; data: SendMessageResult }
  | { type: "message.error"; data: { code?: string; message?: string } };

/** Agent bridge events delivered by the BFF SSE endpoint. */
export type AgentStreamEvent = {
  type: string;
  id: string | null;
  data: unknown;
};

export type AgentEventStream = {
  close(): void;
};
