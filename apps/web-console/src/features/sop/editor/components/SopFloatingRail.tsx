import { Layers, Plus, SlidersHorizontal, Terminal } from "lucide-react";

/** 沿画布左侧悬浮的面板入口，面板覆盖画布而不改变节点位置。 */
export function SopFloatingRail({
  leftPanel,
  inspectorOpen,
  runOpen,
  onLayers,
  onPalette,
  onInspector,
  onRun,
}: {
  leftPanel: "layers" | "palette" | null;
  inspectorOpen: boolean;
  runOpen: boolean;
  onLayers: () => void;
  onPalette: () => void;
  onInspector: () => void;
  onRun: () => void;
}) {
  return (
    <nav className="sop-floating-rail" aria-label="画布面板">
      <button
        className="sop-float-icon"
        aria-label="切换图层"
        title="图层"
        aria-pressed={leftPanel === "layers"}
        onClick={onLayers}
      >
        <Layers size={17} />
      </button>
      <button
        className="sop-float-icon"
        aria-label="切换节点库"
        title="节点库"
        aria-pressed={leftPanel === "palette"}
        onClick={onPalette}
      >
        <Plus size={19} />
      </button>
      <button
        className="sop-float-icon"
        aria-label="切换配置面板"
        title="配置"
        aria-pressed={inspectorOpen}
        onClick={onInspector}
      >
        <SlidersHorizontal size={17} />
      </button>
      <i />
      <button
        className="sop-float-icon"
        aria-label="切换运行控制台"
        title="运行控制台"
        aria-pressed={runOpen}
        onClick={onRun}
      >
        <Terminal size={17} />
      </button>
    </nav>
  );
}
