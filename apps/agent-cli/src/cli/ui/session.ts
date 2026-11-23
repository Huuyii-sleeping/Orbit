import type { CliComposePreview } from "../composer.js";
import { getCliWorkflowLabel, type CliWorkflowMode } from "../workflow.js";
import {
  accent,
  danger,
  muted,
  renderRows,
  strong,
  success,
  toneColor,
  truncate,
  warning,
} from "./theme.js";
import type {
  CliBannerInput,
  CliCloseoutInput,
  CliCompactSummary,
  CliComposerSnapshot,
  CliPanelTone,
  CliSessionSummary,
} from "./types.js";

export function renderCliPrompt(
  sessionId: string | null,
  composer?: CliComposerSnapshot,
  workflow: CliWorkflowMode = "agent",
): string {
  const suffix = sessionId ? sessionId.slice(0, 6) : "shell";
  const workflowLabel = getCliWorkflowLabel(workflow);
  if (composer?.active) {
    const prefix = workflow === "draw" ? `draw-draft:${suffix}` : `draft:${suffix}`;
    return `${warning(prefix)} ${muted(`${composer.lineCount}l/${composer.charCount}c`)} ${muted("..")} `;
  }
  return `${accent(`${workflowLabel}:${suffix}`)} ${muted(">>")} `;
}

export function renderCliBadge(label: string, tone: CliPanelTone = "accent"): string {
  return toneColor(tone, `[${label}]`);
}

export function renderCliBanner(input: CliBannerInput): string {
  return [
    strong(input.title),
    renderRows([
      { label: "workspace", value: input.workspace },
      { label: "mode", value: input.mode },
      { label: "model", value: input.model },
      { label: "session", value: input.sessionId ?? "(none)" },
      { label: "commands", value: input.commands.join(" ") },
    ]),
    "",
  ].join("\n");
}

export function renderCliError(title: string, message: string, suggestion?: string): string {
  const lines = [danger(`error: ${title}`), message];
  if (suggestion) {
    lines.push(`${muted("next")}  ${suggestion}`);
  }
  return lines.join("\n");
}

export function renderCliSessions(sessions: CliSessionSummary[]): string {
  if (sessions.length === 0) {
    return `${strong("Sessions")}\n${muted("No sessions available.")}`;
  }
  return [
    strong("Sessions"),
    ...sessions.map((session, index) => {
      const marker = session.active ? "*" : " ";
      const busy = session.busy ? warning("busy") : success("idle");
      return `${marker} [${index + 1}] ${accent(session.id)} messages=${session.messageCount} status=${busy}`;
    }),
  ].join("\n");
}

export function renderCliComposerLines(preview: CliComposePreview, limit?: number): string[] {
  const lines = preview.content.split("\n");
  if (preview.lineCount === 0) {
    return ["(empty draft)"];
  }
  const total = lines.length;
  const startIndex = limit && limit > 0 && total > limit ? total - limit : 0;
  const lineNumberWidth = Math.max(2, String(total).length);
  const rendered: string[] = [];
  if (startIndex > 0) {
    rendered.push(`... ${startIndex} earlier line(s)`);
  }
  for (let index = startIndex; index < total; index += 1) {
    rendered.push(
      `${String(index + 1).padStart(lineNumberWidth, "0")}| ${lines[index] ?? ""}`.trimEnd(),
    );
  }
  return rendered;
}

export function renderCliComposer(preview: CliComposePreview): string {
  return [
    strong("Composer"),
    renderRows([
      { label: "lines", value: String(preview.lineCount) },
      { label: "chars", value: String(preview.charCount) },
    ]),
    "",
    ...renderCliComposerLines(preview),
  ].join("\n");
}

export function renderCliCompactSummary(summary: CliCompactSummary): string {
  return [
    strong("Compact"),
    renderRows([
      { label: "messages", value: `${summary.oldMessageCount} -> ${summary.newMessageCount}` },
      {
        label: "tokens",
        value: `${summary.estimatedBefore} -> ${summary.estimatedAfter} (-${summary.reducedBy})`,
      },
      { label: "keep recent", value: String(summary.keptRecent) },
      { label: "before", value: summary.sourceThreadId ?? summary.transcriptBeforePath ?? "" },
      { label: "after", value: summary.threadId ?? summary.transcriptAfterPath ?? "" },
      {
        label: "result",
        value: summary.reducedBy > 0 ? "已压缩实际上下文；原始历史保留" : "无需压缩，线程未切换",
      },
    ]),
  ].join("\n");
}

export function renderCliEvent(input: {
  kind: "tool" | "scheduled" | "approval" | "system";
  status: "running" | "done" | "failed" | "blocked" | "due" | "info";
  title: string;
  detail?: string;
  durationMs?: number;
}): string {
  const statusText =
    input.status === "done"
      ? success(input.status)
      : input.status === "running" || input.status === "due"
        ? warning(input.status)
        : input.status === "info"
          ? accent(input.status)
          : danger(input.status);
  const duration =
    input.durationMs && input.durationMs > 0 ? ` ${muted(`${input.durationMs}ms`)}` : "";
  const head = `${statusText} ${input.kind} ${accent(input.title)}${duration}`;
  if (!input.detail) {
    return head;
  }
  return `${head}\n${muted("detail")}  ${truncate(input.detail, 120)}`;
}

export function renderCliCloseout(input: CliCloseoutInput): string {
  const changed =
    input.changedPaths.length > 0 ? input.changedPaths.join(", ") : "no workspace changes recorded";
  const lines = [
    strong("Closeout"),
    renderRows([
      { label: "session", value: input.sessionId ?? "(none)" },
      { label: "changes", value: changed },
      { label: "validation", value: input.validationSummary?.trim() || "not run" },
    ]),
  ];
  if (input.risks && input.risks.length > 0) {
    lines.push(`risks  ${input.risks.join(" | ")}`);
  }
  if (input.suggestions && input.suggestions.length > 0) {
    lines.push(`next   ${input.suggestions.join(" | ")}`);
  }
  return lines.join("\n");
}

export function renderCliSection(title: string, body: string): string {
  return `${strong(title)}\n${body}`;
}
