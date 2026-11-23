import { renderCliApprovals, renderCliError, renderCliPermissions } from "../ui.js";
import type { CliCommandContext, CliCommandResult, ParsedCliCommand } from "./context.js";

type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "consumed";

type ApprovalRecord = {
  request_id?: unknown;
  action?: unknown;
  risk?: unknown;
  reason?: unknown;
  status?: unknown;
};

type ReplayRecord = {
  ok?: unknown;
  preview?: unknown;
  summary?: unknown;
};

function parseToolResult(raw: string): {
  ok: boolean;
  data: Record<string, unknown>;
  message: string;
} {
  try {
    const parsed = JSON.parse(raw) as {
      ok?: boolean;
      error?: { message?: unknown };
      [key: string]: unknown;
    };
    return {
      ok: parsed.ok !== false,
      data: parsed as Record<string, unknown>,
      message: String(parsed.error?.message ?? ""),
    };
  } catch {
    return { ok: false, data: {}, message: raw.trim() || "invalid tool response" };
  }
}

function isApprovalStatus(value: string | undefined): value is ApprovalStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "expired" ||
    value === "consumed"
  );
}

function formatApprovalDecision(raw: string, verb: "approved" | "rejected"): string {
  const result = parseToolResult(raw);
  if (!result.ok) {
    return renderCliError(`${verb} failed`, result.message || `unable to mark approval as ${verb}`);
  }
  const request = (result.data.request ?? {}) as ApprovalRecord;
  const requestId = String(request.request_id ?? "");
  const action = String(request.action ?? "");
  const status = String(request.status ?? verb);
  const risk = String(request.risk ?? "");
  const replay = (result.data.replay ?? null) as ReplayRecord | null;
  const lines = [
    `${status} ${requestId}${action ? ` for ${action}` : ""}${risk ? ` (${risk})` : ""}`,
  ];
  if (replay) {
    const preview = String(replay.preview ?? "").trim();
    const summary = String(replay.summary ?? "").trim();
    lines.push(
      replay.ok === false
        ? `replay failed${preview ? `: ${preview}` : ""}${summary ? ` | ${summary}` : ""}`
        : `replayed${preview ? `: ${preview}` : ""}${summary ? ` | ${summary}` : ""}`,
    );
  }
  return lines.join("\n");
}

function parseApprovalRecords(raw: string): {
  ok: boolean;
  approvals: ApprovalRecord[];
  message: string;
} {
  const result = parseToolResult(raw);
  return {
    ok: result.ok,
    approvals: Array.isArray(result.data.approvals)
      ? (result.data.approvals as ApprovalRecord[])
      : [],
    message: result.message,
  };
}

async function resolveApprovalShortcutRequestId(
  context: CliCommandContext,
): Promise<{ ok: true; requestId: string } | { ok: false; output: string }> {
  const listed = parseApprovalRecords(await context.listApprovals("pending"));
  if (!listed.ok) {
    return {
      ok: false,
      output: renderCliError(
        "approvals failed",
        listed.message || "unable to inspect pending approvals",
      ),
    };
  }
  if (listed.approvals.length === 0) {
    return {
      ok: false,
      output: renderCliError("no pending approvals", "there is no pending approval to act on"),
    };
  }
  if (listed.approvals.length > 1) {
    return {
      ok: false,
      output: renderCliError(
        "multiple pending approvals",
        `found ${listed.approvals.length} pending approvals`,
        "use /approvals and then /approve <request_id> or /reject <request_id>",
      ),
    };
  }
  return {
    ok: true,
    requestId: String(listed.approvals[0]?.request_id ?? ""),
  };
}

export async function maybeHandleApprovalShortcut(
  input: string,
  context: CliCommandContext,
): Promise<CliCommandResult | null> {
  if (context.isComposing()) {
    return null;
  }
  const normalized = input.trim().toLowerCase();
  const isApprove =
    normalized === "批准" ||
    normalized === "同意" ||
    normalized === "approve" ||
    normalized === "yes";
  const isReject =
    normalized === "拒绝" ||
    normalized === "不同意" ||
    normalized === "reject" ||
    normalized === "no";
  if (!isApprove && !isReject) {
    return null;
  }
  const resolved = await resolveApprovalShortcutRequestId(context);
  if (!resolved.ok) {
    return { handled: true, output: resolved.output };
  }
  return {
    handled: true,
    output: formatApprovalDecision(
      await (isApprove
        ? context.approveRequest(resolved.requestId)
        : context.rejectRequest(resolved.requestId)),
      isApprove ? "approved" : "rejected",
    ),
  };
}

/** 处理权限与审批命令，未匹配时交给其他命令组。 */
export async function handleApprovalCommand(
  parsed: ParsedCliCommand,
  context: CliCommandContext,
): Promise<CliCommandResult | undefined> {
  if (parsed.command === "permissions") {
    const nextMode = parsed.args[0]?.trim().toLowerCase();
    if (!nextMode) {
      return { handled: true, output: renderCliPermissions(await context.getPermissions()) };
    }
    if (nextMode !== "default" && nextMode !== "accept-edits" && nextMode !== "plan") {
      return {
        handled: true,
        output: renderCliError(
          "unknown permission mode",
          `unsupported permission mode: ${nextMode}`,
          "use /permissions default | accept-edits | plan",
        ),
      };
    }
    context.setPermissionMode(nextMode);
    return {
      handled: true,
      output: renderCliPermissions(await context.getPermissions()),
      showBanner: true,
    };
  }
  if (parsed.command === "approvals") {
    const status = parsed.args[0]?.trim().toLowerCase();
    if (parsed.args[0] && !isApprovalStatus(status)) {
      return {
        handled: true,
        output: renderCliError(
          "unknown approval status",
          `unsupported approval status: ${parsed.args[0]}`,
          "use /approvals or /approvals pending|approved|rejected|expired|consumed",
        ),
      };
    }
    const approvalStatus = isApprovalStatus(status) ? status : undefined;
    const listed = parseApprovalRecords(await context.listApprovals(approvalStatus));
    if (!listed.ok) {
      return {
        handled: true,
        output: renderCliError("approvals failed", listed.message || "unable to list approvals"),
      };
    }
    return {
      handled: true,
      output: renderCliApprovals(
        listed.approvals.map((item) => ({
          requestId: String(item.request_id ?? ""),
          action: String(item.action ?? ""),
          risk: String(item.risk ?? ""),
          status: String(item.status ?? ""),
          reason: String(item.reason ?? ""),
        })),
      ),
    };
  }
  if (parsed.command === "approve") {
    const requestId = parsed.args[0]?.trim() ?? "";
    if (!requestId) {
      return {
        handled: true,
        output: renderCliError("missing request id", "use /approve <request_id>"),
      };
    }
    return {
      handled: true,
      output: formatApprovalDecision(await context.approveRequest(requestId), "approved"),
    };
  }
  if (parsed.command === "reject") {
    const requestId = parsed.args[0]?.trim() ?? "";
    if (!requestId) {
      return {
        handled: true,
        output: renderCliError("missing request id", "use /reject <request_id>"),
      };
    }
    return {
      handled: true,
      output: formatApprovalDecision(await context.rejectRequest(requestId), "rejected"),
    };
  }
}
