import { type CliWorkflowMode } from "../workflow.js";
import { strong } from "./theme.js";
import type { CliHelpTopicId } from "./types.js";

const CLI_HELP_TOPICS = [
  {
    id: "draft",
    title: "Draft",
    summary: "Compose longer prompts locally before they enter the model request path.",
    commands: [
      "/compose    start or resume multi-line draft mode",
      "/preview    inspect the current draft with numbered lines",
      "/pop [n]    remove the latest 1 or N draft line(s)",
      "/send       submit the current draft",
      "/cancel     discard the current draft",
    ],
    examples: ["/compose", "/preview", "/pop 2", "/send"],
  },
  {
    id: "sessions",
    title: "Sessions",
    summary: "Navigate local sessions without memorizing full session ids.",
    commands: [
      "/sessions   list local sessions with index and status",
      "/use <x>    switch by id, prefix, index, or latest",
      "/next       move to the next session",
      "/prev       move to the previous session",
      "/clear      start a fresh session",
      "/new        alias for /clear",
    ],
    examples: ["/sessions", "/use 2", "/use latest", "/next"],
  },
  {
    id: "runtime",
    title: "Runtime",
    summary: "Inspect and control the local runtime surface without asking the model.",
    commands: [
      "/status     show runtime status",
      "/config     show config paths and current theme",
      "/model      show or set model: /model gpt-5-mini",
      "/permissions show or set permission mode",
      "/architecture inspect the local runtime architecture coverage",
      "/data       inspect the local user data governance surface",
      "/features   inspect local feature disclosure and hidden surface status",
      "/mcp        show MCP server status",
      "/mcp reset  clear cached MCP auth failures",
      "/skills     list discovered local skills",
      "/skill <x>  inspect one local skill body",
      "/prompt     dump the current stable system prompt",
      "/cost       show token and cost summary",
      "/compact    总结旧上下文并保留最近对话；原始历史保留",
      "/redraw     clear screen and redraw banner",
    ],
    examples: ["/status", "/features", "/data", "/architecture", "/prompt"],
  },
  {
    id: "features",
    title: "Features",
    summary: "Inspect local feature disclosure, visibility, and reserved hidden surfaces.",
    commands: [
      "/features   list public local surfaces and hidden/reserved feature states",
      "/palette feature find the feature disclosure command",
      "/help runtime includes the same disclosure entry",
    ],
    examples: ["/features", "/palette feature"],
  },
  {
    id: "approvals",
    title: "Approvals",
    summary: "Inspect approval queues and resolve requests from the local control surface.",
    commands: [
      "/approvals  list approval requests",
      "/approve    approve a request: /approve <id>",
      "/reject     reject a request: /reject <id>",
      "/doctor     run local readiness checks",
      "/add-dir    allow another workspace root",
      "/tools      list available tools",
      "/theme      show or set theme: /theme atlas|plain",
      "!<cmd>      run a direct shell command",
      "/exit       leave the shell",
    ],
    examples: ["/approvals", "/approve apr_1", "/doctor", "!pnpm test"],
  },
  {
    id: "transcript",
    title: "Transcript",
    summary: "Browse, search, and expand the local session transcript without leaving the shell.",
    commands: [
      "/history    browse the current transcript window",
      "/history prev move to the previous transcript page",
      "/history next move to the next transcript page",
      "/history first jump to the first transcript page",
      "/history last jump to the latest transcript page",
      "/search <q> search the current transcript",
      "/search next move to the next search match",
      "/search prev move to the previous search match",
      "/peek <n>   expand one transcript entry",
      "/peek next  expand the next transcript entry",
      "/peek prev  expand the previous transcript entry",
      "/tail       return to the live tail view",
    ],
    examples: ["/history last", "/search bug", "/search next", "/peek 12", "/peek next", "/tail"],
  },
  {
    id: "workflow",
    title: "Workflow",
    summary:
      "Switch the local CLI/TUI surface between general agent work and draw-oriented brief work.",
    commands: [
      "/workflow       show the active local workflow",
      "/workflow agent switch to the general agent workflow surface",
      "/workflow draw  switch to the draw-oriented workflow surface",
      "/palette draw   open workflow-related local launcher actions",
    ],
    examples: ["/workflow", "/workflow draw", "/workflow agent", "/palette workflow"],
  },
  {
    id: "palette",
    title: "Palette",
    summary: "Launch high-frequency local actions from one fuzzy-searchable control surface.",
    commands: [
      "/palette       show top local action candidates",
      "/palette <q>   fuzzy-search local action candidates",
      "/palette open <n> execute one palette result by index",
      "Ctrl+K         open the local command palette in TUI",
    ],
    examples: ["/palette", "/palette review", "/palette open 2"],
  },
] as const satisfies ReadonlyArray<{
  id: Exclude<CliHelpTopicId, "overview" | "all">;
  title: string;
  summary: string;
  commands: readonly string[];
  examples: readonly string[];
}>;

export function listCliHelpTopics(): Array<Exclude<CliHelpTopicId, "overview">> {
  return [...CLI_HELP_TOPICS.map((topic) => topic.id), "all"];
}

