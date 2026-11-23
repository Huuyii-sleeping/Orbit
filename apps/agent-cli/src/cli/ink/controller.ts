import { type AgentAppRuntimeDeps } from "../../bootstrap/app-runtime.js";
import {
  DEFAULT_RUNTIME_COORDINATION_SERVICE,
  type RuntimeCoordinationServiceLike,
} from "../../services/runtime-coordination-service.js";
import { createPreviewResponse, type InkTuiPreviewMessage } from "../../terminal-ui/ink-tui.js";
import { CliComposerStore } from "../composer.js";
import { CliPaletteStore } from "../palette.js";
import { CliTranscriptBrowserStore } from "../transcript.js";
import { handleTerminalTuiCommand } from "../tui/command-handler.js";
import type { CliWorkflowMode } from "../workflow.js";

import type { TerminalTuiServiceLike } from "../tui/service.js";
function outputToMessage(line: string, output: string): InkTuiPreviewMessage {
  return {
    role: line.startsWith("/") || line.startsWith("!") ? "tool" : "assistant",
    marker: line.startsWith("/") || line.startsWith("!") ? "$" : "*",
    text: output.trim() || `handled ${line}`,
    tone: line.startsWith("/") || line.startsWith("!") ? "accent" : "assistant",
  };
}

function asyncEventToMessage(label: string, content: string): InkTuiPreviewMessage {
  return {
    role: "system",
    marker: "$",
    text: `${label}\n${content}`.trim(),
    tone: label.includes("error") ? "muted" : "accent",
  };
}

export function createInkRuntimeController(input: {
  service: TerminalTuiServiceLike;
  app?: AgentAppRuntimeDeps | null;
  startupIssue: Error | null;
  runtimeCoordinationService?: RuntimeCoordinationServiceLike;
  model?: string;
  setModel?(model: string): Promise<boolean>;
}) {
  const composer = new CliComposerStore();
  const paletteStore = new CliPaletteStore();
  const transcriptBrowser = new CliTranscriptBrowserStore();
  let activeSessionId: string | null = null;
  let workflow: CliWorkflowMode = "agent";
  let currentModel = input.model ?? "daemon-host";
  let agentBusy = false;

  const submit = async (
    line: string,
  ): Promise<{ messages: InkTuiPreviewMessage[]; exit: boolean }> => {
    if (agentBusy) {
      return {
        exit: false,
        messages: [asyncEventToMessage("busy", "Agent is already running another request.")],
      };
    }
    agentBusy = true;
    const result = await handleTerminalTuiCommand({
      line,
      service: input.service,
      activeSessionId,
      model: currentModel,
      workflow,
      startupIssue: input.startupIssue,
      setModel: async (model) => {
        const changed = (await input.setModel?.(model)) ?? false;
        if (changed) currentModel = model;
        return changed;
      },
      setWorkflow: (nextWorkflow) => {
        workflow = nextWorkflow;
        return true;
      },
      composer,
      paletteStore,
      transcriptBrowser,
    }).finally(() => {
      agentBusy = false;
    });
    activeSessionId = result.activeSessionId;
    workflow = result.workflow;
    return {
      exit: result.exit,
      messages: result.output.trim()
        ? [outputToMessage(line, result.output)]
        : [createPreviewResponse(line)],
    };
  };

  const runScheduledTick = async (): Promise<InkTuiPreviewMessage[]> => {
    if (input.startupIssue || agentBusy) {
      return [];
    }
    // 在第一个 await 前占用执行权，远程检查和会话创建也属于同一次调度。
    agentBusy = true;
    const messages: InkTuiPreviewMessage[] = [];
    try {
      const coordination =
        input.runtimeCoordinationService ??
        input.app?.runtimeCoordinationService ??
        DEFAULT_RUNTIME_COORDINATION_SERVICE;
      await coordination.tickScheduler();
      const dueCount = await coordination.peekScheduledPromptCount();
      if (dueCount === 0) return [];
      const sessions = input.service.listSessions();
      let sessionId = activeSessionId ?? sessions.at(-1)?.id ?? null;
      if (!sessionId) sessionId = (await input.service.createSession()).id;
      activeSessionId = sessionId;
      messages.push(
        asyncEventToMessage(
          "scheduled due",
          `${dueCount} scheduled prompt${dueCount === 1 ? "" : "s"} due now.`,
        ),
      );
      const result = await input.service.chat({
        session_id: sessionId,
        message: "Handle any scheduled prompts that are due now.",
        include_scheduled_notifications: true,
      });
      const session = result.session as { id?: unknown } | undefined;
      if (typeof session?.id === "string") activeSessionId = session.id;
      if (result.ok === false) {
        const error = result.error as { message?: unknown } | undefined;
        messages.push(
          asyncEventToMessage("scheduled error", String(error?.message ?? "chat failed")),
        );
      } else {
        const assistant = String(result.assistant ?? "").trim();
        messages.push(
          asyncEventToMessage(
            "scheduled",
            assistant || "Scheduled prompt processed without a text reply.",
          ),
        );
      }
      return messages;
    } catch (error) {
      messages.push(
        asyncEventToMessage(
          "scheduled error",
          error instanceof Error ? error.message : String(error),
        ),
      );
      return messages;
    } finally {
      agentBusy = false;
    }
  };

  return { submit, runScheduledTick };
}
