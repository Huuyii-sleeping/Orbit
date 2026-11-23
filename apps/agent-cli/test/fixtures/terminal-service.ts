import { vi } from "vitest";
import type { TerminalTuiServiceLike } from "../../src/cli/tui/service.js";

export function createService(): TerminalTuiServiceLike {
  const sessions = [
    {
      id: "s01",
      busy: false,
      history: [
        { role: "user", content: "first prompt" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second prompt" },
        { role: "assistant", content: "hook blocked during run" },
      ] as unknown[],
    },
  ];
  return {
    bridgeManifest: () => ({ endpoints: { events: "/events" } }),
    createSession: vi.fn(() => {
      const session = {
        id: `s${String(sessions.length + 1).padStart(2, "0")}`,
        busy: false,
        history: [] as unknown[],
      };
      sessions.push(session);
      return session;
    }),
    listSessions: vi.fn(() => sessions),
    toolsMetadata: vi.fn(async () => [{ name: "read_file", target: "base", description: "Read" }]),
    chat: vi.fn(async (input) => ({
      ok: true,
      assistant: `reply:${input.message}`,
      session: { id: input.session_id ?? "s01" },
    })),
    runToolByName: vi.fn(async (name: string, argsJson: string) => {
      const parsed = JSON.parse(argsJson) as {
        command?: string;
        request_id?: string;
        status?: string;
      };
      if (name === "security_list_approvals") {
        return JSON.stringify({
          ok: true,
          approvals: [
            {
              request_id: "apr_1",
              action: "write_file",
              risk: "medium",
              status: parsed.status ?? "pending",
              reason: "write operation requires approval",
            },
          ],
        });
      }
      if (name === "security_approve") {
        return JSON.stringify({
          ok: true,
          request: {
            request_id: parsed.request_id,
            action: "write_file",
            risk: "medium",
            status: "approved",
          },
        });
      }
      return `ran:${parsed.command ?? ""}`;
    }),
  };
}
