import { Position, type Edge, type Node } from "@xyflow/react";
import type { CanvasPortSpec } from "../../../lib/canvas/canvas-routing";
import type { SopFlowData, SopFlowEdgeData } from "./sop-flow-adapter";

/** 为每个业务端口选择唯一显示侧边；迟滞区防止拖到对角线附近时反复跳边。 */
export function getSopPortLayouts(
  nodes: Node<SopFlowData>[],
  edges: Edge<SopFlowEdgeData>[],
  previous?: ReadonlyMap<string, CanvasPortSpec[]>,
) {
  const boxes = new Map(
    nodes.map((node) => [
      node.id,
      {
        x: node.position.x + (node.measured?.width ?? 216) / 2,
        y: node.position.y + (node.measured?.height ?? 100) / 2,
        width: node.measured?.width ?? 216,
        height: node.measured?.height ?? 100,
      },
    ]),
  );
  const peers = new Map<string, { x: number; y: number; count: number }>();
  let horizontal = 0,
    vertical = 0;
  for (const edge of edges) {
    const source = boxes.get(edge.source),
      target = boxes.get(edge.target);
    if (!source || !target) continue;
    horizontal +=
      Math.abs(target.x - source.x) / ((source.width + target.width) / 2);
    vertical +=
      Math.abs(target.y - source.y) / ((source.height + target.height) / 2);
    for (const [id, type, handle, peer] of [
      [edge.source, "source", edge.sourceHandle, target],
      [edge.target, "target", edge.targetHandle, source],
    ] as const) {
      const key = JSON.stringify([id, type, handle]);
      const sum = peers.get(key) ?? { x: 0, y: 0, count: 0 };
      peers.set(key, {
        x: sum.x + peer.x,
        y: sum.y + peer.y,
        count: sum.count + 1,
      });
    }
  }
  return new Map(
    nodes.map(({ id, data }) => {
      const box = boxes.get(id)!;
      const ports: CanvasPortSpec[] = [];
      for (const [type, definitions] of [
        ["target", data.node.ports.inputs],
        ["source", data.node.ports.outputs],
      ] as const) {
        for (const port of definitions) {
          const peer = peers.get(JSON.stringify([id, type, port.id]));
          const old = previous
            ?.get(id)
            ?.find((p) => p.id === port.id && p.type === type);
          let side =
            old?.side ??
            (vertical > horizontal
              ? type === "target"
                ? Position.Top
                : Position.Bottom
              : type === "target"
                ? Position.Left
                : Position.Right);
          if (peer) {
            const dx = (peer.x / peer.count - box.x) / box.width;
            const dy = (peer.y / peer.count - box.y) / box.height;
            const scores = {
              [Position.Left]: -dx,
              [Position.Right]: dx,
              [Position.Top]: -dy,
              [Position.Bottom]: dy,
            };
            const best =
              Math.abs(dx) > Math.abs(dy)
                ? dx > 0
                  ? Position.Right
                  : Position.Left
                : dy > 0
                  ? Position.Bottom
                  : Position.Top;
            // 只有新方向明显更合适时换边，保持轻微拖动中的端口和路径稳定。
            if (!old || scores[best] > Math.max(0, scores[side]) * 1.3)
              side = best;
          }
          ports.push({ id: port.id, type, side });
        }
      }
      for (const side of Object.values(Position)) {
        const group = ports.filter((port) => port.side === side);
        group.forEach((port, i) => {
          port.offset = (i + 1) / (group.length + 1);
        });
      }
      return [id, ports] as const;
    }),
  );
}
