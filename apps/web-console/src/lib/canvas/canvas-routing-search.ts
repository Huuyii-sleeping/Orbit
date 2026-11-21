import type { XYPosition } from "@xyflow/react";
import {
  segmentBlocked,
  type CanvasPort,
  type CanvasRoutingNode,
  type CanvasSegment,
} from "./canvas-routing-geometry";

/** 最短路图，所有候选端口与障碍物边界都落在同一组坐标上。 */
export interface CanvasRouteGrid {
  xs: number[];
  ys: number[];
  neighbours: { next: number; axis: number; length: number }[][];
}
interface SearchEntry {
  state: number;
  length: number;
  bends: number;
  unshared: number;
  remaining: number;
}
// DOM 测量值和 1/3 间距都有浮点误差，不能让 1e-14 的长度差压过转弯与合并偏好。
const compare = (a: SearchEntry, b: SearchEntry) =>
  Math.abs(a.length - b.length) > 1e-6
    ? a.length - b.length
    : a.bends - b.bends || a.unshared - b.unshared;

// 曼哈顿距离是不穿障碍时的距离下界；只影响搜索次序，不改变真实代价排序。
const comparePriority = (a: SearchEntry, b: SearchEntry) => {
  const distance = a.length + a.remaining - b.length - b.remaining;
  return Math.abs(distance) > 1e-6
    ? distance
    : a.bends - b.bends || a.unshared - b.unshared;
};

class SearchQueue {
  entries: SearchEntry[] = [];
  push(entry: SearchEntry) {
    this.entries.push(entry);
    let i = this.entries.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (comparePriority(this.entries[parent], entry) <= 0) break;
      this.entries[i] = this.entries[parent];
      i = parent;
    }
    this.entries[i] = entry;
  }
  pop() {
    const first = this.entries[0],
      last = this.entries.pop()!;
    if (this.entries.length) {
      let i = 0;
      while (i * 2 + 1 < this.entries.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.entries.length &&
          comparePriority(this.entries[child + 1], this.entries[child]) < 0
        )
          child++;
        if (comparePriority(last, this.entries[child]) <= 0) break;
        this.entries[i] = this.entries[child];
        i = child;
      }
      this.entries[i] = last;
    }
    return first;
  }
}

