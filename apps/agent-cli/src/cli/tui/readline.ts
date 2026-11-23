import { stdin, stdout } from "node:process";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { type AgentAppRuntimeDeps } from "../../bootstrap/app-runtime.js";
import { AgentHost } from "../../host/agent-host.js";
import { completeCliLine } from "../completion.js";
import { CliComposerStore } from "../composer.js";
import { collectCliPermissionSnapshot, collectCliStatusSnapshot } from "../doctor.js";
import { CliPaletteStore, type CliPaletteContext } from "../palette.js";
import { CliTranscriptBrowserStore } from "../transcript.js";
import {
  listCliHelpTopics,
  renderClearScreen,
  renderCliComposerLines,
  renderCliError,
  renderCliGuideLines,
  renderCliPrompt,
  renderCliShortcutLines,
  renderCliTranscriptLines,
} from "../ui.js";
import type { CliWorkflowMode } from "../workflow.js";
import { createTerminalRuntime } from "./runtime.js";

import { handleTerminalTuiCommand } from "./command-handler.js";
import { renderTerminalTuiDashboard, sanitizeActivityText } from "./dashboard.js";
import {
  createTerminalTuiPaletteState,
  getTerminalTuiSelectedPaletteCandidate,
  moveTerminalTuiPaletteSelection,
  renderTerminalTuiPaletteBarLines,
  renderTerminalTuiPaletteLines,
  resolveTerminalTuiPaletteLiveQuery,
  resolveTerminalTuiShortcut,
  updateTerminalTuiPaletteState,
  type TerminalTuiShortcutKey,
} from "./palette.js";
import type { DaemonTuiServiceResolution, TerminalTuiServiceLike } from "./service.js";
export type TerminalTuiOptions = {
  service?: TerminalTuiServiceLike;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  host?: AgentHost;
  app?: AgentAppRuntimeDeps;
  resolveDaemonService?: () => Promise<DaemonTuiServiceResolution | null>;
};

