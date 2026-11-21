import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { previewNodeKinds, type CanvasNode } from "../canvas-design-data";
import { canvasSides } from "../../../lib/canvas/canvas-routing-geometry";

/** 三种布局共享的节点，节点形态由编辑器方向控制。 */
export function CanvasPreviewNode({ data, selected }: NodeProps<CanvasNode>) {
  const meta = previewNodeKinds[data.kind];
  const Icon = meta.icon;
  const terminal = data.kind === "start" || data.kind === "end";
  return (
    <div
      className={`wc-node ${terminal ? "wc-terminal" : ""} ${selected ? "is-selected" : ""}`}
      data-tone={meta.tone}
    >
      {canvasSides.map((side) => (
        <Handle
          key={side}
          id={side}
          type={data.kind === "end" ? "target" : "source"}
          position={side}
          aria-label={`${data.label} · ${{ [Position.Left]: "左", [Position.Right]: "右", [Position.Top]: "上", [Position.Bottom]: "下" }[side]}连接点`}
        />
      ))}
      <div className="wc-node-head">
        <span className="wc-node-icon">
          <Icon size={15} />
        </span>
        <span className="wc-node-kind">{meta.label}</span>
        <MoreHorizontal className="wc-node-more" size={14} />
      </div>
      <div className="wc-node-name">{data.label}</div>
      {!terminal && (
        <>
          <p className="wc-node-description">{data.description}</p>
          <div className="wc-node-detail">
            {data.kind === "research" ? (
              <>
                <span className="wc-agent-dot" />
                研究助手<span className="wc-node-chip">网页检索</span>
              </>
            ) : (
              meta.detail
            )}
            <ChevronRight size={11} />
          </div>
        </>
      )}
      <div className="wc-node-port">
        <span>{meta.output}</span>
        <small>{data.kind === "research" ? "object" : "output"}</small>
      </div>
    </div>
  );
}
