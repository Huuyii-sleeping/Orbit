import {
  renderCliError,
  renderCliSessions,
  renderCliTranscript,
  type CliSessionSummary,
} from "../ui.js";
import type { CliCommandContext, CliCommandResult, ParsedCliCommand } from "./context.js";

type SessionResolution =
  | { ok: true; session: CliSessionSummary; index: number; total: number }
  | { ok: false; output: string };

function resolveSessionSelector(
  sessions: CliSessionSummary[],
  selectorRaw: string,
): SessionResolution {
  if (sessions.length === 0) {
    return {
      ok: false,
      output: renderCliError(
        "no sessions",
        "there are no sessions available yet",
        "run /clear or /new to create one",
      ),
    };
  }
  const selector = selectorRaw.trim();
  if (!selector) {
    return {
      ok: false,
      output: renderCliError("missing session selector", "use /use <id|prefix|index|latest>"),
    };
  }
  const normalized = selector.toLowerCase();
  if (normalized === "latest") {
    const session = sessions.at(-1);
    if (!session) {
      return {
        ok: false,
        output: renderCliError("no sessions", "there are no sessions available yet"),
      };
    }
    return { ok: true, session, index: sessions.length - 1, total: sessions.length };
  }
  if (/^\d+$/.test(selector)) {
    const index = Number(selector) - 1;
    if (index < 0 || index >= sessions.length) {
      return {
        ok: false,
        output: renderCliError(
          "session index out of range",
          `unsupported session index: ${selector}`,
          `use a value between 1 and ${sessions.length}`,
        ),
      };
    }
    return {
      ok: true,
      session: sessions[index] as CliSessionSummary,
      index,
      total: sessions.length,
    };
  }
  const exactIndex = sessions.findIndex((session) => session.id === selector);
  if (exactIndex >= 0) {
    return {
      ok: true,
      session: sessions[exactIndex] as CliSessionSummary,
      index: exactIndex,
      total: sessions.length,
    };
  }
  const prefixMatches = sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => session.id.startsWith(selector));
  if (prefixMatches.length === 1) {
    const match = prefixMatches[0] as { session: CliSessionSummary; index: number };
    return {
      ok: true,
      session: match.session,
      index: match.index,
      total: sessions.length,
    };
  }
  if (prefixMatches.length > 1) {
    return {
      ok: false,
      output: renderCliError(
        "ambiguous session selector",
        `selector '${selector}' matches ${prefixMatches.length} sessions`,
        "run /sessions and use a longer prefix, exact id, or numeric index",
      ),
    };
  }
  return {
    ok: false,
    output: renderCliError(
      "session not found",
      `unknown session selector: ${selector}`,
      "run /sessions to inspect available sessions",
    ),
  };
}

function cycleSession(
  sessions: CliSessionSummary[],
  activeSessionId: string | null,
  direction: "next" | "prev",
): SessionResolution {
  if (sessions.length === 0) {
    return {
      ok: false,
      output: renderCliError(
        "no sessions",
        "there are no sessions available yet",
        "run /clear or /new to create one",
      ),
    };
  }
  const currentIndex = Math.max(
    0,
    sessions.findIndex((session) => session.active || session.id === activeSessionId),
  );
  const delta = direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + delta + sessions.length) % sessions.length;
  return {
    ok: true,
    session: sessions[nextIndex] as CliSessionSummary,
    index: nextIndex,
    total: sessions.length,
  };
}

