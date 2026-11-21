import { describe, expect, it } from "vitest";
import { routeSopEdges } from "../../../../../src/features/sop/editor/sop-canvas-routing";
import {
  toFlowEdges,
  toFlowNodes,
  toWorkflowGraph,
} from "../../../../../src/features/sop/editor/sop-flow-adapter";
import { migrateSopDraftV1 } from "@orbit/workflow-core";
import { createLargeWorkflowFixture } from "../../../../../src/features/sop/editor/sop-performance-fixture";
import { Position } from "@xyflow/react";

describe("正式画布的端口路由", () => {
  it("保留业务端口、分支标签、运行状态，并且不将路径写入工作流", () => {
    const draft = migrateSopDraftV1({
      id: "routing",
      name: "route",
      summary: "",
      updatedAt: 1,
      nodes: [
        { id: "s", type: "start", label: "开始", position: { x: 0, y: 0 } },
        { id: "e", type: "end", label: "结束", position: { x: 400, y: 0 } },
      ],
      edges: [{ id: "se", source: "s", target: "e" }],
    });
    const nodes = toFlowNodes(draft);
    const edges = toFlowEdges(draft).map((edge) => ({
      ...edge,
      label: "成功",
      data: { ...edge.data!, runtimeTraversed: true },
    }));
    const [routed] = routeSopEdges(nodes, edges);
    expect(routed.sourceHandle).toBe(edges[0].sourceHandle);
    expect(routed.targetHandle).toBe(edges[0].targetHandle);
    expect(routed.label).toBe("成功");
    expect(routed.data).toMatchObject({
      runtimeTraversed: true,
      route: { blocked: false },
    });
    expect(routed.data!.route!.points).toEqual([
      { x: 216, y: 50 },
      { x: 400, y: 50 },
    ]);
    expect(toWorkflowGraph(nodes, [routed]).edges[0]).not.toHaveProperty(
      "route",
    );
  });

  it("输入输出同名时仍从输出侧发出连线", () => {
    const draft = migrateSopDraftV1({
      id: "same-port",
      name: "route",
      summary: "",
      updatedAt: 1,
      nodes: [
        { id: "s", type: "template", label: "模板", position: { x: 0, y: 0 } },
        { id: "e", type: "end", label: "结束", position: { x: -400, y: 0 } },
      ],
      edges: [{ id: "se", source: "s", target: "e" }],
    });
    const nodes = toFlowNodes(draft);
    nodes[0].data.node.ports.outputs[0].id = "in";
    const edges = toFlowEdges(draft).map((edge) => ({
      ...edge,
      sourceHandle: "in",
    }));
    const [routed] = routeSopEdges(
      nodes,
      edges,
      new Map([
        [
          "s",
          [
            { id: "in", type: "target", side: Position.Left },
            { id: "in", type: "source", side: Position.Right },
          ],
        ],
        ["e", [{ id: "in", type: "target", side: Position.Left }]],
      ]),
    );
    expect(routed.data!.route!.blocked).toBe(false);
    expect(routed.data!.route!.points[0]).toEqual({ x: 216, y: 50 });
  });

  it("200 节点 / 400 边路由保持可交互的计算预算", () => {
    const draft = createLargeWorkflowFixture();
    const started = performance.now();
    const routed = routeSopEdges(toFlowNodes(draft), toFlowEdges(draft));
    expect(routed).toHaveLength(400);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("纵向排列从下方直连上方，不绕过节点整行", () => {
    const draft = migrateSopDraftV1({
      id: "vertical",
      name: "vertical",
      summary: "",
      updatedAt: 1,
      nodes: [
        { id: "s", type: "start", label: "开始", position: { x: 0, y: 0 } },
        { id: "e", type: "end", label: "结束", position: { x: 0, y: 200 } },
      ],
      edges: [{ id: "se", source: "s", target: "e" }],
    });
    const [edge] = routeSopEdges(toFlowNodes(draft), toFlowEdges(draft));
    expect(edge.data!.route!.points).toEqual([
      { x: 108, y: 100 },
      { x: 108, y: 200 },
    ]);
  });
});