export async function runTerminalTui(opts: TerminalTuiOptions = {}): Promise<void> {
  const runtime = await createTerminalRuntime(opts);
  const currentService = () => runtime.service;
  const attachNotice = runtime.notice;
  const input = opts.input ?? stdin;
  const output = opts.output ?? stdout;
  const composer = new CliComposerStore();
  const paletteStore = new CliPaletteStore();
  const transcriptBrowser = new CliTranscriptBrowserStore();
  let paletteState = createTerminalTuiPaletteState();
  let activeSessionId: string | null = null;
  let currentWorkflow: CliWorkflowMode = "agent";
  let lastOutput = runtime.startupIssue?.message
    ? renderCliError("startup", runtime.startupIssue.message, "use /model <id> to activate the TUI")
    : attachNotice
      ? `${attachNotice}\n\nReady. Use natural language to run the agent, or /help for local controls.`
      : "Ready. Use natural language to run the agent, or /help for local controls.";
  if (attachNotice && runtime.startupIssue?.message) {
    lastOutput = `${attachNotice}\n\n${lastOutput}`;
  }
  let waitingForInput = false;
  let shortcutBusy = false;

  const setModel = runtime.setModel;

  const promptText = () =>
    paletteState.open
      ? `palette:${activeSessionId ? activeSessionId.slice(0, 6) : "shell"} .. `
      : renderCliPrompt(
          activeSessionId,
          {
            active: composer.isActive(activeSessionId),
            lineCount: composer.lineCount(activeSessionId),
            charCount: composer.preview(activeSessionId)?.charCount ?? 0,
          },
          currentWorkflow,
        );

  const buildPaletteContext = async (): Promise<CliPaletteContext> => {
    const permissions = await collectCliPermissionSnapshot();
    return {
      sessions: currentService()
        .listSessions()
        .map((session) => ({
          id: session.id,
          messageCount: session.history.length,
          busy: session.busy,
          active: session.id === activeSessionId,
        })),
      helpTopics: listCliHelpTopics(),
      composerActive: composer.isActive(activeSessionId),
      pendingApprovals: permissions.pendingApprovals,
      workflow: currentWorkflow,
    };
  };

  const syncPaletteState = async (
    query = paletteState.query,
    selectedIndex = paletteState.selectedIndex,
  ) => {
    const view = paletteStore.search(activeSessionId, await buildPaletteContext(), query);
    paletteState = updateTerminalTuiPaletteState({
      state: paletteState,
      view,
      open: true,
      selectedIndex,
    });
  };

  const openPaletteState = async (query = "") => {
    await syncPaletteState(query, 0);
  };

  const closePaletteState = () => {
    paletteState = createTerminalTuiPaletteState();
  };

  const redraw = async (
    preservePrompt = false,
    lineEditor?: { line?: string; write(input: string): void },
  ) => {
    const sessions = currentService().listSessions();
    const activeSessionIndex = Math.max(
      0,
      sessions.findIndex((session) => session.id === activeSessionId),
    );
    const tools = await currentService().toolsMetadata();
    const draftPreview = composer.preview(activeSessionId);
    const activeTranscriptSession =
      sessions.find((session) => session.id === activeSessionId) ?? sessions.at(-1);
    const transcriptView = transcriptBrowser.getView(
      activeSessionId,
      activeTranscriptSession?.history ?? [],
    );
    const status = await collectCliStatusSnapshot({
      mode: `tui/${currentWorkflow}`,
      activeSessionId,
      sessionCount: sessions.length,
      bridgeEndpoint: String(
        (currentService().bridgeManifest().endpoints as { events?: unknown } | undefined)?.events ??
          "/events",
      ),
      toolMetadata: tools,
      model: runtime.model,
    });
    const activityLines = lastOutput
      .split("\n")
      .map((line) => sanitizeActivityText(line))
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 14);

    output.write(
      `${renderClearScreen()}${renderTerminalTuiDashboard({
        model: runtime.model,
        workflow: currentWorkflow,
        activeSessionId,
        composerActive: composer.isActive(activeSessionId),
        composerLineCount: composer.lineCount(activeSessionId),
        composerCharCount: draftPreview?.charCount ?? 0,
        draftLines:
          composer.isActive(activeSessionId) && draftPreview
            ? [
                `summary  ${draftPreview.lineCount} lines / ${draftPreview.charCount} chars`,
                "actions  /preview /send /pop /cancel",
                "",
                ...renderCliComposerLines(draftPreview, 6),
              ]
            : undefined,
        sessionCount: sessions.length,
        toolCount: tools.length,
        bridgeEndpoint: status.bridgeEndpoint,
        sessions: sessions.map((session) => ({
          id: session.id,
          busy: session.busy,
          messageCount: session.history.length,
          active: session.id === activeSessionId,
        })),
        transcriptLines: renderCliTranscriptLines(transcriptView, 12),
        activityLines,
        runtimeLines: [
          `workspace  ${status.workspace}`,
          `model      ${status.model}`,
          `workflow   ${currentWorkflow}`,
          `session    ${status.activeSessionId ?? "(none)"}`,
          `position   ${sessions.length > 0 ? `${activeSessionIndex + 1}/${sessions.length}` : "0/0"}`,
          `draft      ${
            composer.isActive(activeSessionId)
              ? `${composer.lineCount(activeSessionId)} lines / ${draftPreview?.charCount ?? 0} chars`
              : "off"
          }`,
          `palette    ${paletteStore.lastCount(activeSessionId)} cached`,
          `perm       ${status.permissionMode} / ${status.pendingApprovals} pending`,
          `roots      ${status.workspaceRoots.length}`,
          `tools      ${status.toolCount}`,
          `mcp        ${status.mcpToolCount} tools / ${status.mcpServerCount} servers`,
          `hooks      ${status.hookCount}`,
          `usage      ${status.sessionPromptTokens + status.sessionCompletionTokens} session tokens`,
          `bridge     ${status.bridgeEndpoint}`,
          `scheduler  ${status.schedulerStatus}`,
          `theme      ${status.theme}`,
        ],
        guideLines: renderCliGuideLines({
          composerActive: composer.isActive(activeSessionId),
          sessionCount: sessions.length,
          pendingApprovals: status.pendingApprovals,
          startupIssue: Boolean(runtime.startupIssue),
          workflow: currentWorkflow,
        }),
        shortcutLines: renderCliShortcutLines({
          composerActive: composer.isActive(activeSessionId),
        }),
        paletteOpen: paletteState.open,
        paletteBarLines: paletteState.open
          ? renderTerminalTuiPaletteBarLines(paletteState)
          : undefined,
        paletteLines: paletteState.open
          ? renderTerminalTuiPaletteLines(paletteState, 6)
          : undefined,
        footerSegments: [
          `model ${status.model}`,
          `workflow ${currentWorkflow}`,
          `session ${sessions.length > 0 ? `${activeSessionIndex + 1}/${sessions.length}` : "0/0"}`,
          "help /help ^G",
          paletteState.open ? "palette live ^K Esc Enter" : "palette /palette ^K",
          "switch /next /prev /use",
          "browse /history /search /peek /tail",
          "keys ^G ^K ^N ^P ^L Esc",
          `permissions ${status.permissionMode}`,
          composer.isActive(activeSessionId)
            ? `draft ${composer.lineCount(activeSessionId)}l/${draftPreview?.charCount ?? 0}c`
            : "draft off",
          composer.isActive(activeSessionId) ? "preview/send/pop/cancel" : "compose to draft",
          `approvals ${status.pendingApprovals}`,
          `roots ${status.workspaceRoots.length}`,
          `tokens ${status.sessionPromptTokens + status.sessionCompletionTokens}/${status.sessionTokenBudget}`,
          `daily $${status.dailyEstimatedCostUsd.toFixed(status.dailyEstimatedCostUsd >= 1 ? 2 : 4)}`,
        ],
      })}`,
    );
    if (preservePrompt) {
      output.write(promptText());
      const buffered = String(lineEditor?.line ?? "");
      if (buffered) {
        lineEditor?.write(buffered);
      }
    }
  };

  await redraw();

  const rl = createInterface({
    input,
    output,
    completer: (line: string) =>
      completeCliLine(line, {
        sessions: currentService()
          .listSessions()
          .map((session) => ({
            id: session.id,
            messageCount: session.history.length,
            busy: session.busy,
            active: session.id === activeSessionId,
          })),
        helpTopics: listCliHelpTopics(),
        transcriptEntryCount:
          (
            currentService()
              .listSessions()
              .find((session) => session.id === activeSessionId) ??
            currentService().listSessions().at(-1)
          )?.history.length ?? 0,
        paletteEntryCount: paletteStore.lastCount(activeSessionId),
        model: runtime.model,
      }),
  });
  const lineEditor = rl as typeof rl & { line?: string; write(input: string): void };
  const interactiveInput = input as NodeJS.ReadableStream & {
    isTTY?: boolean;
    setRawMode?(enabled: boolean): void;
    on(
      event: "keypress",
      listener: (chunk: string, key: TerminalTuiShortcutKey) => void,
    ): NodeJS.ReadableStream;
    off?(
      event: "keypress",
      listener: (chunk: string, key: TerminalTuiShortcutKey) => void,
    ): NodeJS.ReadableStream;
  };
  let keypressListener: ((chunk: string, key: TerminalTuiShortcutKey) => void) | null = null;
  if (interactiveInput.isTTY && typeof interactiveInput.setRawMode === "function") {
    emitKeypressEvents(interactiveInput, rl);
    interactiveInput.setRawMode(true);
    keypressListener = (_chunk, key) => {
      if (!waitingForInput || shortcutBusy) {
        return;
      }
      if (paletteState.open) {
        if (key.name === "up" || (key.ctrl && key.name === "p")) {
          paletteState = moveTerminalTuiPaletteSelection(paletteState, -1);
          shortcutBusy = true;
          void redraw(true, lineEditor).finally(() => {
            shortcutBusy = false;
          });
          return;
        }
        if (key.name === "down" || (key.ctrl && key.name === "n")) {
          paletteState = moveTerminalTuiPaletteSelection(paletteState, 1);
          shortcutBusy = true;
          void redraw(true, lineEditor).finally(() => {
            shortcutBusy = false;
          });
          return;
        }
        if (key.name === "escape") {
          closePaletteState();
          shortcutBusy = true;
          void redraw(true, lineEditor).finally(() => {
            shortcutBusy = false;
          });
          return;
        }
        const nextQuery = resolveTerminalTuiPaletteLiveQuery(String(lineEditor.line ?? ""), key);
        if (nextQuery !== null) {
          shortcutBusy = true;
          setTimeout(() => {
            void (async () => {
              try {
                await syncPaletteState(nextQuery, 0);
                await redraw(true, lineEditor);
              } finally {
                shortcutBusy = false;
              }
            })();
          }, 0);
          return;
        }
      }
      const shortcut = resolveTerminalTuiShortcut({
        key,
        bufferEmpty: String(lineEditor.line ?? "").length === 0,
        composerActive: composer.isActive(activeSessionId),
      });
      if (!shortcut) {
        return;
      }
      shortcutBusy = true;
      void (async () => {
        try {
          if (shortcut.command === "/palette") {
            if (paletteState.open) {
              closePaletteState();
            } else {
              await openPaletteState();
            }
            await redraw(true, lineEditor);
            return;
          }
          const result = await handleTerminalTuiCommand({
            line: shortcut.command,
            service: currentService(),
            activeSessionId,
            model: runtime.model,
            workflow: currentWorkflow,
            startupIssue: runtime.startupIssue,
            setModel,
            setWorkflow: (nextWorkflow) => {
              currentWorkflow = nextWorkflow;
              return true;
            },
            composer,
            paletteStore,
            transcriptBrowser,
          });
          activeSessionId = result.activeSessionId;
          currentWorkflow = result.workflow;
          if (result.output) {
            lastOutput = result.output;
          }
          await redraw(true, lineEditor);
        } finally {
          shortcutBusy = false;
        }
      })();
    };
    interactiveInput.on("keypress", keypressListener);
  }
  try {
    while (true) {
      waitingForInput = true;
      const line = await rl.question(promptText());
      waitingForInput = false;
      const trimmedLine = line.trim();
      if (paletteState.open && !trimmedLine.startsWith("/")) {
        const selected = getTerminalTuiSelectedPaletteCandidate(paletteState);
        if (!selected) {
          lastOutput = renderCliError("palette empty", "there is no palette candidate to open");
          await redraw();
          continue;
        }
        const result = await handleTerminalTuiCommand({
          line: selected.command,
          service: currentService(),
          activeSessionId,
          model: runtime.model,
          workflow: currentWorkflow,
          startupIssue: runtime.startupIssue,
          setModel,
          setWorkflow: (nextWorkflow) => {
            currentWorkflow = nextWorkflow;
            return true;
          },
          composer,
          paletteStore,
          transcriptBrowser,
        });
        activeSessionId = result.activeSessionId;
        currentWorkflow = result.workflow;
        lastOutput = [
          `palette query '${paletteState.query || "(top actions)"}' [${paletteState.selectedIndex + 1}] -> ${selected.command}`,
          result.output,
        ]
          .filter(Boolean)
          .join("\n");
        closePaletteState();
        if (result.exit) {
          break;
        }
        await redraw();
        continue;
      }
      const result = await handleTerminalTuiCommand({
        line,
        service: currentService(),
        activeSessionId,
        model: runtime.model,
        workflow: currentWorkflow,
        startupIssue: runtime.startupIssue,
        setModel,
        setWorkflow: (nextWorkflow) => {
          currentWorkflow = nextWorkflow;
          return true;
        },
        composer,
        paletteStore,
        transcriptBrowser,
      });
      if (/^\/palette(?:\s|$)/i.test(trimmedLine) && !/^\/palette\s+open\s+/i.test(trimmedLine)) {
        await openPaletteState(trimmedLine.replace(/^\/palette/i, "").trim());
      } else if (trimmedLine && !/^\/palette(?:\s|$)/i.test(trimmedLine)) {
        closePaletteState();
      }
      activeSessionId = result.activeSessionId;
      currentWorkflow = result.workflow;
      if (result.output) {
        lastOutput = result.output;
      }
      if (result.exit) {
        break;
      }
      await redraw();
    }
  } finally {
    waitingForInput = false;
    if (keypressListener && interactiveInput.off) {
      interactiveInput.off("keypress", keypressListener);
    }
    if (interactiveInput.isTTY && typeof interactiveInput.setRawMode === "function") {
      interactiveInput.setRawMode(false);
    }
    rl.close();
  }
}
