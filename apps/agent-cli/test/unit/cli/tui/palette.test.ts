import { describe, expect, it } from "vitest";
import {
  createTerminalTuiPaletteState,
  getTerminalTuiSelectedPaletteCandidate,
  highlightTerminalTuiPaletteQuery,
  moveTerminalTuiPaletteSelection,
  renderTerminalTuiPaletteBarLines,
  renderTerminalTuiPaletteLines,
  resolveTerminalTuiPaletteLiveQuery,
  resolveTerminalTuiShortcut,
  updateTerminalTuiPaletteState,
} from "../../../../src/cli/tui/palette.js";

describe("cli/tui/palette", () => {
  it("tracks palette selection state locally for the TUI", () => {
    const opened = updateTerminalTuiPaletteState({
      state: createTerminalTuiPaletteState(),
      open: true,
      view: {
        query: "review",
        total: 2,
        candidates: [
          {
            id: "review",
            group: "session",
            title: "Switch to session [2] s02-review",
            summary: "review session",
            command: "/use 2",
            keywords: ["review"],
          },
          {
            id: "history",
            group: "browse",
            title: "Browse transcript window",
            summary: "transcript",
            command: "/history",
            keywords: ["history"],
          },
        ],
      },
    });
    const moved = moveTerminalTuiPaletteSelection(opened, 1);

    expect(getTerminalTuiSelectedPaletteCandidate(opened)?.command).toBe("/use 2");
    expect(getTerminalTuiSelectedPaletteCandidate(moved)?.command).toBe("/history");
    expect(renderTerminalTuiPaletteLines(moved)).toContain(
      "> [2] /history  |  Browse transcript window",
    );
  });

  it("derives live palette queries from local key input", () => {
    expect(resolveTerminalTuiPaletteLiveQuery("", { sequence: "r", name: "r" })).toBe("r");
    expect(resolveTerminalTuiPaletteLiveQuery("re", { sequence: "v", name: "v" })).toBe("rev");
    expect(resolveTerminalTuiPaletteLiveQuery("review", { name: "backspace" })).toBe("revie");
    expect(resolveTerminalTuiPaletteLiveQuery("review", { ctrl: true, name: "n" })).toBeNull();
    expect(
      resolveTerminalTuiPaletteLiveQuery("review", { name: "enter", sequence: "\r" }),
    ).toBeNull();
  });

  it("highlights palette matches and renders preview text for the selected candidate", () => {
    expect(highlightTerminalTuiPaletteQuery("review session", "review")).toBe("<<review>> session");
    const state = updateTerminalTuiPaletteState({
      state: createTerminalTuiPaletteState(),
      open: true,
      view: {
        query: "review",
        total: 1,
        candidates: [
          {
            id: "review",
            group: "session",
            title: "Switch to session [2] s02-review",
            summary: "review session",
            command: "/use 2",
            keywords: ["review"],
          },
        ],
      },
    });

    expect(renderTerminalTuiPaletteBarLines(state)).toContain("focus     [1/1] session /use 2");
    expect(renderTerminalTuiPaletteBarLines(state)).toContain("preview   <<review>> session");
    expect(renderTerminalTuiPaletteLines(state).join("\n")).toContain(
      "/use 2  |  Switch to session [2] s02-<<review>>",
    );
    expect(renderTerminalTuiPaletteLines(state).join("\n")).toContain("group     session");
    expect(renderTerminalTuiPaletteLines(state)).toContain(
      "keys      Enter open | Up/Down/^N/^P move | Esc close",
    );
  });

  it("resolves supported keyboard shortcuts only when the prompt buffer is empty", () => {
    expect(
      resolveTerminalTuiShortcut({
        key: { ctrl: true, name: "g" },
        bufferEmpty: true,
        composerActive: false,
      }),
    ).toEqual({ command: "/help", label: "ctrl+g" });
    expect(
      resolveTerminalTuiShortcut({
        key: { ctrl: true, name: "n" },
        bufferEmpty: true,
        composerActive: false,
      }),
    ).toEqual({ command: "/next", label: "ctrl+n" });
    expect(
      resolveTerminalTuiShortcut({
        key: { ctrl: true, name: "k" },
        bufferEmpty: true,
        composerActive: false,
      }),
    ).toEqual({ command: "/palette", label: "ctrl+k" });
    expect(
      resolveTerminalTuiShortcut({
        key: { ctrl: true, name: "p" },
        bufferEmpty: true,
        composerActive: false,
      }),
    ).toEqual({ command: "/prev", label: "ctrl+p" });
    expect(
      resolveTerminalTuiShortcut({
        key: { ctrl: true, name: "l" },
        bufferEmpty: true,
        composerActive: false,
      }),
    ).toEqual({ command: "/redraw", label: "ctrl+l" });
    expect(
      resolveTerminalTuiShortcut({
        key: { name: "escape" },
        bufferEmpty: true,
        composerActive: true,
      }),
    ).toEqual({ command: "/cancel", label: "esc" });
    expect(
      resolveTerminalTuiShortcut({
        key: { ctrl: true, name: "k" },
        bufferEmpty: false,
        composerActive: false,
      }),
    ).toBeNull();
    expect(
      resolveTerminalTuiShortcut({
        key: { ctrl: true, name: "n" },
        bufferEmpty: false,
        composerActive: false,
      }),
    ).toBeNull();
    expect(
      resolveTerminalTuiShortcut({
        key: { name: "escape" },
        bufferEmpty: true,
        composerActive: false,
      }),
    ).toBeNull();
  });
});
