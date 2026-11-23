import {
  getCliPaletteGroupLabel,
  type CliPaletteCandidate,
  type CliPaletteView,
} from "../palette.js";
import type { CliTranscriptEntry, CliTranscriptView } from "../transcript.js";
import { strong, truncate } from "./theme.js";

function renderPaletteCandidateLine(candidate: CliPaletteCandidate, index: number): string {
  return `[${index + 1}] ${truncate(candidate.title, 52)} -> ${candidate.command}`;
}

function renderGroupedPaletteCandidateLines(
  candidates: CliPaletteCandidate[],
  maxEntries: number,
): string[] {
  const visibleCandidates = candidates.slice(0, maxEntries);
  const lines: string[] = [];
  let currentGroup: CliPaletteCandidate["group"] | null = null;
  for (const [index, candidate] of visibleCandidates.entries()) {
    if (candidate.group !== currentGroup) {
      if (lines.length > 0) {
        lines.push("");
      }
      currentGroup = candidate.group;
      lines.push(`group     ${getCliPaletteGroupLabel(candidate.group)}`);
    }
    lines.push(renderPaletteCandidateLine(candidate, index));
  }
  return lines;
}

export function renderCliPaletteLines(view: CliPaletteView, maxEntries = 8): string[] {
  return [
    `query     ${view.query || "(top actions)"}`,
    `results   ${view.candidates.length} shown / ${view.total} total`,
    "open      /palette open <index>",
    "hints     grouped local actions",
    "",
    ...(view.candidates.length > 0
      ? renderGroupedPaletteCandidateLines(view.candidates, maxEntries)
      : ["No palette candidates found."]),
  ];
}

export function renderCliPalette(view: CliPaletteView): string {
  return [strong("Palette"), ...renderCliPaletteLines(view, 8)].join("\n");
}

function formatTranscriptIndex(index: number): string {
  return `#${String(index).padStart(2, "0")}`;
}

function renderTranscriptEntrySummary(entry: CliTranscriptEntry): string {
  return `[${formatTranscriptIndex(entry.index)}] ${entry.role.padEnd(9)} ${truncate(entry.preview, 88)}`;
}

function renderTranscriptContentLines(entry: CliTranscriptEntry, limit?: number): string[] {
  const lines = entry.content ? entry.content.split("\n") : ["(empty)"];
  const total = lines.length;
  const max = limit && limit > 0 ? Math.min(limit, total) : total;
  const rendered = lines
    .slice(0, max)
    .map((line, index) => `${String(index + 1).padStart(2, "0")}| ${line}`.trimEnd());
  if (max < total) {
    rendered.push(`... ${total - max} more line(s)`);
  }
  return rendered;
}

export function renderCliTranscriptLines(view: CliTranscriptView, maxEntries = 10): string[] {
  if (view.mode === "peek") {
    return [
      `entry     ${formatTranscriptIndex(view.entry.index)} ${view.entry.role} ${view.entry.lineCount} lines / ${view.entry.charCount} chars`,
      `browse    /peek prev | /peek next | /tail | /history`,
      `nav       ${view.hasPrev ? "prev" : "-"} | ${view.hasNext ? "next" : "-"}`,
      `summary   ${truncate(view.entry.preview, 96)}`,
      "",
      ...renderTranscriptContentLines(view.entry, maxEntries),
    ];
  }
  if (view.mode === "search") {
    const matches = view.matches.slice(0, maxEntries);
    return [
      `query     ${view.query}`,
      `matches   ${view.matches.length} / ${view.total}`,
      `focus     ${
        view.selectedEntry
          ? `[${view.selectedIndex + 1}/${view.matches.length}] ${formatTranscriptIndex(view.selectedEntry.index)} ${view.selectedEntry.role}`
          : "(none)"
      }`,
      `browse    /search prev | /search next | /peek <n> | /tail`,
      "",
      ...(matches.length > 0
        ? matches.map(
            (entry, index) =>
              `${index === view.selectedIndex ? ">" : " "} ${renderTranscriptEntrySummary(entry)}`,
          )
        : ["No transcript matches found."]),
      ...(view.matches.length > matches.length
        ? [`... ${view.matches.length - matches.length} more match(es)`]
        : []),
    ];
  }
  return [
    `${view.mode === "tail" ? "tail" : "window"}      ${view.total === 0 ? "0/0" : `${view.start}-${view.end} / ${view.total}`}`,
    `browse    /history first | /history prev | /history next | /history last`,
    `detail    /search <query> | /peek <n> | /tail`,
    "",
    ...(view.entries.length > 0
      ? view.entries.slice(0, maxEntries).map(renderTranscriptEntrySummary)
      : ["No transcript yet. Type a prompt or run /help."]),
  ];
}

export function renderCliTranscript(view: CliTranscriptView): string {
  return [strong("Transcript"), ...renderCliTranscriptLines(view, 12)].join("\n");
}
