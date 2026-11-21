import { useState } from "react";
import { Search, X } from "lucide-react";
import type { Node } from "@xyflow/react";
import type { SopFlowData } from "../sop-flow-adapter";
import { getSopNodeMeta } from "../../lib/sop-catalog";

/** 当前容器作用域的图层列表，可按名称或节点类型筛选并定位。 */
export function SopLayersPanel({
  nodes,
  selectedIds,
  onSelect,
  onClose,
}: {
  nodes: Node<SopFlowData>[];
  selectedIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const visible = nodes.filter((n) =>
    `${n.data.node.label} ${getSopNodeMeta(n.data.node.type).label}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <aside className="sop-layers-panel" aria-label="流程图层">
      <header>
        <strong>
          图层 <small>{nodes.length}</small>
        </strong>
        <button
          className="sop-float-icon"
          aria-label="关闭图层"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      <label className="sop-layer-search">
        <Search size={13} />
        <input
          aria-label="筛选图层"
          placeholder="查找节点"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="sop-layer-items">
        {visible.map((node) => {
          const meta = getSopNodeMeta(node.data.node.type);
          const Icon = meta.icon;
          return (
            <button
              key={node.id}
              aria-pressed={selectedIds.has(node.id)}
              onClick={() => onSelect(node.id)}
            >
              <Icon size={14} />
              <span>{node.data.node.label}</span>
              <small>{meta.label}</small>
            </button>
          );
        })}
        {visible.length === 0 && <p>没有匹配的节点</p>}
      </div>
    </aside>
  );
}
