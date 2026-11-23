import { renderCliComposer, renderCliError } from "../ui.js";
import type { CliCommandContext, CliCommandResult, ParsedCliCommand } from "./context.js";

/** 处理草稿编辑命令，未匹配时交给其他命令组。 */
export async function handleComposerCommand(
  parsed: ParsedCliCommand,
  context: CliCommandContext,
): Promise<CliCommandResult | undefined> {
  if (parsed.command === "compose") {
    const draft = context.startCompose();
    return {
      handled: true,
      output:
        draft.lineCount > 0
          ? `composer resumed: ${draft.lineCount} line(s) / ${draft.charCount} chars`
          : "composer started: enter lines, then /send, /preview, or /cancel",
    };
  }
  if (parsed.command === "preview") {
    const draft = context.previewCompose();
    if (!draft) {
      return {
        handled: true,
        output: renderCliError("no draft", "start with /compose before previewing"),
      };
    }
    return {
      handled: true,
      output: renderCliComposer(draft),
    };
  }
  if (parsed.command === "pop") {
    const count = parsed.args[0] ? Number(parsed.args[0]) : 1;
    if (parsed.args[0] && (!Number.isInteger(count) || count <= 0)) {
      return {
        handled: true,
        output: renderCliError(
          "invalid pop count",
          `unsupported value: ${parsed.args[0]}`,
          "use /pop or /pop 3",
        ),
      };
    }
    const draft = context.popCompose(count);
    if (!draft) {
      return {
        handled: true,
        output: renderCliError("no draft", "start with /compose before removing draft lines"),
      };
    }
    if (draft.removedLineCount === 0) {
      return {
        handled: true,
        output: `draft unchanged: 0 line(s) removed, ${draft.lineCount} line(s) / ${draft.charCount} chars remain`,
      };
    }
    return {
      handled: true,
      output:
        `draft rewound: removed ${draft.removedLineCount} line(s), ` +
        `${draft.lineCount} line(s) / ${draft.charCount} chars remain`,
    };
  }
  if (parsed.command === "send") {
    const draft = context.sendCompose();
    if (!draft || !draft.content.trim()) {
      return {
        handled: true,
        output: renderCliError(
          "no draft",
          "start with /compose and add at least one line before /send",
        ),
      };
    }
    return {
      handled: true,
      output: `submitting draft: ${draft.lineCount} line(s) / ${draft.charCount} chars`,
      submitPrompt: draft.content,
    };
  }
  if (parsed.command === "cancel") {
    const draft = context.cancelCompose();
    if (!draft) {
      return {
        handled: true,
        output: renderCliError("no draft", "there is no active draft to cancel"),
      };
    }
    return {
      handled: true,
      output: `draft discarded: ${draft.lineCount} line(s) / ${draft.charCount} chars`,
    };
  }
}