/** 处理会话与历史浏览命令，未匹配时交给其他命令组。 */
export async function handleSessionCommand(
  parsed: ParsedCliCommand,
  context: CliCommandContext,
): Promise<CliCommandResult | undefined> {
  if (parsed.command === "sessions") {
    return { handled: true, output: renderCliSessions(context.listSessions()) };
  }
  if (parsed.command === "history") {
    const direction = parsed.args[0]?.trim().toLowerCase();
    if (
      direction &&
      direction !== "next" &&
      direction !== "prev" &&
      direction !== "first" &&
      direction !== "last"
    ) {
      return {
        handled: true,
        output: renderCliError(
          "unknown history action",
          `unsupported history action: ${parsed.args[0]}`,
          "use /history, /history first, /history prev, /history next, or /history last",
        ),
      };
    }
    return {
      handled: true,
      output: renderCliTranscript(
        context.showTranscript(
          direction === "next" ||
            direction === "prev" ||
            direction === "first" ||
            direction === "last"
            ? direction
            : "current",
        ),
      ),
    };
  }
  if (parsed.command === "search") {
    const action = parsed.args[0]?.trim().toLowerCase();
    if ((action === "next" || action === "prev") && parsed.args.length === 1) {
      const view = context.moveTranscriptSearch(action);
      if (!view) {
        return {
          handled: true,
          output: renderCliError(
            "search not active",
            "run /search <query> before moving across matches",
          ),
        };
      }
      return {
        handled: true,
        output: renderCliTranscript(view),
      };
    }
    const query = parsed.args.join(" ").trim();
    if (!query) {
      return {
        handled: true,
        output: renderCliError("missing search query", "use /search <query>"),
      };
    }
    return {
      handled: true,
      output: renderCliTranscript(context.searchTranscript(query)),
    };
  }
  if (parsed.command === "peek") {
    const relativeDirection = parsed.args[0]?.trim().toLowerCase();
    if (
      (relativeDirection === "next" || relativeDirection === "prev") &&
      parsed.args.length === 1
    ) {
      const view = context.moveTranscriptPeek(relativeDirection);
      if (!view) {
        return {
          handled: true,
          output: renderCliError(
            "peek not active",
            "run /peek <index> before moving to adjacent transcript entries",
          ),
        };
      }
      return {
        handled: true,
        output: renderCliTranscript(view),
      };
    }
    const rawIndex = parsed.args[0]?.trim() ?? "";
    const entryIndex = Number(rawIndex);
    if (!rawIndex || !Number.isInteger(entryIndex) || entryIndex <= 0) {
      return {
        handled: true,
        output: renderCliError(
          "invalid transcript entry",
          `unsupported entry index: ${rawIndex || "(empty)"}`,
          "use /peek <positive_index>",
        ),
      };
    }
    const view = context.peekTranscript(entryIndex);
    if (!view) {
      return {
        handled: true,
        output: renderCliError(
          "transcript entry not found",
          `unknown transcript entry: ${entryIndex}`,
          "run /history or /search to inspect available entries",
        ),
      };
    }
    return {
      handled: true,
      output: renderCliTranscript(view),
    };
  }
  if (parsed.command === "tail") {
    return {
      handled: true,
      output: renderCliTranscript(context.tailTranscript()),
    };
  }
  if (parsed.command === "next" || parsed.command === "prev") {
    const resolved = cycleSession(context.listSessions(), context.activeSessionId, parsed.command);
    if (!resolved.ok) {
      return { handled: true, output: resolved.output };
    }
    if (!context.useSession(resolved.session.id)) {
      return {
        handled: true,
        output: renderCliError("session not found", `unknown session: ${resolved.session.id}`),
      };
    }
    return {
      handled: true,
      output: `using session [${resolved.index + 1}/${resolved.total}] ${resolved.session.id}`,
      showBanner: true,
      nextSessionId: resolved.session.id,
    };
  }
  if (parsed.command === "clear" || parsed.command === "new") {
    const session = await context.createSession();
    return {
      handled: true,
      output: `started fresh session ${session.id}`,
      showBanner: true,
      nextSessionId: session.id,
      clearScreen: parsed.command === "clear",
    };
  }
  if (parsed.command === "use") {
    const resolved = resolveSessionSelector(context.listSessions(), parsed.args.join(" "));
    if (!resolved.ok) {
      return { handled: true, output: resolved.output };
    }
    if (!context.useSession(resolved.session.id)) {
      return {
        handled: true,
        output: renderCliError(
          "session not found",
          `unknown session: ${resolved.session.id}`,
          "run /sessions to inspect available sessions",
        ),
      };
    }
    return {
      handled: true,
      output: `using session [${resolved.index + 1}/${resolved.total}] ${resolved.session.id}`,
      showBanner: true,
      nextSessionId: resolved.session.id,
    };
  }
}
