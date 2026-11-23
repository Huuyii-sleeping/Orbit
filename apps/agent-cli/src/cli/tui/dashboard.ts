import * as process from "node:process";
import {
  mergeCliColumns,
  renderCliBadge,
  renderCliBanner,
  renderCliFooter,
  renderCliPanel,
} from "../ui.js";
import type { CliWorkflowMode } from "../workflow.js";

export type TerminalTuiState = {
  model: string;
  workflow?: CliWorkflowMode;
  activeSessionId: string | null;
  composerActive?: boolean;
  composerLineCount?: number;
  composerCharCount?: number;
  draftLines?: string[];
  sessionCount: number;
  toolCount: number;
  bridgeEndpoint: string;
  sessions?: Array<{ id: string; busy: boolean; messageCount: number; active: boolean }>;
  transcriptLines?: string[];
  activityLines?: string[];
  runtimeLines?: string[];
  guideLines?: string[];
  shortcutLines?: string[];
  footerSegments?: string[];
  paletteOpen?: boolean;
  paletteBarLines?: string[];
  paletteLines?: string[];
};

function formatSessionLine(
  session: { id: string; busy: boolean; messageCount: number; active: boolean },
  index: number,
): string {
  const marker = session.active ? "*" : " ";
  const status = session.busy ? "busy" : "idle";
  return `${marker} [${index + 1}] ${session.id.slice(0, 10)} ${status} ${session.messageCount} msg`;
}

export function sanitizeActivityText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(new RegExp("\\u001b\\[[0-9;]*m", "g"), "");
}

function visibleLength(value: string): number {
  // eslint-disable-next-line no-control-regex
  return value.replace(new RegExp("\\u001b\\[[0-9;]*m", "g"), "").length;
}

function centerTerminalTuiBlock(lines: string[], width: number): string[] {
  return lines.map((line) => {
    const padding = Math.max(0, Math.floor((width - visibleLength(line)) / 2));
    return `${" ".repeat(padding)}${line}`;
  });
}

export function renderTerminalTuiDashboard(state: TerminalTuiState): string {
  const width = Math.max(96, process.stdout.columns ?? 120);
  const gap = 2;
  const leftWidth = 30;
  const rightWidth = 30;
  const mainWidth = Math.max(34, width - leftWidth - rightWidth - gap * 2);
  const header = renderCliBanner({
    title: "Agent CLI",
    workspace: process.cwd().split("/").filter(Boolean).pop() ?? process.cwd(),
    mode: state.workflow ? `tui/${state.workflow}` : "tui",
    model: state.model,
    sessionId: state.activeSessionId,
    commands: ["/help", "/workflow", "/palette", "^G", "^K", "/next", "/compose", "/status"],
  });
  const leftColumn = [
    ...renderCliPanel({
      title: "Sessions",
      width: leftWidth,
      tone: "accent",
      minBodyLines: 10,
      lines:
        state.sessions && state.sessions.length > 0
          ? [
              ...state.sessions.map((session, index) => formatSessionLine(session, index)),
              "",
              "/use 2  /next  /prev",
            ]
          : ["No sessions yet.", "", "/clear to create one"],
    }),
    "",
    ...renderCliPanel({
      title: "Guide",
      width: leftWidth,
      tone: "neutral",
      minBodyLines: 8,
      lines: state.guideLines ?? ["help      /help /help draft /help sessions"],
    }),
    "",
    ...renderCliPanel({
      title: "Shortcuts",
      width: leftWidth,
      tone: "accent",
      minBodyLines: 5,
      lines: state.shortcutLines ?? [
        "ctrl+g    help",
        "ctrl+k    palette",
        "ctrl+n    next session",
        "ctrl+p    previous session",
      ],
    }),
  ];
  const centerColumn = [
    ...renderCliPanel({
      title: "Conversation",
      width: mainWidth,
      tone: "neutral",
      minBodyLines: 18,
      lines: state.transcriptLines ?? ["No transcript yet."],
    }),
  ];
  const draftPanel = state.composerActive
    ? [
        "",
        ...renderCliPanel({
          title: "Draft",
          width: rightWidth,
          tone: "accent",
          minBodyLines: 8,
          lines:
            state.draftLines && state.draftLines.length > 0
              ? state.draftLines
              : [
                  `draft ${state.composerLineCount ?? 0} lines / ${state.composerCharCount ?? 0} chars`,
                  "Use plain input to append.",
                  "/preview /send /pop /cancel",
                ],
        }),
      ]
    : [];
  const rightColumn = [
    ...renderCliPanel({
      title: "Runtime",
      width: rightWidth,
      tone: "success",
      minBodyLines: 10,
      lines: state.runtimeLines ?? [
        `session count ${state.sessionCount}`,
        `tool count ${state.toolCount}`,
        `bridge ${state.bridgeEndpoint}`,
      ],
    }),
    ...draftPanel,
    "",
    ...renderCliPanel({
      title: "Activity",
      width: rightWidth,
      tone: "warning",
      minBodyLines: state.composerActive ? 10 : 17,
      lines: state.activityLines ?? [
        "Ready.",
        "Use natural language, or start /compose for drafts.",
      ],
    }),
  ];
  const board = mergeCliColumns([leftColumn, centerColumn, rightColumn], gap).join("\n");
  const paletteOverlayWidth = Math.max(48, Math.min(80, width - 16));
  const paletteBar = state.paletteOpen
    ? centerTerminalTuiBlock(
        renderCliPanel({
          title: "Command Bar",
          width: paletteOverlayWidth,
          tone: "accent",
          minBodyLines: 3,
          lines: state.paletteBarLines ?? ["input     (top actions)"],
        }),
        width,
      )
    : [];
  const paletteOverlay = state.paletteOpen
    ? centerTerminalTuiBlock(
        renderCliPanel({
          title: "Palette Results",
          width: paletteOverlayWidth,
          tone: "accent",
          minBodyLines: 6,
          lines: state.paletteLines ?? ["No palette candidates found."],
        }),
        width,
      )
    : [];
  return [
    header,
    `${renderCliBadge("full-screen", "accent")} ${renderCliBadge("tui", "success")} ${renderCliBadge(state.activeSessionId ? "session-live" : "session-empty", "warning")}${state.paletteOpen ? ` ${renderCliBadge("palette-live", "accent")}` : ""}`,
    "",
    ...paletteBar,
    ...paletteOverlay,
    ...(paletteOverlay.length > 0 ? [""] : []),
    board,
    "",
    renderCliFooter(
      state.footerSegments ?? [
        `model ${state.model}`,
        `sessions ${state.sessionCount}`,
        `tools ${state.toolCount}`,
      ],
      width,
    ),
    "",
  ].join("\n");
}
