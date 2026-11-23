import { handleApprovalCommand, maybeHandleApprovalShortcut } from "./commands/approvals.js";
import { handleComposerCommand } from "./commands/composer.js";
import type { CliCommandContext, CliCommandResult } from "./commands/context.js";
import { handleNavigationCommand } from "./commands/navigation.js";
import { handleRuntimeCommand } from "./commands/runtime.js";
import { handleSessionCommand } from "./commands/session.js";
import { renderCliError } from "./ui.js";
export type { CliCommandContext, CliCommandResult } from "./commands/context.js";

function parseArgs(input: string): { command: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const [command, ...args] = trimmed.slice(1).split(/\s+/).filter(Boolean);
  return { command: (command ?? "").toLowerCase(), args };
}

/** 分发本地命令；自然语言继续交给 AgentService/Mastra。 */
export async function dispatchCliCommand(
  input: string,
  context: CliCommandContext,
): Promise<CliCommandResult> {
  const approvalShortcut = await maybeHandleApprovalShortcut(input, context);
  if (approvalShortcut) {
    return approvalShortcut;
  }
  if (context.isComposing() && !input.trim().startsWith("/")) {
    const appended = context.appendComposeLine(input);
    return {
      handled: true,
      output: `draft updated: ${appended.lineCount} line(s) / ${appended.charCount} chars`,
    };
  }
  const parsed = parseArgs(input);
  if (!parsed) {
    return { handled: false };
  }

  for (const handler of [
    handleComposerCommand,
    handleApprovalCommand,
    handleSessionCommand,
    handleRuntimeCommand,
  ]) {
    const result = await handler(parsed, context);
    if (result) return result;
  }
  const navigation = await handleNavigationCommand(parsed, context, dispatchCliCommand);
  return (
    navigation ?? {
      handled: true,
      output: renderCliError(
        "unknown command",
        `/${parsed.command} is not available`,
        "run /help for the supported command set",
      ),
    }
  );
}
