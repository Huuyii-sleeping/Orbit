import type { UserDataGovernanceReport } from "../../governance/user-data.js";
import type { CliFeatureDisclosureReport } from "../features.js";
import {
  danger,
  formatUsd,
  muted,
  renderRows,
  strong,
  success,
  truncate,
  warning,
} from "./theme.js";
import type {
  CliApprovalListItem,
  CliConfigSnapshot,
  CliDoctorReport,
  CliMcpResetSummary,
  CliMcpServerStatus,
  CliPermissionSnapshot,
  CliStatusSnapshot,
  CliUsageSnapshot,
} from "./types.js";

export function renderCliStatus(snapshot: CliStatusSnapshot): string {
  const sessionTokens = snapshot.sessionPromptTokens + snapshot.sessionCompletionTokens;
  const dailyTokens = snapshot.dailyPromptTokens + snapshot.dailyCompletionTokens;
  return [
    strong("Status"),
    renderRows([
      { label: "workspace", value: snapshot.workspace },
      { label: "mode", value: snapshot.mode },
      { label: "model", value: snapshot.model },
      { label: "session", value: snapshot.activeSessionId ?? "(none)" },
      { label: "sessions", value: String(snapshot.sessionCount) },
      {
        label: "tools",
        value: `${snapshot.toolCount} total / ${snapshot.mcpToolCount} mcp / ${snapshot.mcpServerCount} servers`,
      },
      { label: "hooks", value: String(snapshot.hookCount) },
      {
        label: "permissions",
        value: `${snapshot.permissionMode} / ${snapshot.pendingApprovals} pending approvals`,
      },
      { label: "sandbox", value: snapshot.bashSandboxMode },
      { label: "roots", value: snapshot.workspaceRoots.join(", ") },
      {
        label: "usage",
        value:
          `session ${sessionTokens}/${snapshot.sessionTokenBudget} tokens ${formatUsd(snapshot.sessionEstimatedCostUsd)} | ` +
          `daily ${dailyTokens}/${snapshot.dailyTokenBudget} tokens ${formatUsd(snapshot.dailyEstimatedCostUsd)}`,
      },
      { label: "bridge", value: snapshot.bridgeEndpoint },
      { label: "scheduler", value: snapshot.schedulerStatus },
      { label: "theme", value: snapshot.theme },
    ]),
  ].join("\n");
}

export function renderCliConfig(snapshot: CliConfigSnapshot): string {
  return [
    strong("Config"),
    renderRows([
      { label: "model", value: snapshot.modelConfigured ? snapshot.model : "missing MODEL_ID" },
      { label: "base url", value: snapshot.openAiBaseUrl || "(default)" },
      {
        label: "mcp",
        value: `${snapshot.mcpConfigured ? "configured" : "not configured"} @ ${snapshot.mcpConfigPath}`,
      },
      {
        label: "hooks",
        value: `${snapshot.hooksConfigured ? "configured" : "not configured"} @ ${snapshot.hooksConfigPath}`,
      },
      {
        label: "release",
        value: snapshot.releaseCheckConfigured
          ? "release:check available"
          : "release:check missing",
      },
      { label: "permissions", value: snapshot.permissionMode },
      { label: "sandbox", value: snapshot.bashSandboxMode },
      { label: "roots", value: snapshot.workspaceRoots.join(", ") },
      { label: "theme", value: snapshot.theme },
    ]),
  ].join("\n");
}

export function renderCliMcpStatus(
  servers: CliMcpServerStatus[],
  reset?: CliMcpResetSummary,
): string {
  const lines = [strong("MCP")];
  if (reset) {
    lines.push(`reset     cleared ${reset.cleared} cached auth failure(s)`);
  }
  if (servers.length === 0) {
    lines.push(muted("No MCP servers configured."));
    return lines.join("\n");
  }
  for (const server of servers) {
    const auth = server.authFailed ? "failed" : "ok";
    const filters = [
      server.allowedTools.length > 0 ? `allow=${server.allowedTools.join(",")}` : "allow=*",
      server.disabledTools.length > 0 ? `deny=${server.disabledTools.join(",")}` : "deny=(none)",
    ].join(" ");
    lines.push(
      "",
      strong(server.name),
      renderRows([
        { label: "trust", value: server.trusted ? "trusted" : "untrusted" },
        { label: "tools", value: String(server.toolCount) },
        {
          label: "calls",
          value: `${server.activeCalls} active / ${server.queuedCalls} queued / max ${server.maxConcurrentCalls}`,
        },
        { label: "auth", value: auth },
        { label: "filters", value: filters },
        { label: "credentials", value: server.credentialMode },
        { label: "source", value: server.provenance },
      ]),
    );
    if (server.authFailureMessage) {
      lines.push(`auth msg  ${truncate(server.authFailureMessage, 96)}`);
    }
  }
  return lines.join("\n");
}

