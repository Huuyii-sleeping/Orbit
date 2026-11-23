import type { BashSandboxMode } from "../../config/runtime-config.js";
import type { CliPermissionMode } from "../permissions.js";

export type CliThemeName = "atlas" | "plain";

export type CliBannerInput = {
  title: string;
  workspace: string;
  mode: string;
  model: string;
  sessionId: string | null;
  commands: string[];
};

export type CliStatusSnapshot = {
  workspace: string;
  mode: string;
  model: string;
  activeSessionId: string | null;
  sessionCount: number;
  toolCount: number;
  mcpToolCount: number;
  mcpServerCount: number;
  hookCount: number;
  bridgeEndpoint: string;
  schedulerStatus: string;
  theme: CliThemeName;
  permissionMode: CliPermissionMode;
  bashSandboxMode: BashSandboxMode;
  pendingApprovals: number;
  workspaceRoots: string[];
  sessionPromptTokens: number;
  sessionCompletionTokens: number;
  dailyPromptTokens: number;
  dailyCompletionTokens: number;
  sessionEstimatedCostUsd: number;
  dailyEstimatedCostUsd: number;
  sessionTokenBudget: number;
  dailyTokenBudget: number;
};

export type CliConfigSnapshot = {
  modelConfigured: boolean;
  model: string;
  openAiBaseUrl: string;
  mcpConfigPath: string;
  mcpConfigured: boolean;
  hooksConfigPath: string;
  hooksConfigured: boolean;
  releaseCheckConfigured: boolean;
  theme: CliThemeName;
  permissionMode: CliPermissionMode;
  bashSandboxMode: BashSandboxMode;
  workspaceRoots: string[];
};

export type CliMcpServerStatus = {
  name: string;
  trusted: boolean;
  provenance: string;
  credentialMode: "none" | "configured";
  toolCount: number;
  authFailed: boolean;
  authFailureMessage?: string;
  activeCalls: number;
  queuedCalls: number;
  maxConcurrentCalls: number;
  allowedTools: string[];
  disabledTools: string[];
};

export type CliMcpResetSummary = {
  cleared: number;
};

export type CliDoctorSeverity = "pass" | "warn" | "error";

export type CliDoctorCheck = {
  id: string;
  label: string;
  severity: CliDoctorSeverity;
  reason: string;
  suggestion: string;
};

export type CliDoctorReport = {
  checks: CliDoctorCheck[];
};

export type CliSessionSummary = {
  id: string;
  messageCount: number;
  busy: boolean;
  active: boolean;
};

export type CliPermissionSnapshot = {
  mode: CliPermissionMode;
  pendingApprovals: number;
  approvedApprovals: number;
  rejectedApprovals: number;
  expiredApprovals: number;
  consumedApprovals: number;
};

export type CliUsageSnapshot = {
  model: string;
  sessionPromptTokens: number;
  sessionCompletionTokens: number;
  dailyPromptTokens: number;
  dailyCompletionTokens: number;
  sessionEstimatedCostUsd: number;
  dailyEstimatedCostUsd: number;
  sessionTokenBudget: number;
  dailyTokenBudget: number;
  dayKey: string;
};

export type CliCompactSummary = {
  keptRecent: number;
  oldMessageCount: number;
  newMessageCount: number;
  estimatedBefore: number;
  estimatedAfter: number;
  reducedBy: number;
  transcriptBeforePath?: string;
  transcriptAfterPath?: string;
  sourceThreadId?: string;
  threadId?: string;
};

export type CliApprovalListItem = {
  requestId: string;
  action: string;
  risk: string;
  status: string;
  reason: string;
};

export type CliComposerSnapshot = {
  active: boolean;
  lineCount: number;
  charCount: number;
};

export type CliSkillSummary = {
  name: string;
  description: string;
  path: string;
  root: string;
  loaded: boolean;
  allowedTools: string[];
  model: string | null;
  pathPatterns: string[];
  sourceType: string;
  containsShellCommands: boolean;
  canRunShell: boolean;
};

export type CliSkillDetail = CliSkillSummary & {
  metadata: Record<string, string | string[]>;
  content: string;
};

export type CliHelpTopicId =
  | "overview"
  | "draft"
  | "sessions"
  | "runtime"
  | "features"
  | "approvals"
  | "transcript"
  | "workflow"
  | "palette"
  | "all";

export type CliCloseoutInput = {
  sessionId: string | null;
  changedPaths: string[];
  validationSummary?: string | null;
  risks?: string[];
  suggestions?: string[];
};

export type CliPanelTone = "neutral" | "accent" | "success" | "warning" | "danger";
