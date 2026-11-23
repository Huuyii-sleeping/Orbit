import { getStaticPromptSource } from "../../config/config.js";
import { exportProtectedPromptDump, inspectPromptSource } from "../../prompt/inspect.js";
import { addWorkspaceRoot } from "../../security/workspace-roots.js";
import { getSkillCatalog, loadSkill } from "../../skills/loader.js";
import { getMcpRegistryStatus, resetMcpRegistryAuthFailures } from "../../tools/mcp/mcp.js";
import { dispatchCliCommand } from "../commands.js";
import { CliComposerStore } from "../composer.js";
import {
  collectCliConfigSnapshot,
  collectCliPermissionSnapshot,
  collectCliStatusSnapshot,
  collectCliUsageSnapshot,
  runCliDoctor,
} from "../doctor.js";
import { CliPaletteStore } from "../palette.js";
import { setCliPermissionMode } from "../permissions.js";
import { runCliShellShortcut } from "../shell.js";
import { CliTranscriptBrowserStore } from "../transcript.js";
import {
  getCliUiTheme,
  listCliHelpTopics,
  renderCliError,
  renderCliSection,
  setCliUiTheme,
} from "../ui.js";
import type { CliWorkflowMode } from "../workflow.js";

import type { TerminalTuiServiceLike } from "./service.js";
function getToolRunner(
  service: TerminalTuiServiceLike,
): ((name: string, argumentsJson: string) => Promise<string>) | null {
  return (
    service.runToolByName?.bind(service) ??
    (
      service as {
        toolService?: { runToolByName(name: string, argumentsJson: string): Promise<string> };
      }
    ).toolService?.runToolByName?.bind(
      (
        service as {
          toolService?: { runToolByName(name: string, argumentsJson: string): Promise<string> };
        }
      ).toolService,
    ) ??
    null
  );
}

async function captureConsoleOutput<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; logs: string[] }> {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };
  try {
    return { result: await fn(), logs };
  } finally {
    console.log = originalLog;
  }
}

