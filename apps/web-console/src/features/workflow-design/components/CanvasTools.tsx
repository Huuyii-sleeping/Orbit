import { useReactFlow, useViewport } from "@xyflow/react";
import { Focus, Hand, Minus, MousePointer2, Plus } from "lucide-react";

/** 画布工具条直接使用 React Flow 的视口能力，避免业务层转发缩放状态。 */
export function CanvasTools({
  panMode,
  onModeChange,
  onAdd,
}: {
  panMode: boolean;
  onModeChange: (mode: "select" | "pan") => void;
  onAdd: () => void;
}) {
  const flow = useReactFlow();
  const viewport = useViewport();
  return (
    <div className="wc-canvas-tools" role="toolbar" aria-label="画布工具">
      <button
        className="wc-icon"
        aria-label="选择工具"
        title="选择 V"
        aria-pressed={!panMode}
        onClick={() => onModeChange("select")}
      >
        <MousePointer2 size={16} />
      </button>
      <button
        className="wc-icon"
        aria-label="平移工具"
        title="平移 H / 按住空格"
        aria-pressed={panMode}
        onClick={() => onModeChange("pan")}
      >
        <Hand size={16} />
      </button>
      <span />
      <button
        className="wc-icon"
        aria-label="添加节点"
        title="添加节点"
        onClick={onAdd}
      >
        <Plus size={18} />
      </button>
      <button
        className="wc-icon"
        aria-label="适合窗口"
        title="适合窗口 Shift+1"
        onClick={() => void flow.fitView({ padding: 0.16, duration: 300 })}
      >
        <Focus size={16} />
      </button>
      <span />
      <button
        className="wc-icon"
        aria-label="缩小画布"
        title="缩小"
        onClick={() => void flow.zoomOut({ duration: 180 })}
      >
        <Minus size={14} />
      </button>
      <button
        className="wc-zoom-label"
        aria-label="重置为100%缩放"
        title="重置为 100%"
        onClick={() => void flow.zoomTo(1, { duration: 200 })}
      >
        {Math.round(viewport.zoom * 100)}%
      </button>
      <button
        className="wc-icon"
        aria-label="放大画布"
        title="放大"
        onClick={() => void flow.zoomIn({ duration: 180 })}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
