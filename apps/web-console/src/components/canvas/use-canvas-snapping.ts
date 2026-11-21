import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  applyNodeChanges,
  useReactFlow,
  type NodeChange,
  type Node,
  type NodePositionChange,
} from "@xyflow/react";
import {
  getSopAlignmentSnap,
  type SopAlignmentGuide,
} from "../../features/sop/lib/sop-alignment";

/** 把吸附应用到位置变更提交前，避免节点先落在原始位置再跳到辅助线。 */
export function useCanvasSnapping<NodeType extends Node>(
  nodes: NodeType[],
  setNodes: Dispatch<SetStateAction<NodeType[]>>,
) {
  const [guides, setGuides] = useState<SopAlignmentGuide[]>([]);
  const bypass = useRef(false);
  const dragging = useRef(false);
  const flow = useReactFlow<NodeType>();
  useEffect(() => {
    const update = (event: KeyboardEvent | PointerEvent) => {
      bypass.current = event.altKey;
    };
    const reset = () => {
      bypass.current = false;
      setGuides([]);
    };
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("pointermove", update, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("pointermove", update, true);
      window.removeEventListener("blur", reset);
    };
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<NodeType>[]) => {
      // 测量回调可能在同一帧分批到达，必须累积到最新状态，避免其他节点丢失尺寸和端口边界。
      if (!changes.some((change) => change.type === "position")) {
        setNodes((current) => applyNodeChanges(changes, current));
        return;
      }
      let next = applyNodeChanges(changes, nodes);
      const positions = changes.filter(
        (c): c is NodePositionChange =>
          c.type === "position" && c.position !== undefined,
      );
      const active = positions.some((c) => c.dragging);
      if ((active || dragging.current) && positions.length && !bypass.current) {
        const ids = new Set(positions.map((c) => c.id));
        const moving = next.filter((node) => ids.has(node.id));
        const size = (node: NodeType) => ({
          w: node.measured?.width ?? node.width ?? 216,
          h: node.measured?.height ?? node.height ?? 128,
        });
        const left = Math.min(...moving.map((n) => n.position.x));
        const top = Math.min(...moving.map((n) => n.position.y));
        const width =
          Math.max(...moving.map((n) => n.position.x + size(n).w)) - left;
        const height =
          Math.max(...moving.map((n) => n.position.y + size(n).h)) - top;
        const viewport = flow.getViewport();
        const snap = getSopAlignmentSnap(
          { x: left, y: top },
          { w: width, h: height },
          next
            .filter((n) => !ids.has(n.id))
            .map((n) => ({ id: n.id, position: n.position, size: size(n) })),
          viewport,
          7,
        );
        next = next.map((node) =>
          ids.has(node.id)
            ? {
                ...node,
                position: {
                  x: node.position.x + snap.dx / viewport.zoom,
                  y: node.position.y + snap.dy / viewport.zoom,
                },
              }
            : node,
        );
        setGuides(active ? snap.guides : []);
      } else if (positions.length) setGuides([]);
      if (positions.length) dragging.current = active;
      setNodes(next);
    },
    [nodes, setNodes, flow],
  );
  return { guides, onNodesChange, setGuides, clearGuides: () => setGuides([]) };
}
