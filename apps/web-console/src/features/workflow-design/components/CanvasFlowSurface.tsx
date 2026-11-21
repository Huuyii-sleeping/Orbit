import { useMemo, type Dispatch, type SetStateAction } from "react";
import {
  applyEdgeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  reconnectEdge,
  SelectionMode,
  type Connection,
  type Edge,
} from "@xyflow/react";
import type { CanvasDirection, CanvasNode } from "../canvas-design-data";
import { routeCanvasEdges, type CanvasRoutedEdge } from "../../../lib/canvas/canvas-routing";
import { useCanvasSnapping } from "../../../components/canvas/use-canvas-snapping";
import { SopAlignmentOverlay } from "../../sop/editor/components/SopAlignmentOverlay";
import { CanvasPreviewNode } from "./CanvasPreviewNode";
import { CanvasSmartConnection, CanvasSmartEdge } from "./CanvasSmartEdge";

const nodeTypes = { preview: CanvasPreviewNode };
const edgeTypes = { smart: CanvasSmartEdge };

/** 三套布局共用的画布引擎：节点吸附、端口磁吸、避障连线与重新接线。 */
export function CanvasFlowSurface({
  nodes,
  edges,
  setNodes,
  setEdges,
  onConnect,
  onSelect,
  panMode,
  direction,
  theme,
}: {
  nodes: CanvasNode[];
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  onConnect: (connection: Connection) => void;
  onSelect: (id: string | null) => void;
  panMode: boolean;
  direction: CanvasDirection;
  theme: "light" | "dark";
}) {
  const { guides, onNodesChange, clearGuides } = useCanvasSnapping(
    nodes,
    setNodes,
  );
  const routedEdges = useMemo(
    () =>
      routeCanvasEdges(
        nodes.map((node) => ({
          id: node.id,
          x: node.position.x,
          y: node.position.y,
          width:
            node.measured?.width ??
            (node.data.kind === "start" || node.data.kind === "end"
              ? 100
              : 216),
          height:
            node.measured?.height ??
            (node.data.kind === "start" || node.data.kind === "end" ? 44 : 128),
        })),
        edges,
      ),
    [nodes, edges],
  );
  return (
    <div className="wc-flow-host">
      <ReactFlow<CanvasNode, CanvasRoutedEdge>
        nodes={nodes}
        edges={routedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={(changes) =>
          setEdges((current) => applyEdgeChanges(changes, current))
        }
        onConnect={onConnect}
        onReconnect={(old, connection) =>
          setEdges((current) =>
            reconnectEdge(
              current.find((edge) => edge.id === old.id)!,
              connection,
              current,
            ),
          )
        }
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        onNodesDelete={(deleted) => {
          const ids = new Set(deleted.map((node) => node.id));
          setEdges((current) =>
            current.filter(
              (edge) => !ids.has(edge.source) && !ids.has(edge.target),
            ),
          );
          onSelect(null);
        }}
        isValidConnection={(connection) =>
          connection.source !== connection.target &&
          nodes.find((n) => n.id === connection.source)?.data.kind !== "end" &&
          nodes.find((n) => n.id === connection.target)?.data.kind !== "start"
        }
        connectionMode={ConnectionMode.Loose}
        connectionRadius={26}
        reconnectRadius={12}
        connectionLineComponent={CanvasSmartConnection}
        onMoveStart={clearGuides}
        selectionOnDrag={!panMode}
        selectionMode={SelectionMode.Partial}
        panOnDrag={panMode ? true : [1, 2]}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        nodesDraggable={!panMode}
        nodesConnectable={!panMode}
        elementsSelectable={!panMode}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.25}
        maxZoom={1.8}
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 0.9 }}
        colorMode={theme}
        defaultEdgeOptions={{ type: "smart" }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--wc-grid)"
        />
        {direction === "float" && (
          <MiniMap
            className="wc-minimap"
            style={{ width: 110, height: 72 }}
            pannable
            zoomable
            nodeColor="var(--wc-muted)"
            maskColor="var(--wc-minimap-mask)"
          />
        )}
      </ReactFlow>
      <SopAlignmentOverlay guides={guides} />
    </div>
  );
}