export function renderCliArchitecture(): string {
  return [
    strong("Architecture"),
    renderRows([
      {
        label: "reference",
        value:
          "github.com/liuup/claude-code-analysis/blob/main/analysis/01-architecture-overview.md",
      },
      {
        label: "verdict",
        value: "核心六层大多已覆盖；remote/bridge/daemon 类远程平台形态未做成独立产品面。",
      },
    ]),
    "",
    strong("Covered"),
    "- CLI 引导层: src/main.ts + src/entrypoints/cli-dispatcher.ts + headless/tui/mcp-server。",
    "- 组合根/初始化层: src/bootstrap/app-runtime.ts + src/services/runtime-services.ts + src/config/config.ts。",
    "- 执行内核: 单一 Mastra instance + Agent/Workflow/Tool/Memory adapters。",
    "- Tool/Permission 层: src/tools/service.ts + catalog/executor + security/team/worktree/task/scheduler/background/subagent。",
    "- Memory/Persistence 层: Mastra storage + MemoryRuntimePort，其他产品数据保持独立持久化。",
    "- MCP 扩展层: src/tools/mcp/*.ts，同时通过 src/entrypoints/mcp-server.ts 对外暴露 MCP server。",
    "",
    strong("Stronger Here"),
    "- 权限模式和审批队列已产品化，并由唯一 ToolExecutionPort 执行。",
    "- delivery 自动验证、closeout、handoff 和 OpenSpec 形成修改到验证的闭环。",
    "- skills 加载、prompt dump、palette、workflow、transcript browse 都是内建本地控制面。",
    "- 异步运行时不止 swarm：还包括 scheduler、background task、subagent、team、worktree 和 task board。",
    "",
    strong("Not Covered"),
    "- 没有单独的 remote-control / bridge / daemon 进程形态。",
    "- 没有远程 orchestrator、websocket reconnect 或独立 swarm backend registry。",
    "- 工具执行以统一执行契约为主，没有单独暴露 concurrency-safe batch API。",
  ].join("\n");
}

export function renderCliUserDataGovernance(report: UserDataGovernanceReport): string {
  return [
    strong("User Data Governance"),
    renderRows([
      { label: "reference", value: report.reference },
      { label: "surfaces", value: String(report.surfaces.length) },
      { label: "privacy", value: String(report.privacyControls.length) },
      {
        label: "legend",
        value: Object.entries(report.statusLabels)
          .map(([key, label]) => `${key}=${label}`)
          .join(" | "),
      },
    ]),
    "",
    strong("Privacy Minimization"),
    ...report.privacyControls.flatMap((control) => [
      renderRows([
        { label: "control", value: control.id },
        { label: "state", value: control.state },
        { label: "summary", value: control.summary },
      ]),
      "",
    ]),
    strong("Reserved Privacy Gaps"),
    ...(report.privacyReservedGaps.length > 0
      ? report.privacyReservedGaps.map((item) => `- ${item}`)
      : ["(none)"]),
    "",
    ...report.surfaces.flatMap((surface) => [
      strong(surface.title),
      renderRows([
        { label: "id", value: surface.id },
        { label: "status", value: `${surface.status} / ${report.statusLabels[surface.status]}` },
        { label: "boundary", value: surface.boundary },
        { label: "default", value: surface.defaultState },
        { label: "summary", value: surface.summary },
        { label: "sources", value: surface.sources.join(" | ") },
        { label: "uses", value: surface.uses.join(" | ") },
        { label: "retention", value: surface.retention },
        { label: "export", value: surface.exportDelete },
        { label: "notes", value: surface.notes.join(" | ") || "(none)" },
      ]),
      "",
    ]),
  ].join("\n");
}

