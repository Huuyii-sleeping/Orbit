import {
  Position,
  type HandleType,
  type Rect,
  type XYPosition,
} from "@xyflow/react";

/** 路由计算使用节点的真实测量矩形，不依赖节点展示样式。 */
export type CanvasRoutingNode = Rect & { id: string };
/** 一段正交线，供障碍检测与共享干线计算使用。 */
export type CanvasSegment = [XYPosition, XYPosition];
/** 贴在节点边界上的连接点及其朝外的安全出口。 */
export interface CanvasPort {
  id?: string;
  type?: HandleType;
  side: Position;
  point: XYPosition;
  exit: XYPosition;
  axis: number;
}

/** 各端口统一使用所属库的 Position 值作为 Handle ID。 */
export const canvasSides = [
  Position.Right,
  Position.Bottom,
  Position.Left,
  Position.Top,
];

/** 获取节点四边中心的端口。 */
export function canvasPort(
  node: CanvasRoutingNode,
  side: Position,
  clearance: number,
  offset = 0.5,
): CanvasPort {
  const point = {
    x: node.x + node.width * offset,
    y: node.y + node.height * offset,
  };
  if (side === Position.Left) point.x = node.x;
  if (side === Position.Right) point.x = node.x + node.width;
  if (side === Position.Top) point.y = node.y;
  if (side === Position.Bottom) point.y = node.y + node.height;
  const exit = { ...point };
  if (side === Position.Left) exit.x -= clearance;
  if (side === Position.Right) exit.x += clearance;
  if (side === Position.Top) exit.y -= clearance;
  if (side === Position.Bottom) exit.y += clearance;
  return {
    side,
    point,
    exit,
    axis: side === Position.Left || side === Position.Right ? 0 : 1,
  };
}

/** 线段碰到矩形内部即视作阻挡；沿安全边界走线允许通过。 */
export function segmentBlocked(
  a: XYPosition,
  b: XYPosition,
  nodes: CanvasRoutingNode[],
) {
  const epsilon = 1e-6;
  return nodes.some((node) =>
    a.x === b.x
      ? a.x > node.x + epsilon &&
        a.x < node.x + node.width - epsilon &&
        Math.max(a.y, b.y) > node.y + epsilon &&
        Math.min(a.y, b.y) < node.y + node.height - epsilon
      : a.y > node.y + epsilon &&
        a.y < node.y + node.height - epsilon &&
        Math.max(a.x, b.x) > node.x + epsilon &&
        Math.min(a.x, b.x) < node.x + node.width - epsilon,
  );
}

/** 去掉重复点与共线折点，避免短连接出现多余折返。 */
export function simplifyCanvasPath(points: XYPosition[]) {
  const result: XYPosition[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    const previous = result.at(-2);
    if (
      previous &&
      last &&
      ((previous.x === last.x && last.x === point.x) ||
        (previous.y === last.y && last.y === point.y))
    )
      result.pop();
    result.push(point);
  }
  return result;
}

/** 将正交折线转为轻微圆角 SVG；半径受相邻短线段长度约束。 */
export function canvasPath(points: XYPosition[]) {
  if (!points.length) return "";
  let path = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1];
    const before = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const after = Math.abs(c.x - b.x) + Math.abs(c.y - b.y);
    const radius = Math.min(5, before / 2, after / 2);
    const p = {
      x: b.x + ((a.x - b.x) / before) * radius,
      y: b.y + ((a.y - b.y) / before) * radius,
    };
    const q = {
      x: b.x + ((c.x - b.x) / after) * radius,
      y: b.y + ((c.y - b.y) / after) * radius,
    };
    path += ` L ${p.x},${p.y} Q ${b.x},${b.y} ${q.x},${q.y}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x},${last.y}`;
}
