import { useMemo } from "react";
import {
  BaseEdge,
  useStore,
  type ConnectionLineComponentProps,
  type EdgeProps,
} from "@xyflow/react";
import { canvasPath } from "../../../lib/canvas/canvas-routing-geometry";
import { routeCanvasEdges, type CanvasRoutedEdge } from "../../../lib/canvas/canvas-routing";
import type { CanvasNode } from "../canvas-design-data";

/** 智能边使用统一路由的结果，重合干线保持相同颜色与线宽。 */
export function CanvasSmartEdge({
  id,
  data,
  label,
  selected,
}: EdgeProps<CanvasRoutedEdge>) {
  if (!data) return null;
  const { route } = data;
  const path = canvasPath(route.points);
  const end = route.points.at(-1)!;
  const previous = route.points.at(-2)!;
  const angle =
    (Math.atan2(end.y - previous.y, end.x - previous.x) * 180) / Math.PI;
  const middle = Math.max(1, Math.floor(route.points.length / 2));
  const a = route.points[middle - 1],
    b = route.points[middle];
  const color = route.blocked
    ? "var(--wc-error, #c54141)"
    : selected
      ? "var(--wc-blue)"
      : "var(--wc-muted)";
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: selected ? 2 : 1.3,
          strokeDasharray: route.blocked ? "5 4" : undefined,
        }}
        interactionWidth={18}
      />
      <path
        d="M -7,-3 L 0,0 L -7,3"
        fill="none"
        stroke={color}
        strokeWidth={1.3}
        transform={`translate(${end.x},${end.y}) rotate(${angle})`}
      />
      {(label || route.blocked) && (
        <text
          className="wc-route-label"
          x={(a.x + b.x) / 2}
          y={(a.y + b.y) / 2 - 9}
          textAnchor="middle"
          fill={color}
        >
          {route.blocked ? "端口被遮挡" : label}
        </text>
      )}
    </>
  );
}

/** 拉线时同样避障；靠近端口后立即显示最终路径。 */
export function CanvasSmartConnection({
  fromNode,
  toNode,
  fromPosition,
  toPosition,
  toX,
  toY,
  connectionStatus,
}: ConnectionLineComponentProps<CanvasNode>) {
  const lookup = useStore((state) => state.nodeLookup);
  const route = useMemo(() => {
    const nodes = [...lookup.values()].map((n) => ({
      id: n.id,
      x: n.internals.positionAbsolute.x,
      y: n.internals.positionAbsolute.y,
      width: n.measured.width ?? 216,
      height: n.measured.height ?? 128,
    }));
    // 游离端点是一个零尺寸节点，吸附后替换为目标的真实矩形。
    const target = toNode?.id ?? "__canvas-pointer__";
    if (!toNode)
      nodes.push({ id: target, x: toX, y: toY, width: 0, height: 0 });
    const edge = routeCanvasEdges(nodes, [
      {
        id: "preview",
        source: fromNode.id,
        target,
        sourceHandle: fromPosition,
        targetHandle: toNode ? toPosition : undefined,
      },
    ])[0];
    return edge.data!.route;
  }, [lookup, fromNode.id, toNode?.id, fromPosition, toPosition, toX, toY]);
  const invalid = connectionStatus === "invalid" || route.blocked;
  return (
    <path
      className="react-flow__connection-path"
      d={canvasPath(route.points)}
      fill="none"
      style={{
        stroke: invalid ? "#c54141" : "var(--wc-blue)",
        strokeWidth: 1.5,
        strokeDasharray: connectionStatus === "valid" ? undefined : "5 4",
      }}
    />
  );
}
