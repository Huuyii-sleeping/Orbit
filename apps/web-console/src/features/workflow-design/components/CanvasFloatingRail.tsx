import { Layers, PanelRight, Plus, Terminal } from "lucide-react";

/** 自由画布的悬浮面板入口。 */
export function CanvasFloatingRail({
  leftOpen,
  outlineTab,
  inspectorOpen,
  runOpen,
  onToggleLayers,
  onToggleLibrary,
  onToggleInspector,
  onToggleRun,
}: {
  leftOpen: boolean;
  outlineTab: "layers" | "library";
  inspectorOpen: boolean;
  runOpen: boolean;
  onToggleLayers: () => void;
  onToggleLibrary: () => void;
  onToggleInspector: () => void;
  onToggleRun: () => void;
}) {
  return (
    <nav className="wc-floating-rail" aria-label="画布面板">
      <button
        className="wc-icon"
        title="图层"
        aria-label="打开图层"
        aria-pressed={leftOpen && outlineTab === "layers"}
        onClick={onToggleLayers}
      >
        <Layers size={17} />
      </button>
      <button
        className="wc-icon"
        title="添加节点"
        aria-label="打开节点库"
        aria-pressed={leftOpen && outlineTab === "library"}
        onClick={onToggleLibrary}
      >
        <Plus size={19} />
      </button>
      <div />
      <button
        className="wc-icon"
        title="属性"
        aria-label="切换属性面板"
        aria-pressed={inspectorOpen}
        onClick={() => onToggleInspector()}
      >
        <PanelRight size={17} />
      </button>
      <button
        className="wc-icon"
        title="运行记录"
        aria-label="切换运行记录"
        aria-pressed={runOpen}
        onClick={() => onToggleRun()}
      >
        <Terminal size={17} />
      </button>
    </nav>
  );
}
