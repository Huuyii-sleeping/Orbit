import {
  listCliHelpTopics,
  renderCliError,
  renderCliHelp,
  renderCliPalette,
  resolveCliHelpTopic,
  type CliHelpTopicId,
} from "../ui.js";
import type { CliCommandContext, CliCommandResult, ParsedCliCommand } from "./context.js";

/** 处理帮助与面板导航命令，未匹配时交给其他命令组。 */
export async function handleNavigationCommand(
  parsed: ParsedCliCommand,
  context: CliCommandContext,
  dispatch: (input: string, context: CliCommandContext) => Promise<CliCommandResult>,
): Promise<CliCommandResult | undefined> {
  if (parsed.command === "help") {
    const requestedTopic = parsed.args.join(" ");
    const topic = resolveCliHelpTopic(requestedTopic) as CliHelpTopicId | null;
    if (!topic) {
      return {
        handled: true,
        output: renderCliError(
          "unknown help topic",
          `unsupported help topic: ${requestedTopic.trim()}`,
          `use one of: ${listCliHelpTopics().join(", ")}`,
        ),
      };
    }
    return { handled: true, output: renderCliHelp(topic) };
  }
  if (parsed.command === "palette") {
    const paletteAction = parsed.args[0]?.trim().toLowerCase();
    if (paletteAction === "open") {
      const rawIndex = parsed.args[1]?.trim() ?? "";
      const entryIndex = Number(rawIndex);
      if (!rawIndex || !Number.isInteger(entryIndex) || entryIndex <= 0) {
        return {
          handled: true,
          output: renderCliError(
            "invalid palette entry",
            `unsupported palette index: ${rawIndex || "(empty)"}`,
            "use /palette open <positive_index>",
          ),
        };
      }
      const candidate = context.openPalette(entryIndex);
      if (!candidate) {
        return {
          handled: true,
          output: renderCliError(
            "palette entry not found",
            `unknown palette entry: ${entryIndex}`,
            "run /palette again before opening a result",
          ),
        };
      }
      const result = await dispatch(candidate.command, context);
      if (!result.handled) {
        return {
          handled: true,
          output: renderCliError(
            "palette command failed",
            `unable to execute ${candidate.command}`,
          ),
        };
      }
      return {
        handled: true,
        output: [`palette [${entryIndex}] -> ${candidate.command}`, result.output]
          .filter(Boolean)
          .join("\n"),
        clearScreen: result.clearScreen,
        exit: result.exit,
        showBanner: result.showBanner,
        nextSessionId: result.nextSessionId,
        submitPrompt: result.submitPrompt,
      };
    }
    return {
      handled: true,
      output: renderCliPalette(await context.showPalette(parsed.args.join(" "))),
    };
  }
  if (parsed.command === "redraw") {
    return {
      handled: true,
      output: "",
      clearScreen: true,
      showBanner: true,
    };
  }
  if (parsed.command === "exit" || parsed.command === "quit") {
    return { handled: true, output: "bye", exit: true };
  }
}
