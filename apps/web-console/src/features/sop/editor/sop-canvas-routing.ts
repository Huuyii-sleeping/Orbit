import { type Edge, type Node } from "@xyflow/react";
import {
  routeCanvasEdges,
  type CanvasPortSpec,
} from "../../../lib/canvas/canvas-routing";
import type { SopFlowData, SopFlowEdgeData } from "./sop-flow-adapter";
import { getSopPortLayouts } from "./sop-port-layout";

/** 将业务端口布局传入共享路由，派生几何路径而不改写端口 ID、分支或运行状态。 */
export function routeSopEdges(
  nodes: Node<SopFlowData>[],
  edges: Edge<SopFlowEdgeData>[],
  specs: ReadonlyMap<string, CanvasPortSpec[]> = getSopPortLayouts(
    nodes,
    edges,
  ),
) {
  const boxes = nodes.map((node) => ({
    id: node.id,
    ...node.position,
    width: node.measured?.width ?? 216,
    height: node.measured?.height ?? 100,
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const connected = edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  const routes = new Map(
    routeCanvasEdges(boxes, connected, specs).map((edge) => [
      edge.id,
      edge.data!.route,
    ]),
  );
  return edges.map((edge) => ({
    ...edge,
    data: { ...edge.data!, route: routes.get(edge.id) },
  }));
}
