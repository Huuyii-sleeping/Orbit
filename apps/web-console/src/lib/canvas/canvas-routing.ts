import {
  Position,
  type Edge,
  type HandleType,
  type XYPosition,
} from "@xyflow/react";
import {
  canvasPort,
  canvasSides,
  segmentBlocked,
  simplifyCanvasPath,
  type CanvasRoutingNode,
  type CanvasSegment,
} from "./canvas-routing-geometry";
import {
  createCanvasRouteGrid,
  searchCanvasRoute,
} from "./canvas-routing-search";

/** 一条边的几何路径；blocked 会在 UI 中明确显示端口被遮挡。 */
export interface CanvasRoute {
  points: XYPosition[];
  length: number;
  blocked: boolean;
}
/** 仅展示时派生的路由结果，不写回工作流或导出文档。 */
export type CanvasRoutedEdge = Edge<{ route: CanvasRoute }, "smart">;
/** 业务端口的显示位置；ID 始终保留原有协议语义。 */
export interface CanvasPortSpec {
  id: string;
  side: Position;
  offset?: number;
  type?: HandleType;
}

/** 路由时按实际间距缩小安全边距，解决近距离节点的折线回绕。 */
function sceneClearance(nodes: CanvasRoutingNode[]) {
  let clearance = 12;
  nodes.forEach((a, i) =>
    nodes.slice(i + 1).forEach((b) => {
      const gap = Math.max(
        a.x - b.x - b.width,
        b.x - a.x - a.width,
        a.y - b.y - b.height,
        b.y - a.y - a.height,
      );
      if (gap > 0) clearance = Math.min(clearance, gap / 3);
    }),
  );
  return clearance;
}

/** 端口直线段只按正前方的障碍缩短，避免旁侧窄缝把箭头挤到转弯处。 */
function portWithClearance(
  node: CanvasRoutingNode,
  side: Position,
  nodes: CanvasRoutingNode[],
  offset?: number,
) {
  const port = canvasPort(node, side, 12, offset);
  let clearance = 12;
  for (const other of nodes) {
    if (other.id === node.id) continue;
    const { x, y } = port.point;
    let gap: number | undefined;
    if (side === Position.Top || side === Position.Bottom) {
      if (x < other.x || x > other.x + other.width) continue;
      gap = side === Position.Top ? y - other.y - other.height : other.y - y;
    } else {
      if (y < other.y || y > other.y + other.height) continue;
      gap = side === Position.Left ? x - other.x - other.width : other.x - x;
    }
    if (gap > 0) clearance = Math.min(clearance, gap / 3);
  }
  return canvasPort(node, side, clearance, offset);
}

