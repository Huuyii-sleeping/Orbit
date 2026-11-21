import { useReactFlow, useViewport } from "@xyflow/react";
import {
  Focus,
  Hand,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";

/** 停靠在画布底部的选择、平移、历史与缩放工具。 */
export function SopCanvasDock({
  mode,
  onModeChange,
  onAdd,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFitSelection,
}: {
  mode: "select" | "pan";
  onModeChange: (mode: "select" | "pan") => void;
  onAdd: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFitSelection: () => void;
}) {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="sop-canvas-dock" role="toolbar" aria-label="画布工具">
      <button
        className="sop-float-icon"
        aria-pressed={mode === "select"}
        aria-label="选择工具"
        title="选择 V"
        data-testid="sop-select-mode"
        onClick={() => onModeChange("select")}
      >
        <MousePointer2 size={17} />
      </button>
      <button
        className="sop-float-icon"
        aria-pressed={mode === "pan"}
        aria-label="平移工具"
        title="平移 H / 按住空格"
        data-testid="sop-pan-mode"
        onClick={() => onModeChange("pan")}
      >
        <Hand size={17} />
      </button>
      <i />
      <button
        className="sop-float-icon"
        aria-label="添加节点"
        title="添加节点"
        onClick={onAdd}
      >
        <Plus size={17} />
      </button>
      <button
        className="sop-float-icon"
        aria-label="撤销"
        title="撤销 ⌘ / Ctrl Z"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 size={15} />
      </button>
      <button
        className="sop-float-icon"
        aria-label="重做"
        title="重做"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 size={15} />
      </button>
      <i />
      <button
        className="sop-float-icon"
        aria-label="定位选中"
        title="定位选中"
        onClick={onFitSelection}
      >
        <Focus size={16} />
      </button>
      <button
        className="sop-float-icon"
        aria-label="适合窗口"
        title="适合窗口 Shift 1"
        onClick={() =>
          void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 })
        }
      >
        <Maximize2 size={15} />
      </button>
      <i />
      <button
        className="sop-float-icon"
        aria-label="缩小画布"
        onClick={() => void flow.zoomOut({ duration: 150 })}
      >
        <Minus size={15} />
      </button>
      <button
        className="sop-zoom-value"
        aria-label="重置为100%缩放"
        onClick={() => void flow.zoomTo(1, { duration: 150 })}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        className="sop-float-icon"
        aria-label="放大画布"
        onClick={() => void flow.zoomIn({ duration: 150 })}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
