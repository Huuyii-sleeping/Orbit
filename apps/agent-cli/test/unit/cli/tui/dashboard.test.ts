import { describe, expect, it } from "vitest";
import { renderTerminalTuiDashboard } from "../../../../src/cli/tui/dashboard.js";

describe("cli/tui/dashboard", () => {
  it("renders dashboard state", () => {
    const dashboard = renderTerminalTuiDashboard({
      model: "gpt-test",
      workflow: "draw",
      activeSessionId: "s01",
      composerActive: true,
      composerLineCount: 2,
      composerCharCount: 11,
      draftLines: [
        "summary  2 lines / 11 chars",
        "actions  /preview /send /pop /cancel",
        "",
        "01| hello",
        "02| world",
      ],
      sessionCount: 2,
      toolCount: 3,
      bridgeEndpoint: "/events",
      sessions: [
        { id: "s01", busy: false, messageCount: 2, active: true },
        { id: "s02", busy: false, messageCount: 0, active: false },
      ],
      guideLines: ["help      /help draft or Ctrl+G", "send      /send submits the current draft"],
      shortcutLines: [
        "ctrl+g    help",
        "ctrl+k    palette",
        "ctrl+n    next session",
        "esc       cancel draft",
      ],
      footerSegments: [
        "model gpt-test",
        "session 1/2",
        "help /help ^G",
        "palette /palette ^K",
        "switch /next /prev /use",
        "keys ^G ^K ^N ^P ^L Esc",
      ],
      paletteOpen: true,
      paletteBarLines: [
        "input     review",
        "focus     [1/2] session /use 2",
        "preview   review session",
      ],
      paletteLines: [
        "query     review",
        "results   2 shown / 2 total",
        "keys      Enter open | Up/Down/^N/^P move | Esc close",
        "",
        "group     session",
        "> [1] /use 2  |  Switch to session [2] s02-review",
      ],
    });

    expect(dashboard).toContain("Agent CLI");
    expect(dashboard).toContain("mode");
    expect(dashboard).toContain("session");
    expect(dashboard).toContain("Draft");
    expect(dashboard).toContain("Guide");
    expect(dashboard).toContain("Shortcuts");
    expect(dashboard).toContain("[1]");
    expect(dashboard).toContain("/use 2 /next /prev");
    expect(dashboard).toContain("ctrl+g help");
    expect(dashboard).toContain("ctrl+k palette");
    expect(dashboard).toContain("palette /palette ^K");
    expect(dashboard).toContain("keys ^G ^K ^N ^P ^L Esc");
    expect(dashboard).toContain("Command Bar");
    expect(dashboard).toContain("Palette Results");
    expect(dashboard).toContain("palette-live");
    expect(dashboard).toContain("tui/draw");
    expect(dashboard).toContain("focus [1/2] session /use 2");
    expect(dashboard).toContain("Enter open | Up/Down/^N/^P move | Esc close");
    expect(dashboard).toContain("preview review session");
    expect(dashboard).toContain("actions /preview /send");
    expect(dashboard).toContain("/pop /cancel");
  });
});
