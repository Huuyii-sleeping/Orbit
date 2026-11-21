import { Handle, Position } from "@xyflow/react";
import type { WorkflowNode } from "@orbit/workflow-core";
import type { CanvasPortSpec } from "../../../lib/canvas/canvas-routing";

/** 业务端口的显示和命中区域，与路由共用同一份侧边及比例坐标。 */
export function SopNodePorts({
  node,
  layout,
}: {
  node: WorkflowNode;
  layout: CanvasPortSpec[];
}) {
  return (
    <>
      {layout.map((spec) => {
        const type = spec.type!;
        const port = (
          type === "target" ? node.ports.inputs : node.ports.outputs
        ).find((port) => port.id === spec.id)!;
        const horizontal =
          spec.side === Position.Top || spec.side === Position.Bottom;
        const style = {
          left: horizontal
            ? `${(spec.offset ?? 0.5) * 100}%`
            : spec.side === Position.Left
              ? "0%"
              : "100%",
          top: horizontal
            ? spec.side === Position.Top
              ? "0%"
              : "100%"
            : `${(spec.offset ?? 0.5) * 100}%`,
        };
        return (
          <span
            key={`${type}:${port.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <Handle
              type={type}
              id={port.id}
              position={spec.side}
              className="sop-h"
              style={style}
              aria-label={`${node.label} · ${type === "target" ? "输入" : "输出"} · ${port.name}`}
              title={`${port.name}${port.required ? "（必填）" : ""} · ${port.dataType}`}
            />
            {type === "source" && node.ports.outputs.length > 1 && (
              <span
                className={`sop-port-label sop-port-label--${spec.side}`}
                style={style}
              >
                {port.name}
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}