/** 构建相邻可见点的正交图，预先排除穿越障碍的线段。 */
export function createCanvasRouteGrid(
  nodes: CanvasRoutingNode[],
  ports: CanvasPort[],
  preferred: CanvasSegment[],
  clearance: number,
): CanvasRouteGrid {
  const obstacles = nodes.map((n) => ({
    ...n,
    x: n.x - clearance,
    y: n.y - clearance,
    width: n.width + 2 * clearance,
    height: n.height + 2 * clearance,
  }));
  const xs = [
    ...new Set([
      ...obstacles.flatMap((n) => [n.x, n.x + n.width]),
      ...ports.map((p) => p.exit.x),
      ...preferred.flatMap(([a, b]) => [a.x, b.x]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      ...obstacles.flatMap((n) => [n.y, n.y + n.height]),
      ...ports.map((p) => p.exit.y),
      ...preferred.flatMap(([a, b]) => [a.y, b.y]),
    ]),
  ].sort((a, b) => a - b);
  const neighbours: CanvasRouteGrid["neighbours"] = Array.from(
    { length: xs.length * ys.length },
    () => [],
  );
  for (let y = 0; y < ys.length; y++)
    for (let x = 0; x < xs.length; x++) {
      const index = y * xs.length + x;
      const a = { x: xs[x], y: ys[y] };
      for (const [nx, ny, axis] of [
        [x + 1, y, 0],
        [x, y + 1, 1],
      ]) {
        if (nx >= xs.length || ny >= ys.length) continue;
        const b = { x: xs[nx], y: ys[ny] };
        if (segmentBlocked(a, b, obstacles)) continue;
        const next = ny * xs.length + nx;
        const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        neighbours[index].push({ next, axis, length });
        neighbours[next].push({ next: index, axis, length });
      }
    }
  return { xs, ys, neighbours };
}

/** 优先最短距离，其次最少转弯；等价路径优先复用已有干线。 */
export function searchCanvasRoute(
  grid: CanvasRouteGrid,
  starts: CanvasPort[],
  ends: CanvasPort[],
  preferred: CanvasSegment[],
) {
  if (!starts.length || !ends.length) return;
  const pointAt = (index: number): XYPosition => ({
    x: grid.xs[index % grid.xs.length],
    y: grid.ys[Math.floor(index / grid.xs.length)],
  });
  const indexAt = (p: XYPosition) =>
    grid.ys.indexOf(p.y) * grid.xs.length + grid.xs.indexOf(p.x);
  const size = grid.neighbours.length * 2;
  const costs: (SearchEntry | undefined)[] = new Array(size);
  const previous = new Int32Array(size).fill(-1);
  const roots = new Int32Array(size);
  const queue = new SearchQueue();
  // 端口引线长度独立于场景避障间距，搜索代价需包含两端真实长度。
  const portLength = ({ point, exit }: CanvasPort) =>
    Math.abs(point.x - exit.x) + Math.abs(point.y - exit.y);
  const goals = new Map(ends.map((port) => [indexAt(port.exit), port]));
  const estimates = new Float64Array(grid.neighbours.length).fill(-1);
  const remainingAt = (index: number) => {
    if (estimates[index] < 0) {
      const point = pointAt(index);
      estimates[index] = Math.min(
        ...ends.map(
          (port) =>
            Math.abs(point.x - port.exit.x) +
            Math.abs(point.y - port.exit.y) +
            portLength(port),
        ),
      );
    }
    return estimates[index];
  };
  starts.forEach((port, root) => {
    const entry = {
      state: indexAt(port.exit) * 2 + port.axis,
      length: portLength(port),
      bends: 0,
      unshared: 0,
      remaining: remainingAt(indexAt(port.exit)),
    };
    costs[entry.state] = entry;
    roots[entry.state] = root;
    queue.push(entry);
  });
  let best: { cost: SearchEntry; port: CanvasPort; state: number } | undefined;
  while (queue.entries.length) {
    const current = queue.pop();
    if (costs[current.state] !== current) continue;
    if (best && current.length + current.remaining > best.cost.length + 0.001)
      break;
    const index = Math.floor(current.state / 2),
      axis = current.state % 2;
    const goal = goals.get(index);
    if (goal) {
      const cost = {
        ...current,
        length: current.length + portLength(goal),
        bends: current.bends + Number(axis !== goal.axis),
      };
      if (!best || compare(cost, best.cost) < 0)
        best = { cost, port: goal, state: current.state };
    }
    const a = pointAt(index);
    for (const neighbour of grid.neighbours[index]) {
      const b = pointAt(neighbour.next);
      const shared = preferred.some(([p, q]) =>
        a.x === b.x
          ? p.x === a.x &&
            q.x === a.x &&
            Math.min(a.y, b.y) >= Math.min(p.y, q.y) &&
            Math.max(a.y, b.y) <= Math.max(p.y, q.y)
          : p.y === a.y &&
            q.y === a.y &&
            Math.min(a.x, b.x) >= Math.min(p.x, q.x) &&
            Math.max(a.x, b.x) <= Math.max(p.x, q.x),
      );
      const entry = {
        state: neighbour.next * 2 + neighbour.axis,
        length: current.length + neighbour.length,
        bends: current.bends + Number(axis !== neighbour.axis),
        unshared: current.unshared + (shared ? 0 : neighbour.length),
        remaining: remainingAt(neighbour.next),
      };
      const old = costs[entry.state];
      if (old && compare(old, entry) <= 0) continue;
      costs[entry.state] = entry;
      previous[entry.state] = current.state;
      roots[entry.state] = roots[current.state];
      queue.push(entry);
    }
  }
  if (!best) return;
  const points: XYPosition[] = [];
  let state = best.state;
  while (state !== -1) {
    points.push(pointAt(Math.floor(state / 2)));
    state = previous[state];
  }
  const from = starts[roots[best.state]],
    to = best.port;
  return {
    points: [from.point, ...points.reverse(), to.point],
    from: from.side,
    to: to.side,
    fromHandle: from.id ?? from.side,
    toHandle: to.id ?? to.side,
    length: best.cost.length,
  };
}
