import { Position } from "@xyflow/react";
import { migrateSopDraftV1 } from "@orbit/workflow-core";
import { describe, expect, it } from "vitest";
import { getSopPortLayouts } from "../../../../../src/features/sop/editor/sop-port-layout";
import {
  toFlowEdges,
  toFlowNodes,
} from "../../../../../src/features/sop/editor/sop-flow-adapter";

function fixture(x: number, y: number) {
  const draft = migrateSopDraftV1({
    id: "ports",
    name: "端口测试",
    summary: "",
    updatedAt: 1,
    nodes: [
      { id: "s", type: "template", label: "来源", position: { x: 0, y: 0 } },
      { id: "t", type: "end", label: "目标", position: { x, y } },
    ],
    edges: [{ id: "st", source: "s", target: "t" }],
  });
  return { nodes: toFlowNodes(draft), edges: toFlowEdges(draft) };
}

describe("业务端口自动择边", () => {
  it("纵向用上下端口，横向用左右端口，保持业务 ID", () => {
    for (const [x, y, source, target] of [
      [0, 200, Position.Bottom, Position.Top],
      [400, 0, Position.Right, Position.Left],
    ] as const) {
      const { nodes, edges } = fixture(x, y);
      const layout = getSopPortLayouts(nodes, edges);
      expect(layout.get("s")!.find((p) => p.type === "source")).toMatchObject({
        id: edges[0].sourceHandle,
        side: source,
      });
      expect(layout.get("t")![0]).toMatchObject({
        id: edges[0].targetHandle,
        side: target,
      });
    }
  });

  it("对角线附近轻移不跳边，明显换向才更新", () => {
    const initial = fixture(400, 0);
    const previous = getSopPortLayouts(initial.nodes, initial.edges);
    const near = fixture(400, 200);
    const held = getSopPortLayouts(near.nodes, near.edges, previous);
    expect(held.get("s")!.find((p) => p.type === "source")!.side).toBe(
      Position.Right,
    );
    const far = fixture(400, 300);
    expect(
      getSopPortLayouts(far.nodes, far.edges, held)
        .get("s")!
        .find((p) => p.type === "source")!.side,
    ).toBe(Position.Bottom);
  });

  it("分支同侧等距排列，每个端口仅出现一次", () => {
    const { nodes, edges } = fixture(0, 300);
    nodes[0].data.node.ports.outputs.push({
      ...nodes[0].data.node.ports.outputs[0],
      id: "other",
      name: "其他",
    });
    edges.push({ ...edges[0], id: "other-edge", sourceHandle: "other" });
    const outputs = getSopPortLayouts(nodes, edges)
      .get("s")!
      .filter((p) => p.type === "source");
    expect(outputs).toHaveLength(2);
    expect(outputs.map((p) => [p.side, p.offset])).toEqual([
      [Position.Bottom, 1 / 3],
      [Position.Bottom, 2 / 3],
    ]);
  });

  it("输入输出同名时以类型区分各自方向", () => {
    const { nodes, edges } = fixture(400, 0);
    nodes[0].data.node.ports.outputs[0].id = "in";
    edges[0].sourceHandle = "in";
    expect(getSopPortLayouts(nodes, edges).get("s")).toEqual([
      { id: "in", type: "target", side: Position.Left, offset: 0.5 },
      { id: "in", type: "source", side: Position.Right, offset: 0.5 },
    ]);
  });
});
