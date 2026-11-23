import * as process from "node:process";
import type { CliPanelTone, CliThemeName } from "./types.js";

let CURRENT_THEME: CliThemeName = process.env.AGENT_THEME?.trim() === "plain" ? "plain" : "atlas";

let COLOR_ENABLED =
  !process.env.NO_COLOR && process.env.TERM !== "dumb" && Boolean(process.stdout.isTTY ?? false);

export function color(code: string, value: string): string {
  if (!COLOR_ENABLED || CURRENT_THEME === "plain") {
    return value;
  }
  return `${code}${value}\u001b[0m`;
}

export function accent(value: string): string {
  return color("\u001b[36m", value);
}

export function success(value: string): string {
  return color("\u001b[32m", value);
}

export function warning(value: string): string {
  return color("\u001b[33m", value);
}

export function danger(value: string): string {
  return color("\u001b[31m", value);
}

export function muted(value: string): string {
  return color("\u001b[90m", value);
}

export function strong(value: string): string {
  return color("\u001b[1m", value);
}

export function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(new RegExp("\\u001b\\[[0-9;]*m", "g"), "");
}

export function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

export function truncate(value: string, width = process.stdout.columns ?? 100): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= width) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, width - 3))}...`;
}

export function toneColor(tone: CliPanelTone, value: string): string {
  if (tone === "accent") {
    return accent(value);
  }
  if (tone === "success") {
    return success(value);
  }
  if (tone === "warning") {
    return warning(value);
  }
  if (tone === "danger") {
    return danger(value);
  }
  return strong(value);
}

export function wrapPlainText(value: string, width: number): string[] {
  const normalized = value.replace(/\t/g, "  ").trim();
  if (!normalized) {
    return [""];
  }
  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

export function padVisible(value: string, width: number): string {
  const padding = Math.max(0, width - visibleLength(value));
  return `${value}${" ".repeat(padding)}`;
}

export function renderRows(rows: Array<{ label: string; value: string }>, width?: number): string {
  const labelWidth = Math.max(...rows.map((row) => row.label.length), 0);
  return rows
    .map(
      (row) =>
        `${muted(row.label.padEnd(labelWidth))}  ${truncate(row.value, width ? width - labelWidth - 2 : undefined)}`,
    )
    .join("\n");
}

export function getCliUiTheme(): CliThemeName {
  return CURRENT_THEME;
}

export function setCliUiTheme(theme: CliThemeName): void {
  CURRENT_THEME = theme;
}

export function setCliUiColorEnabled(enabled: boolean): void {
  COLOR_ENABLED = enabled;
}

export function resetCliUiForTest(): void {
  CURRENT_THEME = "atlas";
  COLOR_ENABLED = true;
}

export function renderClearScreen(): string {
  return "\u001b[2J\u001b[H";
}

export function renderCliFooter(segments: string[], width = process.stdout.columns ?? 120): string {
  const content = truncate(segments.join("  |  "), Math.max(24, width - 2));
  return muted(padVisible(content, Math.max(24, width - 2)));
}

export function renderCliPanel(input: {
  title: string;
  lines: string[];
  width: number;
  tone?: CliPanelTone;
  minBodyLines?: number;
}): string[] {
  const width = Math.max(24, input.width);
  const innerWidth = width - 4;
  const title = truncate(input.title, innerWidth);
  const header = `${toneColor(input.tone ?? "neutral", `+ ${title}`)} ${"-".repeat(Math.max(0, width - visibleLength(title) - 4))}+`;
  const wrappedLines = input.lines.flatMap((line) => wrapPlainText(line, innerWidth));
  while (wrappedLines.length < (input.minBodyLines ?? 0)) {
    wrappedLines.push("");
  }
  const body = wrappedLines.map(
    (line) => `| ${padVisible(truncate(line, innerWidth), innerWidth)} |`,
  );
  const footer = `+${"-".repeat(width - 2)}+`;
  return [header, ...body, footer];
}

export function mergeCliColumns(columns: string[][], gap = 2): string[] {
  const heights = columns.map((column) => column.length);
  const widths = columns.map((column) =>
    column.reduce((max, line) => Math.max(max, visibleLength(line)), 0),
  );
  const rows = Math.max(0, ...heights);
  const out: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const parts = columns.map((column, columnIndex) =>
      padVisible(column[row] ?? "", widths[columnIndex] ?? 0),
    );
    out.push(parts.join(" ".repeat(gap)));
  }
  return out;
}
