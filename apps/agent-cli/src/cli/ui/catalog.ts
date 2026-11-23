import type { PromptDump } from "../../prompt/inspect.js";
import { accent, muted, renderRows, strong, success, truncate } from "./theme.js";
import type { CliSkillDetail, CliSkillSummary } from "./types.js";

export function renderCliTools(tools: Array<Record<string, string>>): string {
  if (tools.length === 0) {
    return `${strong("Tools")}\n${muted("No tools available.")}`;
  }
  return [
    strong("Tools"),
    ...tools.map(
      (tool) =>
        `${accent(tool.name ?? "(unnamed)")} [${tool.target ?? "unknown"}] ${truncate(tool.description ?? "", 96)}`,
    ),
  ].join("\n");
}

export function renderCliSkills(
  skills: CliSkillSummary[],
  loadedNames: string[],
  missingNames: string[],
): string {
  const lines = [strong("Skills")];
  if (skills.length === 0) {
    lines.push(
      muted("No skills discovered. Add .codex/skills/**/SKILL.md or set AGENT_SKILL_ROOTS."),
    );
  } else {
    lines.push(
      ...skills.map((skill) => {
        const state = skill.loaded ? success("loaded") : muted("available");
        const description = skill.description ? ` ${truncate(skill.description, 72)}` : "";
        const sourceType = skill.sourceType ?? "unknown";
        const policy = `source=${sourceType} shell=${skill.canRunShell ? "allowed" : "blocked"}`;
        return `${state} ${accent(skill.name)} ${muted(policy)}${description}\n${muted("path")}  ${skill.path}`;
      }),
    );
  }
  if (loadedNames.length > 0) {
    lines.push("", `${muted("configured")}  ${loadedNames.join(", ")}`);
  }
  if (missingNames.length > 0) {
    lines.push(`${muted("missing")}  ${missingNames.join(", ")}`);
  }
  return lines.join("\n");
}

export function renderCliSkillDetail(skill: CliSkillDetail): string {
  const metadataEntries = Object.entries(skill.metadata);
  const metadata =
    metadataEntries.length > 0
      ? metadataEntries
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(",") : value}`)
          .join(", ")
      : "(none)";
  const allowedTools = skill.allowedTools ?? [];
  const pathPatterns = skill.pathPatterns ?? [];
  return [
    strong(`Skill: ${skill.name}`),
    renderRows([
      { label: "state", value: skill.loaded ? "configured" : "available" },
      { label: "path", value: skill.path },
      { label: "root", value: skill.root },
      { label: "source", value: skill.sourceType ?? "unknown" },
      { label: "allowed", value: allowedTools.join(", ") || "(none)" },
      { label: "model", value: skill.model ?? "(default)" },
      { label: "paths", value: pathPatterns.join(", ") || "(all)" },
      { label: "shell", value: skill.canRunShell ? "allowed" : "blocked" },
      { label: "meta", value: metadata },
    ]),
    "",
    skill.content.trim() || muted("(empty skill body)"),
  ].join("\n");
}

export function renderCliPromptDump(
  dump: PromptDump,
  loadedNames: string[],
  missingNames: string[],
): string {
  const sectionGovernance =
    dump.sections?.map(
      (section) =>
        `${section.id} ${section.kind} source=${section.source} cache=${section.cachePolicy} priority=${section.priority} tokens=${section.estimatedTokens} reason=${section.inclusionReason}`,
    ) ?? [];
  const protectedExportNotice =
    dump.inspectionMode === "protected" && dump.protectedExportPath
      ? [
          ``,
          strong("Protected Export"),
          dump.protectedExportPath,
          muted("Inline protected prompt content is suppressed in the terminal."),
        ]
      : [];
  return [
    strong("System Prompt"),
    renderRows([
      { label: "inspection", value: dump.inspectionMode ?? "default" },
      { label: "stable", value: dump.stableSectionIds.join(", ") || "(none)" },
      { label: "dynamic", value: dump.dynamicSectionIds.join(", ") || "(none)" },
      { label: "skills", value: loadedNames.join(", ") || "(none)" },
      { label: "missing", value: missingNames.join(", ") || "(none)" },
      {
        label: "suppressed",
        value:
          dump.suppressedCategories?.map((item) => `${item.id}:${item.reason}`).join(" | ") ||
          "(none)",
      },
      { label: "export", value: dump.protectedExportPath ?? "(inline only)" },
      { label: "persistence", value: dump.persistenceBlockedReason ?? "(allowed)" },
    ]),
    "",
    strong("Sections"),
    sectionGovernance.length > 0 ? sectionGovernance.join("\n") : muted("(none)"),
    "",
    strong("Primary"),
    dump.inspectionMode === "protected" && dump.protectedExportPath
      ? muted("(stored in protected export)")
      : dump.primarySystemPrompt || muted("(empty)"),
    "",
    strong("Supplemental"),
    dump.inspectionMode === "protected" && dump.protectedExportPath
      ? muted("(stored in protected export)")
      : dump.supplementalSystemMessages.length > 0
        ? dump.supplementalSystemMessages.join("\n\n---\n\n")
        : muted("(none)"),
    ...protectedExportNotice,
  ].join("\n");
}
