import type { DragEvent } from "react";
import type { BuiltinNodeType } from "@orbit/workflow-core";
import { X } from "lucide-react";
import { useState } from "react";
import { sopNodeCatalog } from "../../lib/sop-catalog";

/** 由 NodeDefinition registry 驱动的节点库。 */
export function SopPalette({ open, onAdd, onClose }: { open: boolean; onAdd: (type: BuiltinNodeType) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  if (!open) return null;
  const startDrag = (event: DragEvent, type: BuiltinNodeType) => {
    event.dataTransfer.setData("application/sop-node", type);
    event.dataTransfer.effectAllowed = "move";
  };
  return (
    <aside className={`sop-pal ${open ? "is-open" : ""}`} aria-label="节点库">
      <div className="sop-panel-head">
        <div><div className="sop-pal-h">节点库</div><div className="sop-pal-hint">拖入画布，或点击添加</div></div>
        <button type="button" className="sop-panel-close" aria-label="关闭节点库" onClick={onClose}><X aria-hidden="true" /></button>
      </div>
      <label className="sop-palette-search"><input aria-label="筛选节点库" placeholder="查找节点" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {sopNodeCatalog.filter((meta) => `${meta.label} ${meta.desc}`.toLowerCase().includes(query.toLowerCase())).map((meta) => {
        const Icon = meta.icon;
        return (
          <button type="button" key={meta.type} className="sop-pal-item" draggable onDragStart={(event) => startDrag(event, meta.type)} onClick={() => onAdd(meta.type)}>
            <span className="sop-pal-ic"><Icon width={16} height={16} aria-hidden="true" /></span>
            <div><div className="sop-pal-nm">{meta.label}</div><div className="sop-pal-ds">{meta.desc}</div></div>
          </button>
        );
      })}
    </aside>
  );
}