/** 同源/同目标预留公共通道，只有距离和转弯数相同时才优先选它。 */
function sharedChannels(nodes: Map<string, CanvasRoutingNode>, edges: Edge[]) {
  const channels: { segment: CanvasSegment; members: Set<string> }[] = [];
  for (const kind of ["source", "target"] as const) {
    const groups = new Map<string, Edge[]>();
    for (const edge of edges) {
      const key = `${edge[kind]}:${edge[kind === "source" ? "sourceHandle" : "targetHandle"] ?? "auto"}`;
      groups.set(key, [...(groups.get(key) ?? []), edge]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const root = nodes.get(group[0][kind])!;
      const peers = group.map(
        (e) => nodes.get(e[kind === "source" ? "target" : "source"])!,
      );
      // 水平和竖直布局都支持公共干线，分组端口不同则不强行合并。
      for (const axis of ["x", "y"] as const) {
        const extent = axis === "x" ? "width" : "height";
        const cross = axis === "x" ? "y" : "x";
        const crossExtent = axis === "x" ? "height" : "width";
        const rootEnd = root[axis] + root[extent];
        let lane: number;
        if (peers.every((p) => p[axis] > rootEnd))
          lane = (rootEnd + Math.min(...peers.map((p) => p[axis]))) / 2;
        else if (peers.every((p) => p[axis] + p[extent] < root[axis]))
          lane =
            (root[axis] + Math.max(...peers.map((p) => p[axis] + p[extent]))) /
            2;
        else continue;
        const centers = [root, ...peers].map(
          (p) => p[cross] + p[crossExtent] / 2,
        );
        const segment: CanvasSegment =
          axis === "x"
            ? [
                { x: lane, y: Math.min(...centers) },
                { x: lane, y: Math.max(...centers) },
              ]
            : [
                { x: Math.min(...centers), y: lane },
                { x: Math.max(...centers), y: lane },
              ];
        channels.push({
          segment,
          members: new Set(group.map((edge) => edge.id)),
        });
      }
    }
  }
  return channels;
}

/** 为全部连线统一计算避障正交最短路；手动选择的端口固定，默认连接自动择边。 */
export function routeCanvasEdges(
  nodes: CanvasRoutingNode[],
  edges: Edge[],
  portSpecs?: ReadonlyMap<string, CanvasPortSpec[]>,
): CanvasRoutedEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const clearance = sceneClearance(nodes);
  const channels = sharedChannels(byId, edges);
  const ports = new Map(
    nodes.map((node) => [
      node.id,
      portSpecs?.has(node.id)
        ? portSpecs
            .get(node.id)!
            .map((spec) => ({
              ...portWithClearance(node, spec.side, nodes, spec.offset),
              id: spec.id,
              type: spec.type,
            }))
        : canvasSides.map((side) => portWithClearance(node, side, nodes)),
    ]),
  );
  const grid = createCanvasRouteGrid(
    nodes,
    [...ports.values()].flat(),
    channels.map((c) => c.segment),
    clearance,
  );
  const routed: { edge: Edge; points: XYPosition[] }[] = [];
  return edges.map((edge) => {
    const preferred = channels
      .filter((c) => c.members.has(edge.id))
      .map((c) => c.segment);
    for (const previous of routed) {
      if (
        !(
          (previous.edge.source === edge.source &&
            previous.edge.sourceHandle === edge.sourceHandle) ||
          (previous.edge.target === edge.target &&
            previous.edge.targetHandle === edge.targetHandle)
        )
      )
        continue;
      for (let i = 1; i < previous.points.length; i++)
        preferred.push([previous.points[i - 1], previous.points[i]]);
    }
    const available = (
      id: string,
      handle: string | null | undefined,
      type: HandleType,
    ) =>
      ports.get(id)!.filter(
        (port) =>
          (!handle || (port.id ?? port.side) === handle) &&
          (!port.type || port.type === type) &&
          !segmentBlocked(
            port.point,
            port.exit,
            nodes.filter((n) => n.id !== id),
          ),
      );
    const result = searchCanvasRoute(
      grid,
      available(edge.source, edge.sourceHandle, "source"),
      available(edge.target, edge.targetHandle, "target"),
      preferred,
    );
    // 无可行路径时仍绘制真实端口位置，避免诊断边指向错误锚点。
    const from =
      ports
        .get(edge.source)!
        .find(
          (port) =>
            (!port.type || port.type === "source") &&
            (port.id ?? port.side) === edge.sourceHandle,
        ) ?? canvasPort(byId.get(edge.source)!, Position.Right, clearance);
    const to =
      ports
        .get(edge.target)!
        .find(
          (port) =>
            (!port.type || port.type === "target") &&
            (port.id ?? port.side) === edge.targetHandle,
        ) ?? canvasPort(byId.get(edge.target)!, Position.Left, clearance);
    const points = result
      ? simplifyCanvasPath(result.points)
      : [from.point, to.point];
    if (result) routed.push({ edge, points });
    return {
      ...edge,
      type: "smart",
      sourceHandle: result?.fromHandle ?? edge.sourceHandle ?? from.side,
      targetHandle: result?.toHandle ?? edge.targetHandle ?? to.side,
      data: {
        route: { points, length: result?.length ?? 0, blocked: !result },
      },
    };
  });
}
