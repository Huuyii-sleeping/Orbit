import { describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { Node } from "@xyflow/react";
import { useCanvasSnapping } from "../../../../src/components/canvas/use-canvas-snapping";

// 模拟同一帧中回调共享旧 render、状态在帧尾统一提交的 React 批处理语义。
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  useRef: (current: unknown) => ({ current }),
  useState: () => [[], vi.fn()],
}));
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  useReactFlow: () => ({ getViewport: () => ({ x: 0, y: 0, zoom: 1 }) }),
}));

describe("画布测量批处理", () => {
  it("同一帧分批测量多个节点时保留所有尺寸，后续选择不抹掉测量结果", () => {
    const nodes: Node[] = ["a", "b"].map((id) => ({
      id,
      position: { x: 0, y: 0 },
      data: {},
    }));
    const pending: SetStateAction<Node[]>[] = [];
    const setNodes: Dispatch<SetStateAction<Node[]>> = (update) => {
      pending.push(update);
    };
    const { onNodesChange } = useCanvasSnapping(nodes, setNodes);
    onNodesChange([
      { id: "a", type: "dimensions", dimensions: { width: 216, height: 87 } },
    ]);
    onNodesChange([
      { id: "b", type: "dimensions", dimensions: { width: 216, height: 104 } },
    ]);
    onNodesChange([{ id: "a", type: "select", selected: true }]);
    const result = pending.reduce<Node[]>(
      (current, update) =>
        typeof update === "function" ? update(current) : update,
      nodes,
    );
    expect(result.map((node) => node.measured)).toEqual([
      { width: 216, height: 87 },
      { width: 216, height: 104 },
    ]);
    expect(result[0].selected).toBe(true);
  });
});