export function renderCliFeatureDisclosure(report: CliFeatureDisclosureReport): string {
  return [
    strong("Feature Disclosure"),
    renderRows([
      { label: "public", value: String(report.summary.publicFeatures) },
      { label: "internal", value: String(report.summary.internalFeatures) },
      {
        label: "hidden commands",
        value:
          report.summary.hiddenCommands === 0
            ? "none registered"
            : String(report.summary.hiddenCommands),
      },
      {
        label: "easter eggs",
        value:
          report.summary.easterEggs === 0 ? "none registered" : String(report.summary.easterEggs),
      },
      {
        label: "beta-only",
        value:
          report.summary.betaOnlySurfaces === 0
            ? "reserved_gap"
            : String(report.summary.betaOnlySurfaces),
      },
      { label: "reserved", value: String(report.summary.reservedGaps) },
    ]),
    "",
    strong("Reserved Gaps"),
    ...report.reservedGaps.map((item) => `- ${item}`),
    "",
    strong("Entries"),
    ...report.entries.flatMap((entry) => [
      renderRows([
        { label: "id", value: entry.id },
        { label: "title", value: entry.title },
        { label: "visibility", value: entry.visibility },
        { label: "stability", value: entry.stability },
        { label: "default", value: entry.enabledByDefault ? "enabled" : "disabled" },
        { label: "commands", value: entry.commands.join(" | ") },
        { label: "summary", value: entry.summary },
        { label: "notes", value: entry.notes.join(" | ") || "(none)" },
      ]),
      "",
    ]),
  ].join("\n");
}

export function renderCliDoctor(report: CliDoctorReport): string {
  const rows = report.checks.map((check) => {
    const severity =
      check.severity === "pass"
        ? success("pass")
        : check.severity === "warn"
          ? warning("warn")
          : danger("error");
    const suggestion = check.suggestion ? ` | ${check.suggestion}` : "";
    return `${severity} ${check.label}: ${check.reason}${suggestion}`;
  });
  return [strong("Doctor"), ...rows].join("\n");
}

export function renderCliPermissions(snapshot: CliPermissionSnapshot): string {
  return [
    strong("Permissions"),
    renderRows([
      { label: "mode", value: snapshot.mode },
      { label: "pending", value: String(snapshot.pendingApprovals) },
      { label: "approved", value: String(snapshot.approvedApprovals) },
      { label: "rejected", value: String(snapshot.rejectedApprovals) },
      { label: "expired", value: String(snapshot.expiredApprovals) },
      { label: "consumed", value: String(snapshot.consumedApprovals) },
    ]),
  ].join("\n");
}

export function renderCliApprovals(items: CliApprovalListItem[]): string {
  if (items.length === 0) {
    return `${strong("Approvals")}\n${muted("No approval requests found.")}`;
  }
  return [
    strong("Approvals"),
    ...items.map((item) => {
      const summary = `${item.status} ${item.requestId} ${item.action} (${item.risk})`.trim();
      return item.reason ? `${summary}\n${muted("reason")}  ${truncate(item.reason, 96)}` : summary;
    }),
  ].join("\n");
}

export function renderCliUsage(snapshot: CliUsageSnapshot): string {
  const sessionTokens = snapshot.sessionPromptTokens + snapshot.sessionCompletionTokens;
  const dailyTokens = snapshot.dailyPromptTokens + snapshot.dailyCompletionTokens;
  return [
    strong("Usage"),
    renderRows([
      { label: "model", value: snapshot.model },
      {
        label: "session",
        value: `${sessionTokens}/${snapshot.sessionTokenBudget} tokens (${snapshot.sessionPromptTokens} prompt / ${snapshot.sessionCompletionTokens} completion)`,
      },
      { label: "session $", value: formatUsd(snapshot.sessionEstimatedCostUsd) },
      {
        label: "daily",
        value: `${dailyTokens}/${snapshot.dailyTokenBudget} tokens (${snapshot.dailyPromptTokens} prompt / ${snapshot.dailyCompletionTokens} completion)`,
      },
      { label: "daily $", value: formatUsd(snapshot.dailyEstimatedCostUsd) },
      { label: "day", value: snapshot.dayKey },
    ]),
  ].join("\n");
}
