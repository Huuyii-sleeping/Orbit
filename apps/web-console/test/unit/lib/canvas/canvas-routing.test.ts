import { describe, expect, it } from "vitest";
import { Position } from "@xyflow/react";
import { routeCanvasEdges } from "../../../../src/lib/canvas/canvas-routing";

const box = (id: string, x: number, y: number, width = 120, height = 80) => ({
  id,
  x,
  y,
  width,
  height,
});

describe("画板连线路由", () => {
  it("很短的间距直接连接，不因固定端口偏移向后绕线", () => {
    const [edge] = routeCanvasEdges(
      [box("a", 0, 0), box("b", 138, 0)],
      [{ id: "ab", source: "a", target: "b" }],
    );
    expect(edge.data!.route.points).toEqual([
      { x: 120, y: 40 },
      { x: 138, y: 40 },
    ]);
    expect(edge.data!.route.length).toBe(18);
  });

  it("自动选择朝向最近的节点边，包括向上和反向连接", () => {
    const nodes = [box("a", 300, 200), box("b", 0, 200), box("c", 300, 0)];
    const [left, up] = routeCanvasEdges(nodes, [
      { id: "ab", source: "a", target: "b" },
      { id: "ac", source: "a", target: "c" },
    ]);
    expect(left.sourceHandle).toBe(Position.Left);
    expect(left.targetHandle).toBe(Position.Right);
    expect(left.data!.route.length).toBe(180);
    expect(up.sourceHandle).toBe(Position.Top);
    expect(up.targetHandle).toBe(Position.Bottom);
    expect(up.data!.route.length).toBe(120);
  });

  it("非整数测量值不会把安全边界误判成障碍内部", () => {
    const [edge] = routeCanvasEdges(
      [
        box("a", 0, 150, 100, 45),
        box("b", 150, 130, 216, 129),
        box("c", 400, 130, 216, 129),
      ],
      [{ id: "ab", source: "a", target: "b" }],
    );
    expect(edge.sourceHandle).toBe(Position.Right);
    expect(edge.targetHandle).toBe(Position.Left);
    expect(edge.data!.route.length).toBeCloseTo(72);
  });

  it("明确指定的端口保持不变，同时绕过中间节点", () => {
    const blocker = box("block", 190, -20, 100, 120);
    const [edge] = routeCanvasEdges(
      [box("a", 0, 0), blocker, box("b", 400, 0)],
      [
        {
          id: "ab",
          source: "a",
          target: "b",
          sourceHandle: Position.Right,
          targetHandle: Position.Left,
        },
      ],
    );
    const route = edge.data!.route;
    expect(route.blocked).toBe(false);
    expect(route.length).toBe(424);
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1],
        b = route.points[i];
      expect(a.x === b.x || a.y === b.y).toBe(true);
      if (a.y === b.y && a.y > blocker.y && a.y < blocker.y + blocker.height) {
        expect(
          Math.max(a.x, b.x) <= blocker.x ||
            Math.min(a.x, b.x) >= blocker.x + blocker.width,
        ).toBe(true);
      }
      if (a.x === b.x && a.x > blocker.x && a.x < blocker.x + blocker.width) {
        expect(
          Math.max(a.y, b.y) <= blocker.y ||
            Math.min(a.y, b.y) >= blocker.y + blocker.height,
        ).toBe(true);
      }
    }
  });

  it("同一目标的连线共用干线，保持各自最短长度", () => {
    const edges = routeCanvasEdges(
      [box("a", 0, 0), box("b", 0, 240), box("end", 400, 120)],
      [
        {
          id: "ae",
          source: "a",
          target: "end",
          sourceHandle: Position.Right,
          targetHandle: Position.Left,
        },
        {
          id: "be",
          source: "b",
          target: "end",
          sourceHandle: Position.Right,
          targetHandle: Position.Left,
        },
      ],
    );
    expect(edges.map((edge) => edge.data!.route.length)).toEqual([400, 400]);
    const paths = edges.map((edge) => edge.data!.route.points);
    const horizontalAtTarget = paths.map((points) =>
      points
        .slice(1)
        .map((p, i) => [points[i], p])
        .find(([a, b]) => a.y === 160 && b.y === 160),
    );
    expect(horizontalAtTarget[0]).toEqual(horizontalAtTarget[1]);
    expect(
      Math.abs(horizontalAtTarget[0]![1].x - horizontalAtTarget[0]![0].x),
    ).toBeGreaterThan(30);
  });

  it("同一源的分支共享出口干线，标签仍属于各自的边", () => {
    const edges = routeCanvasEdges(
      [box("a", 0, 120), box("b", 400, 0), box("c", 400, 240)],
      [
        {
          id: "ab",
          source: "a",
          target: "b",
          label: "充分",
          sourceHandle: Position.Right,
          targetHandle: Position.Left,
        },
        {
          id: "ac",
          source: "a",
          target: "c",
          label: "待复核",
          sourceHandle: Position.Right,
          targetHandle: Position.Left,
        },
      ],
    );
    expect(edges[0].data!.route.points.slice(0, 2)).toEqual(
      edges[1].data!.route.points.slice(0, 2),
    );
    expect(edges.map((edge) => edge.label)).toEqual(["充分", "待复核"]);
  });

  it("节点遮住固定端口时明确标记冲突，不把穿过节点的线当成正常路由", () => {
    const [edge] = routeCanvasEdges(
      [box("a", 0, 0), box("block", 115, -10), box("b", 400, 0)],
      [
        {
          id: "ab",
          source: "a",
          target: "b",
          sourceHandle: Position.Right,
          targetHandle: Position.Left,
        },
      ],
    );
    expect(edge.data!.route.blocked).toBe(true);
  });
});
