import { buildUserDataGovernanceReport } from "../../governance/user-data.js";
import { buildCliFeatureDisclosureReport } from "../features.js";
import {
  renderCliArchitecture,
  renderCliCompactSummary,
  renderCliConfig,
  renderCliDoctor,
  renderCliError,
  renderCliFeatureDisclosure,
  renderCliMcpStatus,
  renderCliPromptDump,
  renderCliSkillDetail,
  renderCliSkills,
  renderCliStatus,
  renderCliTools,
  renderCliUsage,
  renderCliUserDataGovernance,
} from "../ui.js";
import type { CliCommandContext, CliCommandResult, ParsedCliCommand } from "./context.js";

/** 处理模型、能力与运行设置命令，未匹配时交给其他命令组。 */
export async function handleRuntimeCommand(
  parsed: ParsedCliCommand,
  context: CliCommandContext,
): Promise<CliCommandResult | undefined> {
  if (parsed.command === "status") {
    return { handled: true, output: renderCliStatus(await context.getStatus()) };
  }
  if (parsed.command === "config") {
    return { handled: true, output: renderCliConfig(await context.getConfig()) };
  }
  if (parsed.command === "mcp") {
    const action = parsed.args[0]?.trim().toLowerCase();
    if (!action) {
      return { handled: true, output: renderCliMcpStatus(await context.getMcpStatus()) };
    }
    if (action === "reset" && parsed.args.length === 1) {
      const reset = await context.resetMcpAuthFailures();
      return {
        handled: true,
        output: renderCliMcpStatus(await context.getMcpStatus(), reset),
      };
    }
    return {
      handled: true,
      output: renderCliError(
        "unknown mcp action",
        `unsupported mcp action: ${parsed.args.join(" ")}`,
        "use /mcp or /mcp reset",
      ),
    };
  }
  if (parsed.command === "architecture") {
    return { handled: true, output: renderCliArchitecture() };
  }
  if (parsed.command === "data") {
    return { handled: true, output: renderCliUserDataGovernance(buildUserDataGovernanceReport()) };
  }
  if (parsed.command === "features") {
    return { handled: true, output: renderCliFeatureDisclosure(buildCliFeatureDisclosureReport()) };
  }
  if (parsed.command === "model") {
    const nextModel = parsed.args.join(" ").trim();
    if (!nextModel) {
      return { handled: true, output: `model: ${context.getModel()}` };
    }
    const changed = await context.setModel(nextModel);
    if (!changed) {
      return {
        handled: true,
        output: renderCliError("model update failed", `unable to switch to model: ${nextModel}`),
      };
    }
    return {
      handled: true,
      output: `model set to ${nextModel}`,
      showBanner: true,
    };
  }
  if (parsed.command === "cost" || parsed.command === "usage") {
    return { handled: true, output: renderCliUsage(await context.getUsage()) };
  }
  if (parsed.command === "compact") {
    if (!context.canCompactSession()) {
      return {
        handled: true,
        output: renderCliError(
          "compact unavailable",
          "当前运行服务尚未提供 Mastra 上下文压缩能力。",
          "可使用 /new 开始新会话；原会话历史仍保留。",
        ),
      };
    }
    const keepRecent = parsed.args[0] ? Number(parsed.args[0]) : undefined;
    if (parsed.args[0] && (!Number.isInteger(keepRecent) || Number(keepRecent) <= 0)) {
      return {
        handled: true,
        output: renderCliError(
          "invalid keep_recent",
          `unsupported value: ${parsed.args[0]}`,
          "use /compact or /compact 20",
        ),
      };
    }
    return {
      handled: true,
      output: renderCliCompactSummary(await context.compactSession(keepRecent)),
    };
  }
  if (parsed.command === "add-dir") {
    const root = parsed.args.join(" ").trim();
    if (!root) {
      return {
        handled: true,
        output: renderCliError("missing path", "use /add-dir <directory>"),
      };
    }
    const added = await context.addWorkspaceRoot(root);
    if (!added.ok) {
      return {
        handled: true,
        output: renderCliError("add-dir failed", added.error),
      };
    }
    return {
      handled: true,
      output: `added workspace root ${added.root}`,
      showBanner: true,
    };
  }
  if (parsed.command === "tools") {
    return { handled: true, output: renderCliTools(await context.listTools()) };
  }
  if (parsed.command === "skills") {
    const catalog = await context.listSkills();
    return {
      handled: true,
      output: renderCliSkills(catalog.skills, catalog.loadedNames, catalog.missingNames),
    };
  }
  if (parsed.command === "skill") {
    const skillName = parsed.args.join(" ").trim();
    if (!skillName) {
      return {
        handled: true,
        output: renderCliError("missing skill name", "use /skill <name>"),
      };
    }
    const skill = await context.getSkill(skillName);
    if (!skill) {
      return {
        handled: true,
        output: renderCliError(
          "skill not found",
          `unknown skill: ${skillName}`,
          "run /skills to inspect available skills",
        ),
      };
    }
    return {
      handled: true,
      output: renderCliSkillDetail(skill),
    };
  }
  if (parsed.command === "workflow") {
    const nextWorkflow = parsed.args[0]?.trim().toLowerCase();
    if (!nextWorkflow) {
      return { handled: true, output: `workflow: ${context.getWorkflow()}` };
    }
    if (nextWorkflow !== "agent" && nextWorkflow !== "draw") {
      return {
        handled: true,
        output: renderCliError(
          "unknown workflow",
          `unsupported workflow: ${nextWorkflow}`,
          "use /workflow agent or /workflow draw",
        ),
      };
    }
    context.setWorkflow(nextWorkflow);
    return {
      handled: true,
      output: `workflow set to ${nextWorkflow}`,
      showBanner: true,
    };
  }
  if (parsed.command === "doctor") {
    return { handled: true, output: renderCliDoctor(await context.runDoctor()) };
  }
  if (parsed.command === "theme") {
    const nextTheme = parsed.args[0]?.toLowerCase();
    if (!nextTheme) {
      return { handled: true, output: `theme: ${context.getTheme()}` };
    }
    if (nextTheme !== "atlas" && nextTheme !== "plain") {
      return {
        handled: true,
        output: renderCliError(
          "unknown theme",
          `unsupported theme: ${nextTheme}`,
          "use /theme atlas or /theme plain",
        ),
      };
    }
    context.setTheme(nextTheme);
    return {
      handled: true,
      output: `theme set to ${nextTheme}`,
      clearScreen: true,
      showBanner: true,
    };
  }
  if (parsed.command === "prompt") {
    const action = parsed.args.join(" ").trim().toLowerCase();
    if (action && action !== "dump" && action !== "full") {
      return {
        handled: true,
        output: renderCliError(
          "unknown prompt action",
          `unsupported prompt action: ${action}`,
          "use /prompt, /prompt dump, or /prompt full",
        ),
      };
    }
    const promptDump = await context.dumpSystemPrompt(action === "full" ? "protected" : "default");
    return {
      handled: true,
      output: renderCliPromptDump(promptDump.dump, promptDump.loadedNames, promptDump.missingNames),
    };
  }
}
