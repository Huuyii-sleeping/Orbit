import type { PromptDump } from "../../prompt/inspect.js";
import type { CliPaletteCandidate, CliPaletteView } from "../palette.js";
import type { CliPermissionMode } from "../permissions.js";
import type { CliTranscriptView } from "../transcript.js";
import type { CliDoctorReport } from "../ui.js";
import {
  type CliCompactSummary,
  type CliConfigSnapshot,
  type CliMcpResetSummary,
  type CliMcpServerStatus,
  type CliPermissionSnapshot,
  type CliSessionSummary,
  type CliSkillDetail,
  type CliSkillSummary,
  type CliStatusSnapshot,
  type CliThemeName,
  type CliUsageSnapshot,
} from "../ui.js";
import type { CliWorkflowMode } from "../workflow.js";

export type CliCommandResult =
  | { handled: false }
  | {
      handled: true;
      output: string;
      clearScreen?: boolean;
      exit?: boolean;
      showBanner?: boolean;
      nextSessionId?: string | null;
      submitPrompt?: string;
    };

type Awaitable<T> = T | Promise<T>;

export type CliCommandContext = {
  activeSessionId: string | null;
  createSession(): Awaitable<{ id: string }>;
  listSessions(): CliSessionSummary[];
  useSession(sessionId: string): boolean;
  listTools(): Promise<Array<Record<string, string>>>;
  getStatus(): Promise<CliStatusSnapshot>;
  getConfig(): Promise<CliConfigSnapshot>;
  getMcpStatus(): Promise<CliMcpServerStatus[]>;
  resetMcpAuthFailures(): Promise<CliMcpResetSummary>;
  getPermissions(): Promise<CliPermissionSnapshot>;
  setPermissionMode(mode: CliPermissionMode): boolean;
  listApprovals(
    status?: "pending" | "approved" | "rejected" | "expired" | "consumed",
  ): Promise<string>;
  approveRequest(requestId: string): Promise<string>;
  rejectRequest(requestId: string): Promise<string>;
  listSkills(): Promise<{
    skills: CliSkillSummary[];
    loadedNames: string[];
    missingNames: string[];
  }>;
  getSkill(name: string): Promise<CliSkillDetail | null>;
  dumpSystemPrompt(
    mode?: "default" | "protected",
  ): Promise<{ dump: PromptDump; loadedNames: string[]; missingNames: string[] }>;
  getUsage(): Promise<CliUsageSnapshot>;
  canCompactSession(): boolean;
  compactSession(keepRecent?: number): Promise<CliCompactSummary>;
  isComposing(): boolean;
  getComposeLineCount(): number;
  getComposeCharCount(): number;
  startCompose(): { lineCount: number; charCount: number };
  appendComposeLine(line: string): { lineCount: number; charCount: number };
  previewCompose(): { lineCount: number; charCount: number; content: string } | null;
  popCompose(
    count: number,
  ): { removedLineCount: number; lineCount: number; charCount: number; content: string } | null;
  sendCompose(): { lineCount: number; charCount: number; content: string } | null;
  cancelCompose(): { lineCount: number; charCount: number; content: string } | null;
  getModel(): string;
  setModel(model: string): Promise<boolean>;
  addWorkspaceRoot(
    root: string,
  ): Promise<{ ok: true; root: string } | { ok: false; error: string }>;
  runDoctor(): Promise<CliDoctorReport>;
  getTheme(): CliThemeName;
  setTheme(theme: CliThemeName): boolean;
  getWorkflow(): CliWorkflowMode;
  setWorkflow(mode: CliWorkflowMode): boolean;
  showPalette(query?: string): Promise<CliPaletteView>;
  openPalette(index: number): CliPaletteCandidate | null;
  showTranscript(direction?: "current" | "next" | "prev" | "first" | "last"): CliTranscriptView;
  searchTranscript(query: string): CliTranscriptView;
  moveTranscriptSearch(direction: "next" | "prev"): CliTranscriptView | null;
  peekTranscript(entryIndex: number): CliTranscriptView | null;
  moveTranscriptPeek(direction: "next" | "prev"): CliTranscriptView | null;
  tailTranscript(): CliTranscriptView;
};

/** 解析后的本地斜杠命令，不进入模型调用。 */
export type ParsedCliCommand = { command: string; args: string[] };
