import { memo } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { getSopNodeMeta } from "../lib/sop-catalog";
import type { SopFlowData } from "../editor/sop-flow-adapter";
import { SopNodePorts } from "./SopNodePorts";

/** React Flow 节点只负责将 workflow-core 的类型化端口渲染为 Handle。 */
function SopNodeViewComponent({ data, selected }: NodeProps<Node<SopFlowData>>) {
  const { node, collapsed, issueCount, runStatus, runAttempt } = data;
  const meta = getSopNodeMeta(node.type);
  const Icon = meta.icon;

  return (
    <div
      className={`sop-node ${selected ? "on" : ""} ${runStatus ? `run-${runStatus}` : ""}`}
    >
      <SopNodePorts node={node} layout={data.portLayout ?? []} />

      <div className="sop-node-h">
        <Icon width={13} height={13} aria-hidden="true" />
        <span>{meta.label}</span>
      </div>
      <div className="sop-node-label">{node.label}</div>
      {runStatus ? (
        <div className={`sop-node-runtime ${runStatus}`}>
          <span aria-hidden="true" />
          {runStatus}
          {runAttempt ? ` · ${runAttempt}` : ""}
        </div>
      ) : null}
      {issueCount ? <div className="sop-node-issue">{issueCount}</div> : null}
      {!collapsed && node.kind === "builtin" && node.type === "llm" ? (
        <div className="sop-node-tag">{node.config.model}</div>
      ) : null}
      {!collapsed && node.kind === "builtin" && node.type === "condition" ? (
        <div className="sop-node-tag">if {node.config.expression}</div>
      ) : null}
      {!collapsed && node.kind === "builtin" && node.type === "parallel" ? (
        <div className="sop-node-tag">
          {node.config.branches.length} branches · max{" "}
          {node.config.maxConcurrency}
        </div>
      ) : null}
      {!collapsed && node.kind === "builtin" && node.type === "iteration" ? (
        <div className="sop-node-tag">
          foreach · max {node.config.maxConcurrency}
        </div>
      ) : null}
      {!collapsed && node.kind === "builtin" && node.type === "loop" ? (
        <div className="sop-node-tag">
          {node.config.mode} · {node.config.maxIterations} 次
        </div>
      ) : null}
      {!collapsed && node.kind === "builtin" && node.type === "subworkflow" ? (
        <div className="sop-node-tag">
          {node.config.versionId || "未选择版本"}
        </div>
      ) : null}
      {!collapsed && node.kind === "builtin" && node.type === "agent" ? (
        <div className="sop-node-tag">
          {node.config.agentVersionId || "未选择 Agent"}
        </div>
      ) : null}
      {!collapsed &&
      node.kind === "builtin" &&
      node.type === "human-approval" ? (
        <div className="sop-node-tag">
          {node.config.policyId || "未选择审批策略"}
        </div>
      ) : null}
      {!collapsed && node.description ? (
        <div className="sop-node-note">{node.description}</div>
      ) : null}
      {node.kind === "unknown" ? (
        <div className="sop-node-tag">未安装节点</div>
      ) : null}

    </div>
  );
}

/** 仅在节点数据或选择状态变化时重渲染。 */
export const SopNodeView = memo(SopNodeViewComponent);