export async function handleTerminalTuiCommand(input: {
  line: string;
  service: TerminalTuiServiceLike;
  activeSessionId: string | null;
  model: string;
  workflow?: CliWorkflowMode;
  startupIssue?: Error | null;
  setModel(model: string): Promise<boolean>;
  setWorkflow?(mode: CliWorkflowMode): boolean;
  composer: CliComposerStore;
  transcriptBrowser?: CliTranscriptBrowserStore;
  paletteStore?: CliPaletteStore;
}): Promise<{
  activeSessionId: string | null;
  workflow: CliWorkflowMode;
  output: string;
  exit: boolean;
  clearScreen?: boolean;
  showBanner?: boolean;
}> {
  const transcriptBrowser = input.transcriptBrowser ?? new CliTranscriptBrowserStore();
  const paletteStore = input.paletteStore ?? new CliPaletteStore();
  const toolRunner = getToolRunner(input.service);
  let workflow = input.workflow ?? "agent";
  const listSessionSummaries = () =>
    input.service.listSessions().map((session) => ({
      id: session.id,
      messageCount: session.history.length,
      busy: session.busy,
      active: session.id === input.activeSessionId,
    }));
  let command: Awaited<ReturnType<typeof dispatchCliCommand>>;
  try {
    command = await dispatchCliCommand(input.line, {
      activeSessionId: input.activeSessionId,
      createSession: async () => input.service.createSession(),
      listSessions: listSessionSummaries,
      useSession: (sessionId) =>
        input.service.listSessions().some((session) => session.id === sessionId),
      listTools: async () => input.service.toolsMetadata(),
      getStatus: async () =>
        collectCliStatusSnapshot({
          mode: `tui/${workflow}`,
          activeSessionId: input.activeSessionId,
          sessionCount: input.service.listSessions().length,
          bridgeEndpoint: String(
            (input.service.bridgeManifest().endpoints as { events?: unknown } | undefined)
              ?.events ?? "/events",
          ),
          toolMetadata: await input.service.toolsMetadata(),
          model: input.model,
        }),
      getConfig: () => collectCliConfigSnapshot({ model: input.model }),
      getMcpStatus: getMcpRegistryStatus,
      resetMcpAuthFailures: resetMcpRegistryAuthFailures,
      getPermissions: collectCliPermissionSnapshot,
      setPermissionMode: (mode) => {
        setCliPermissionMode(mode);
        return true;
      },
      listApprovals: async (status) => {
        if (!toolRunner) {
          return JSON.stringify({
            ok: false,
            error: { message: "security tools are not available for this TUI service" },
          });
        }
        return toolRunner("security_list_approvals", JSON.stringify(status ? { status } : {}));
      },
      approveRequest: async (requestId) => {
        if (!toolRunner) {
          return JSON.stringify({
            ok: false,
            error: { message: "security tools are not available for this TUI service" },
          });
        }
        return toolRunner("security_approve", JSON.stringify({ request_id: requestId }));
      },
      rejectRequest: async (requestId) => {
        if (!toolRunner) {
          return JSON.stringify({
            ok: false,
            error: { message: "security tools are not available for this TUI service" },
          });
        }
        return toolRunner("security_reject", JSON.stringify({ request_id: requestId }));
      },
      listSkills: async () => {
        const catalog = getSkillCatalog();
        return {
          skills: catalog.available,
          loadedNames: catalog.loadedNames,
          missingNames: catalog.missingNames,
        };
      },
      getSkill: async (name) => {
        const skill = loadSkill(name);
        if (!skill) {
          return null;
        }
        const catalog = getSkillCatalog();
        return {
          name: skill.name,
          description: skill.description,
          path: skill.path,
          root: skill.root,
          metadata: skill.metadata,
          allowedTools: skill.allowedTools,
          model: skill.model,
          pathPatterns: skill.pathPatterns,
          sourceType: skill.sourceType,
          containsShellCommands: skill.containsShellCommands,
          canRunShell: skill.canRunShell,
          content: skill.content,
          loaded: catalog.loadedNames.some(
            (loadedName) => loadedName.toLowerCase() === skill.name.toLowerCase(),
          ),
        };
      },
      dumpSystemPrompt: async (mode = "default") => {
        const catalog = getSkillCatalog();
        return {
          dump:
            mode === "protected"
              ? await exportProtectedPromptDump(getStaticPromptSource())
              : inspectPromptSource(getStaticPromptSource(), mode),
          loadedNames: catalog.loadedNames,
          missingNames: catalog.missingNames,
        };
      },
      getUsage: () => collectCliUsageSnapshot(input.model),
      canCompactSession: () => Boolean(input.service.compactSession),
      compactSession: async (keepRecent) => {
        if (!input.service.compactSession) throw new Error("当前服务不支持上下文压缩。");
        if (!input.activeSessionId) throw new Error("请先开始对话或使用 /new 创建会话。");
        return input.service.compactSession(input.activeSessionId, keepRecent);
      },
      isComposing: () => input.composer.isActive(input.activeSessionId),
      getComposeLineCount: () => input.composer.lineCount(input.activeSessionId),
      getComposeCharCount: () => input.composer.preview(input.activeSessionId)?.charCount ?? 0,
      startCompose: () => input.composer.start(input.activeSessionId),
      appendComposeLine: (line) => input.composer.append(input.activeSessionId, line),
      previewCompose: () => input.composer.preview(input.activeSessionId),
      popCompose: (count) => input.composer.pop(input.activeSessionId, count),
      sendCompose: () => input.composer.consume(input.activeSessionId),
      cancelCompose: () => input.composer.cancel(input.activeSessionId),
      getModel: () => input.model,
      setModel: input.setModel,
      addWorkspaceRoot,
      runDoctor: runCliDoctor,
      getTheme: () => getCliUiTheme(),
      setTheme: (theme) => {
        setCliUiTheme(theme);
        return true;
      },
      getWorkflow: () => workflow,
      setWorkflow: (nextWorkflow) => {
        workflow = nextWorkflow;
        return input.setWorkflow ? input.setWorkflow(nextWorkflow) : true;
      },
      showPalette: async (query = "") =>
        paletteStore.search(
          input.activeSessionId,
          {
            sessions: listSessionSummaries(),
            helpTopics: listCliHelpTopics(),
            composerActive: input.composer.isActive(input.activeSessionId),
            pendingApprovals: (await collectCliPermissionSnapshot()).pendingApprovals,
            workflow,
          },
          query,
        ),
      openPalette: (index) => paletteStore.open(input.activeSessionId, index),
      showTranscript: (direction = "current") => {
        const session =
          input.service.listSessions().find((item) => item.id === input.activeSessionId) ??
          input.service.listSessions().at(-1);
        return transcriptBrowser.history(input.activeSessionId, session?.history ?? [], direction);
      },
      searchTranscript: (query) => {
        const session =
          input.service.listSessions().find((item) => item.id === input.activeSessionId) ??
          input.service.listSessions().at(-1);
        return transcriptBrowser.search(input.activeSessionId, session?.history ?? [], query);
      },
      moveTranscriptSearch: (direction) => {
        const session =
          input.service.listSessions().find((item) => item.id === input.activeSessionId) ??
          input.service.listSessions().at(-1);
        return transcriptBrowser.moveSearch(
          input.activeSessionId,
          session?.history ?? [],
          direction,
        );
      },
      peekTranscript: (entryIndex) => {
        const session =
          input.service.listSessions().find((item) => item.id === input.activeSessionId) ??
          input.service.listSessions().at(-1);
        return transcriptBrowser.peek(input.activeSessionId, session?.history ?? [], entryIndex);
      },
      moveTranscriptPeek: (direction) => {
        const session =
          input.service.listSessions().find((item) => item.id === input.activeSessionId) ??
          input.service.listSessions().at(-1);
        return transcriptBrowser.peekRelative(
          input.activeSessionId,
          session?.history ?? [],
          direction,
        );
      },
      tailTranscript: () => {
        const session =
          input.service.listSessions().find((item) => item.id === input.activeSessionId) ??
          input.service.listSessions().at(-1);
        return transcriptBrowser.tail(input.activeSessionId, session?.history ?? []);
      },
    });
  } catch (error) {
    return {
      activeSessionId: input.activeSessionId,
      workflow,
      output: renderCliError(
        "command failed",
        error instanceof Error ? error.message : String(error),
      ),
      exit: false,
    };
  }
  if (command.handled) {
    if (!command.submitPrompt) {
      return {
        activeSessionId: command.nextSessionId ?? input.activeSessionId,
        workflow,
        output: command.output,
        exit: Boolean(command.exit),
        clearScreen: command.clearScreen,
        showBanner: command.showBanner,
      };
    }
    const nextSessionId = command.nextSessionId ?? input.activeSessionId;
    const prompt = command.submitPrompt;
    const prefixOutput = command.output ? [command.output] : [];
    if (input.startupIssue) {
      return {
        activeSessionId: nextSessionId,
        workflow,
        output: [
          ...prefixOutput,
          renderCliError(
            "model not ready",
            input.startupIssue.message,
            "set /model <id> before sending prompts",
          ),
        ].join("\n"),
        exit: false,
        clearScreen: command.clearScreen,
        showBanner: command.showBanner,
      };
    }
    let sessionResult;
    try {
      sessionResult = await captureConsoleOutput(() =>
        input.service.chat({
          session_id: nextSessionId ?? undefined,
          message: prompt,
        }),
      );
    } catch (error) {
      return {
        activeSessionId: nextSessionId,
        workflow,
        output: [
          ...prefixOutput,
          renderCliError("chat failed", error instanceof Error ? error.message : String(error)),
        ].join("\n"),
        exit: false,
        clearScreen: command.clearScreen,
        showBanner: command.showBanner,
      };
    }
    const session = sessionResult.result.session as { id?: unknown } | undefined;
    const resolvedSessionId = typeof session?.id === "string" ? session.id : nextSessionId;
    if (sessionResult.result.ok === false) {
      const error = sessionResult.result.error as { message?: unknown } | undefined;
      return {
        activeSessionId: resolvedSessionId,
        workflow,
        output: [
          ...prefixOutput,
          renderCliError("chat failed", String(error?.message ?? "chat failed")),
          ...sessionResult.logs,
        ].join("\n"),
        exit: false,
        clearScreen: command.clearScreen,
        showBanner: command.showBanner,
      };
    }
    return {
      activeSessionId: resolvedSessionId,
      workflow,
      output: [
        ...prefixOutput,
        ...sessionResult.logs,
        renderCliSection("Assistant", String(sessionResult.result.assistant ?? "")),
      ]
        .filter(Boolean)
        .join("\n"),
      exit: false,
      clearScreen: command.clearScreen,
      showBanner: command.showBanner,
    };
  }

  const line = input.line.trim();
  if (!line) {
    return { activeSessionId: input.activeSessionId, workflow, output: "", exit: false };
  }

  if (line.startsWith("!")) {
    if (!toolRunner) {
      return {
        activeSessionId: input.activeSessionId,
        workflow,
        output: renderCliError(
          "shell unavailable",
          "direct shell mode is not available for this TUI service",
        ),
        exit: false,
      };
    }
    try {
      return {
        activeSessionId: input.activeSessionId,
        workflow,
        output: await runCliShellShortcut(line.slice(1), toolRunner),
        exit: false,
      };
    } catch (error) {
      return {
        activeSessionId: input.activeSessionId,
        workflow,
        output: renderCliError(
          "shell failed",
          error instanceof Error ? error.message : String(error),
        ),
        exit: false,
      };
    }
  }

  if (input.startupIssue) {
    return {
      activeSessionId: input.activeSessionId,
      workflow,
      output: renderCliError(
        "model not ready",
        input.startupIssue.message,
        "set /model <id> before sending prompts",
      ),
      exit: false,
    };
  }

  let captured;
  try {
    captured = await captureConsoleOutput(() =>
      input.service.chat({
        session_id: input.activeSessionId ?? undefined,
        message: line,
      }),
    );
  } catch (error) {
    return {
      activeSessionId: input.activeSessionId,
      workflow,
      output: renderCliError("chat failed", error instanceof Error ? error.message : String(error)),
      exit: false,
    };
  }
  const { result, logs } = captured;
  const session = result.session as { id?: unknown } | undefined;
  const nextSessionId = typeof session?.id === "string" ? session.id : input.activeSessionId;
  if (result.ok === false) {
    const error = result.error as { message?: unknown } | undefined;
    return {
      activeSessionId: nextSessionId,
      workflow,
      output: [
        renderCliError("chat failed", String(error?.message ?? "chat failed")),
        ...logs,
      ].join("\n"),
      exit: false,
    };
  }
  return {
    activeSessionId: nextSessionId,
    workflow,
    output: [...logs, renderCliSection("Assistant", String(result.assistant ?? ""))]
      .filter(Boolean)
      .join("\n"),
    exit: false,
  };
}
