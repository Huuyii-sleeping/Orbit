import {
  getCliPaletteGroupLabel,
  type CliPaletteCandidate,
  type CliPaletteView,
} from "../palette.js";

export type TerminalTuiShortcutKey = {
  ctrl?: boolean;
  name?: string;
  sequence?: string;
};

export type TerminalTuiShortcut = {
  command: string;
  label: string;
};

export type TerminalTuiPaletteState = {
  open: boolean;
  query: string;
  selectedIndex: number;
  view: CliPaletteView;
};

const EMPTY_TUI_PALETTE_VIEW: CliPaletteView = {
  query: "",
  candidates: [],
  total: 0,
};

export function createTerminalTuiPaletteState(): TerminalTuiPaletteState {
  return {
    open: false,
    query: "",
    selectedIndex: 0,
    view: EMPTY_TUI_PALETTE_VIEW,
  };
}

export function updateTerminalTuiPaletteState(input: {
  state: TerminalTuiPaletteState;
  view: CliPaletteView;
  open?: boolean;
  selectedIndex?: number;
}): TerminalTuiPaletteState {
  const nextOpen = input.open ?? input.state.open;
  const requestedIndex = input.selectedIndex ?? input.state.selectedIndex;
  const maxIndex = Math.max(0, input.view.candidates.length - 1);
  return {
    open: nextOpen,
    query: input.view.query,
    selectedIndex:
      input.view.candidates.length === 0 ? 0 : Math.max(0, Math.min(requestedIndex, maxIndex)),
    view: input.view,
  };
}

export function moveTerminalTuiPaletteSelection(
  state: TerminalTuiPaletteState,
  delta: number,
): TerminalTuiPaletteState {
  if (state.view.candidates.length === 0) {
    return state;
  }
  const maxIndex = state.view.candidates.length - 1;
  const nextIndex =
    (state.selectedIndex + delta + state.view.candidates.length) % state.view.candidates.length;
  return {
    ...state,
    selectedIndex: Math.max(0, Math.min(nextIndex, maxIndex)),
  };
}

export function resolveTerminalTuiPaletteLiveQuery(
  currentLine: string,
  key: TerminalTuiShortcutKey,
): string | null {
  const current = currentLine ?? "";
  if (key.name === "backspace" || key.name === "delete") {
    return current.slice(0, -1);
  }
  if (key.ctrl || !key.sequence || key.sequence.length !== 1) {
    return null;
  }
  if (
    key.name === "return" ||
    key.name === "enter" ||
    key.name === "tab" ||
    key.name === "escape"
  ) {
    return null;
  }
  return `${current}${key.sequence}`;
}

export function getTerminalTuiSelectedPaletteCandidate(
  state: TerminalTuiPaletteState,
): CliPaletteCandidate | null {
  return state.view.candidates[state.selectedIndex] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightTerminalTuiPaletteQuery(value: string, query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return value;
  }
  let next = value;
  for (const token of tokens) {
    next = next.replace(new RegExp(escapeRegExp(token), "gi"), (match) => `<<${match}>>`);
  }
  return next;
}

function renderTerminalTuiPaletteCandidateLine(
  candidate: CliPaletteCandidate,
  index: number,
  selectedIndex: number,
  query: string,
): string {
  const marker = index === selectedIndex ? ">" : " ";
  return `${marker} [${index + 1}] ${highlightTerminalTuiPaletteQuery(candidate.command, query)}  |  ${highlightTerminalTuiPaletteQuery(candidate.title, query)}`;
}

function formatTerminalTuiPaletteFocus(state: TerminalTuiPaletteState): string {
  const selected = getTerminalTuiSelectedPaletteCandidate(state);
  if (!selected) {
    return "(none)";
  }
  return `[${state.selectedIndex + 1}/${state.view.candidates.length}] ${getCliPaletteGroupLabel(selected.group)} ${selected.command}`;
}

export function renderTerminalTuiPaletteLines(
  state: TerminalTuiPaletteState,
  maxEntries = 6,
): string[] {
  const visibleCandidates = state.view.candidates.slice(0, maxEntries);
  const groupedLines: string[] = [];
  let currentGroup: CliPaletteCandidate["group"] | null = null;
  for (const [index, candidate] of visibleCandidates.entries()) {
    if (candidate.group !== currentGroup) {
      if (groupedLines.length > 0) {
        groupedLines.push("");
      }
      currentGroup = candidate.group;
      groupedLines.push(`group     ${getCliPaletteGroupLabel(candidate.group)}`);
    }
    groupedLines.push(
      renderTerminalTuiPaletteCandidateLine(candidate, index, state.selectedIndex, state.query),
    );
  }
  if (state.view.candidates.length > visibleCandidates.length) {
    groupedLines.push(
      "",
      `more      +${state.view.candidates.length - visibleCandidates.length} candidate(s)`,
    );
  }
  return [
    `query     ${state.query || "(top actions)"}`,
    `results   ${state.view.candidates.length} shown / ${state.view.total} total`,
    "keys      Enter open | Up/Down/^N/^P move | Esc close",
    "",
    ...(state.view.candidates.length > 0 ? groupedLines : ["No palette candidates found."]),
  ];
}

export function resolveTerminalTuiShortcut(input: {
  key: TerminalTuiShortcutKey;
  bufferEmpty: boolean;
  composerActive: boolean;
}): TerminalTuiShortcut | null {
  if (!input.bufferEmpty) {
    return null;
  }
  if (input.key.ctrl && input.key.name === "g") {
    return { command: "/help", label: "ctrl+g" };
  }
  if (input.key.ctrl && input.key.name === "k") {
    return { command: "/palette", label: "ctrl+k" };
  }
  if (input.key.ctrl && input.key.name === "n") {
    return { command: "/next", label: "ctrl+n" };
  }
  if (input.key.ctrl && input.key.name === "p") {
    return { command: "/prev", label: "ctrl+p" };
  }
  if (input.key.ctrl && input.key.name === "l") {
    return { command: "/redraw", label: "ctrl+l" };
  }
  if (input.composerActive && input.key.name === "escape") {
    return { command: "/cancel", label: "esc" };
  }
  return null;
}

export function renderTerminalTuiPaletteBarLines(state: TerminalTuiPaletteState): string[] {
  const selected = getTerminalTuiSelectedPaletteCandidate(state);
  return [
    `input     ${state.query || "(top actions)"}`,
    `focus     ${formatTerminalTuiPaletteFocus(state)}`,
    `preview   ${selected ? highlightTerminalTuiPaletteQuery(selected.summary, state.query) : "no candidate selected"}`,
  ];
}
