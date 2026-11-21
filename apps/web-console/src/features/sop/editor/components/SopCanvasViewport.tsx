import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useNodesInitialized,
  useReactFlow,
  useUpdateNodeInternals,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { ThemeMode } from "../../../../theme";
import type { useSopEditor } from "../use-sop-editor";
import type { SopFlowData, SopFlowEdgeData } from "../sop-flow-adapter";
import { routeSopEdges } from "../sop-canvas-routing";
import { getSopPortLayouts } from "../sop-port-layout";
import type { CanvasPortSpec } from "../../../../lib/canvas/canvas-routing";
import { SopConnectionLine, SopEdge } from "../../components/SopEdge";
import { SopNodeView } from "../../components/SopNodeView";
import { SopAlignmentOverlay } from "./SopAlignmentOverlay";

const nodeTypes = { sop: SopNodeView };
const edgeTypes = { sop: SopEdge };

/** 正式画布交互层，几何路由缓存独立于选择、运行状态和节点文案更新。 */
export function SopCanvasViewport({
  editor,
  panMode,
  theme,
  onInspect,
}: {
  editor: ReturnType<typeof useSopEditor>;
  panMode: boolean;
  theme: ThemeMode;
  onInspect: () => void;
}) {
  const lastCheck = useRef<{ valid: boolean; reason?: string } | null>(null);
  const initialized = useNodesInitialized();
  const didFit = useRef(false);
  const flow = useReactFlow();
  useEffect(() => {
    if (!initialized || didFit.current) return;
    // 全屏布局及真实节点尺寸就绪后再定位，避免旧草稿初次打开时落在窗口外。
    const frame = requestAnimationFrame(() => {
      didFit.current = true;
      void flow.fitView({ padding: 0.25, maxZoom: 0.9 });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialized, flow]);
  const geometryKey = JSON.stringify([
    editor.nodes.map((n) => [
      n.id,
      n.position,
      n.measured,
      n.data.node.ports.inputs.map((p) => p.id),
      n.data.node.ports.outputs.map((p) => p.id),
    ]),
    editor.edges.map((e) => [
      e.id,
      e.source,
      e.target,
      e.sourceHandle,
      e.targetHandle,
    ]),
  ]);
  // 文案、选中状态、Trace 更新都不需要重新搜索路径。
  const previousPorts = useRef<ReadonlyMap<string, CanvasPortSpec[]>>(
    new Map(),
  );
  const geometry = useMemo(() => {
    const ports = getSopPortLayouts(
      editor.nodes,
      editor.edges,
      previousPorts.current,
    );
    previousPorts.current = ports;
    return {
      ports,
      routes: new Map(
        routeSopEdges(editor.nodes, editor.edges, ports).map((e) => [
          e.id,
          e.data!.route,
        ]),
      ),
    };
  }, [geometryKey]);
  const updateNodeInternals = useUpdateNodeInternals();
  const portKey = JSON.stringify([...geometry.ports]);
  useEffect(() => {
    // 统一批量测量；逐节点刷新会在同一帧覆盖受控节点的尺寸变更。
    updateNodeInternals([...geometry.ports.keys()]);
  }, [portKey, updateNodeInternals]);
  const nodes = editor.nodes.map((node) => ({
    ...node,
    data: { ...node.data, portLayout: geometry.ports.get(node.id) },
  }));
  const edges = editor.edges.map((e) => ({
    ...e,
    label:
      e.label ??
      (() => {
        const source = editor.nodes.find((node) => node.id === e.source)?.data
          .node;
        return source && source.ports.outputs.length > 1
          ? source.ports.outputs.find((port) => port.id === e.sourceHandle)
              ?.name
          : undefined;
      })(),
    data: { ...e.data!, route: geometry.routes.get(e.id) },
  }));
  return (
    <div
      className={`sop-canvas ${panMode ? "is-pan-mode" : ""}`}
      onDragOver={editor.onDragOver}
      onDrop={editor.onDrop}
    >
      <ReactFlow<Node<SopFlowData>, Edge<SopFlowEdgeData>>
        onNodeClick={() => {
          if (!panMode) onInspect();
        }}
        onEdgeClick={() => {
          if (!panMode) onInspect();
        }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={editor.onNodesChange}
        onEdgesChange={editor.onEdgesChange}
        onConnect={editor.onConnect}
        onReconnect={editor.onReconnect}
        isValidConnection={(connection) => {
          const result = editor.checkConnection(connection);
          lastCheck.current = result;
          return result.valid;
        }}
        onConnectStart={() => {
          lastCheck.current = null;
          editor.setConnectionHint(null);
        }}
        onConnectEnd={() => {
          const result = lastCheck.current;
          if (result && !result.valid)
            editor.setConnectionHint(result.reason ?? "端口不兼容。");
        }}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={26}
        reconnectRadius={12}
        connectionLineComponent={SopConnectionLine}
        onSelectionChange={({ nodes, edges }) => {
          editor.setSelectedNodeIds(new Set(nodes.map((node) => node.id)));
          editor.setSelectedEdgeIds(new Set(edges.map((edge) => edge.id)));
        }}
        onPaneClick={() => {
          if (!panMode) {
            editor.setSelectedNodeIds(new Set());
            editor.setSelectedEdgeIds(new Set());
          }
        }}
        onNodeDragStart={editor.onNodeDragStart}
        onNodeDragStop={editor.onNodeDragStop}
        onNodeDoubleClick={(_, node) => {
          const n = node.data.node;
          if (
            n.kind === "builtin" &&
            (n.type === "iteration" || n.type === "loop")
          )
            editor.enterContainer(n.id);
        }}
        multiSelectionKeyCode="Shift"
        selectionOnDrag={!panMode}
        selectionMode={SelectionMode.Partial}
        panOnDrag={panMode ? true : [1, 2]}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        nodesDraggable={!panMode}
        nodesConnectable={!panMode}
        elementsSelectable={!panMode}
        deleteKeyCode={null}
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 0.9 }}
        defaultEdgeOptions={{ type: "sop" }}
        colorMode={theme}
        proOptions={{ hideAttribution: true }}
        onlyRenderVisibleElements
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--canvas-grid)"
        />
        <MiniMap
          style={{ width: 110, height: 72 }}
          pannable
          zoomable
          nodeColor="var(--text-muted)"
          maskColor="var(--canvas-minimap-mask)"
        />
      </ReactFlow>
      <SopAlignmentOverlay guides={editor.alignLines} />
      {editor.connectionHint && (
        <div className="sop-connection-hint" role="status">
          {editor.connectionHint}
        </div>
      )}
    </div>
  );
}