export function resolveCliHelpTopic(input?: string | null): CliHelpTopicId | null {
  const normalized = input?.trim().toLowerCase();
  if (!normalized) {
    return "overview";
  }
  if (normalized === "all") {
    return "all";
  }
  return (
    (CLI_HELP_TOPICS.find((topic) => topic.id === normalized)?.id as CliHelpTopicId | undefined) ??
    null
  );
}

function renderCliHelpTopic(topicId: Exclude<CliHelpTopicId, "overview" | "all">): string {
  const topic = CLI_HELP_TOPICS.find((entry) => entry.id === topicId);
  if (!topic) {
    return "";
  }
  return [
    strong(`Help: ${topic.title}`),
    topic.summary,
    "",
    strong("Commands"),
    ...topic.commands,
    "",
    strong("Examples"),
    ...topic.examples.map((example) => `- ${example}`),
  ].join("\n");
}

export function renderCliGuideLines(input: {
  composerActive: boolean;
  sessionCount: number;
  pendingApprovals: number;
  startupIssue?: boolean;
  workflow?: CliWorkflowMode;
}): string[] {
  const workflow = input.workflow ?? "agent";
  if (input.composerActive) {
    const composeLabel = workflow === "draw" ? "brief" : "draft";
    return [
      "help      /help draft or Ctrl+G",
      workflow === "draw"
        ? "workflow  /workflow agent | /workflow draw"
        : "palette   /palette or Ctrl+K launches local actions",
      `${composeLabel.padEnd(9)} plain text appends to the current ${composeLabel}`,
      "review    /preview shows numbered draft lines",
      "edit      /pop or /pop 3 removes recent lines",
      "send      /send submits the current draft",
      "cancel    Esc or /cancel discards the draft",
      "browse    /history /search <q> /search next /peek <n>",
      "session   /next /prev keeps local navigation nearby",
    ];
  }
  if (workflow === "draw") {
    return [
      "workflow  /workflow agent | /workflow draw",
      "palette   /palette draw /palette workflow",
      "brief     /compose starts a multi-line draw brief",
      "review    /preview inspects numbered brief lines",
      "browse    /history last /search bug /peek 12 /tail",
      "runtime   /status /model /permissions /architecture /skills /prompt /data /features",
      input.pendingApprovals > 0
        ? "approvals /approvals /approve <id> /reject <id>"
        : "workspace /doctor /add-dir /theme",
      "shell     !<cmd> runs a direct shell command",
    ];
  }
  return [
    "help      /help /help sessions /help palette",
    "workflow  /workflow agent | /workflow draw",
    "palette   /palette review /palette open 2",
    input.sessionCount > 0
      ? "session   /sessions /use 2 /next /prev"
      : "session   /clear creates the first local session",
    "browse    /history last /search bug /peek 12 /tail",
    input.startupIssue
      ? "startup   /model <id> reactivates local chat"
      : "runtime   /status /model /permissions /architecture /skills /prompt /data",
    input.pendingApprovals > 0
      ? "approvals /approvals /approve <id> /reject <id>"
      : "workspace /doctor /add-dir /theme",
    "compose   /compose starts a multi-line draft",
    "shell     !<cmd> runs a direct shell command",
  ];
}

export function renderCliShortcutLines(input: { composerActive: boolean }): string[] {
  return [
    "ctrl+g    help",
    "ctrl+k    palette",
    "ctrl+n    next session",
    "ctrl+p    previous session",
    "ctrl+l    redraw screen",
    input.composerActive ? "esc       cancel draft" : "esc       draft cancel only",
  ];
}

export function renderCliHelp(topic: CliHelpTopicId = "overview"): string {
  if (topic === "all") {
    return [
      renderCliHelp("overview"),
      "",
      ...CLI_HELP_TOPICS.map((entry) => renderCliHelp(entry.id)),
    ].join("\n\n");
  }
  if (topic !== "overview") {
    return renderCliHelpTopic(topic);
  }
  return [
    strong("Commands"),
    "topics     /help draft | /help sessions | /help runtime | /help features | /help approvals | /help transcript | /help workflow | /help palette | /help all",
    "palette    /palette /palette <query> /palette open <index>",
    "draft      /compose /preview /pop /send /cancel",
    "sessions   /sessions /use /next /prev /clear",
    "workflow   /workflow agent | /workflow draw",
    "browse     /history /search /peek /tail",
    "runtime    /status /config /model /permissions /architecture /skills /skill /prompt /mcp /data /features /cost /compact /redraw",
    "approvals  /approvals /approve /reject /doctor /add-dir /tools /theme",
    "shell      !<cmd> | /exit",
    "TUI keys    Ctrl+G help | Ctrl+K palette | Ctrl+N next | Ctrl+P prev | Ctrl+L redraw | Esc cancel draft",
    "",
    strong("Examples"),
    "- /help draft",
    "- /palette review",
    "- /help sessions",
    "- /search hook blocked",
    "- /data",
    "- /features",
    "- /architecture",
    "- /model gpt-5-mini",
    "- /permissions plan",
  ].join("\n");
}
