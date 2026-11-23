/** readline TUI 入口；原导出路径保留给现有调用方。 */
export { runTerminalTui, type TerminalTuiOptions } from "../cli/tui/readline.js";
export { handleTerminalTuiCommand } from "../cli/tui/command-handler.js";
export {
  resolveDaemonTuiService,
  type TerminalTuiServiceLike,
  type DaemonTuiServiceResolution,
} from "../cli/tui/service.js";
export { renderTerminalTuiDashboard, type TerminalTuiState } from "../cli/tui/dashboard.js";
export {
  createTerminalTuiPaletteState,
  updateTerminalTuiPaletteState,
  moveTerminalTuiPaletteSelection,
  resolveTerminalTuiPaletteLiveQuery,
  getTerminalTuiSelectedPaletteCandidate,
  highlightTerminalTuiPaletteQuery,
  renderTerminalTuiPaletteLines,
  renderTerminalTuiPaletteBarLines,
  resolveTerminalTuiShortcut,
  type TerminalTuiShortcutKey,
  type TerminalTuiShortcut,
  type TerminalTuiPaletteState,
} from "../cli/tui/palette.js";
