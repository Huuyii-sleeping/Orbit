import { useId, useMemo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useStoreApi,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps,
  type Node,
} from "@xyflow/react";
import { canvasPath } from "../../../lib/canvas/canvas-routing-geometry";
import { routeSopEdges } from "../editor/sop-canvas-routing";
import type { SopFlowData, SopFlowEdgeData } from "../editor/sop-flow-adapter";

/** 使用共享路由绘制连线，运行与诊断状态统一映射为工作台主题色。 */
export function SopEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  selected,
  data,
}: EdgeProps<Edge<SopFlowEdgeData>>) {
  const route = data?.route;
  const markerId = `sop-arrow-${useId().replaceAll(":", "")}`;
  const fallback = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    offset: 8,
    borderRadius: 5,
  });
  const path = route ? canvasPath(route.points) : fallback[0];
  const segment = route ? Math.max(1, Math.floor(route.points.length / 2)) : 0;
  const labelX = route
    ? (route.points[segment - 1].x + route.points[segment].x) / 2
    : fallback[1];
  const labelY = route
    ? (route.points[segment - 1].y + route.points[segment].y) / 2 - 10
    : fallback[2];
  const needsRepair = data?.status === "needs-repair" || route?.blocked;
  const stroke = selected
    ? "var(--text-main)"
    : needsRepair
      ? "var(--danger)"
      : data?.runtimeActive || data?.runtimeTraversed
        ? "var(--accent)"
        : "var(--text-muted)";
  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 8 8"
          markerWidth={8}
          markerHeight={8}
          refX={7}
          refY={4}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 1,1 L 7,4 L 1,7 Z" fill={stroke} stroke="none" />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        markerEnd={`url(#${markerId})`}
        style={{
          stroke,
          strokeWidth: selected || data?.runtimeActive ? 1.8 : 1.2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          strokeDasharray: needsRepair ? "5 4" : undefined,
          opacity: data?.runtimeExcluded ? 0.3 : selected ? 1 : 0.8,
        }}
      />
      {(label || route?.blocked) && (
        <EdgeLabelRenderer>
          <div
            className="sop-edge-label nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            {route?.blocked ? "端口被遮挡" : label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** 拉线时根据真实类型化端口计算避障预览，与落点后的路径一致。 */
export function SopConnectionLine({
  fromNode,
  toNode,
  fromHandle,
  toHandle,
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionStatus,
}: ConnectionLineComponentProps<Node<SopFlowData>>) {
  const store = useStoreApi<Node<SopFlowData>, Edge<SopFlowEdgeData>>();
  const path = useMemo(() => {
    if (!toNode || !toHandle)
      return getSmoothStepPath({
        sourceX: fromX,
        sourceY: fromY,
        targetX: toX,
        targetY: toY,
        sourcePosition: fromPosition,
        targetPosition: toPosition,
        offset: 8,
        borderRadius: 5,
      })[0];
    const source = fromHandle.type === "source" ? fromNode : toNode;
    const target = fromHandle.type === "source" ? toNode : fromNode;
    const sourceHandle =
      fromHandle.type === "source" ? fromHandle.id : toHandle.id;
    const targetHandle =
      fromHandle.type === "source" ? toHandle.id : fromHandle.id;
    const nodes = store.getState().nodes;
    const [edge] = routeSopEdges(
      nodes,
      [
        {
          id: "connection-preview",
          source: source.id,
          target: target.id,
          sourceHandle,
          targetHandle,
          data: { status: "valid" },
        },
      ],
      new Map(
        nodes
          .filter((node) => node.data.portLayout)
          .map((node) => [node.id, node.data.portLayout!]),
      ),
    );
    return canvasPath(edge.data!.route!.points);
  }, [
    store,
    fromNode,
    toNode,
    fromHandle,
    toHandle,
    fromX,
    fromY,
    toX,
    toY,
    fromPosition,
    toPosition,
  ]);
  return (
    <path
      className="sop-connection-line"
      d={path}
      fill="none"
      style={{
        stroke:
          connectionStatus === "invalid" ? "var(--danger)" : "var(--accent)",
        strokeWidth: 1.5,
        strokeDasharray: connectionStatus === "valid" ? undefined : "5 4",
      }}
    />
  );
}
