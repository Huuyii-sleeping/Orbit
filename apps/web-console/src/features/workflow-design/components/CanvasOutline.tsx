import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Layers,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  previewNodeKinds,
  type CanvasNode,
  type CanvasNodeData,
} from "../canvas-design-data";

/** 左侧结构导航与节点库，点击图层定位，点击节点种类添加实例。 */
export function CanvasOutline({
  nodes,
  selectedId,
  tab,
  onTabChange,
  onSelect,
  onAdd,
  onClose,
}: {
  nodes: CanvasNode[];
  selectedId: string | null;
  tab: "layers" | "library";
  onTabChange: (tab: "layers" | "library") => void;
  onSelect: (id: string) => void;
  onAdd: (kind: CanvasNodeData["kind"]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <aside className="wc-outline" aria-label="流程结构与节点库">
      <div className="wc-panel-tabs">
        <button
          aria-pressed={tab === "layers"}
          onClick={() => onTabChange("layers")}
        >
          图层
        </button>
        <button
          aria-pressed={tab === "library"}
          onClick={() => onTabChange("library")}
        >
          节点库
        </button>
        <button
          className="wc-icon wc-outline-close"
          aria-label="关闭左侧面板"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <label className="wc-panel-search">
        <Search size={13} />
        <input
          aria-label="筛选节点"
          placeholder={tab === "layers" ? "查找节点…" : "搜索节点类型…"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <kbd>⌕</kbd>
      </label>
      {tab === "layers" ? (
        <>
          <div className="wc-outline-title">
            <ChevronDown size={12} />
            <Layers size={13} />
            <strong>主流程</strong>
            <span>{nodes.length}</span>
          </div>
          <div className="wc-layer-list">
            {nodes
              .filter((node) => node.data.label.includes(query))
              .map((node) => {
                const Icon = previewNodeKinds[node.data.kind].icon;
                return (
                  <button
                    className={`wc-layer ${node.id === selectedId ? "is-active" : ""}`}
                    key={node.id}
                    aria-pressed={node.id === selectedId}
                    onClick={() => onSelect(node.id)}
                  >
                    <Icon size={14} />
                    <span>{node.data.label}</span>
                    {node.data.kind === "condition" && (
                      <ChevronRight size={11} />
                    )}
                  </button>
                );
              })}
          </div>
          <button
            className="wc-add-layer"
            onClick={() => onTabChange("library")}
          >
            <Plus size={13} />
            添加节点
          </button>
        </>
      ) : (
        <div className="wc-library">
          {Object.entries(previewNodeKinds)
            .filter(([, meta]) =>
              `${meta.label}${meta.description}`.includes(query),
            )
            .map(([kind, meta]) => {
              const Icon = meta.icon;
              return (
                <button
                  key={kind}
                  onClick={() => onAdd(kind as CanvasNodeData["kind"])}
                >
                  <span className="wc-library-icon">
                    <Icon size={16} />
                  </span>
                  <span>
                    <strong>{meta.label}</strong>
                    <small>{meta.description}</small>
                  </span>
                  <Plus size={13} />
                </button>
              );
            })}
        </div>
      )}
      <div className="wc-outline-bottom">
        <span className="wc-page-dot" />
        <span>研究简报</span>
        <small>主画布</small>
      </div>
    </aside>
  );
}
