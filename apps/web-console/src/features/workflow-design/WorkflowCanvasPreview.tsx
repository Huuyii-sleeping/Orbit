import { useCallback, useEffect, useRef, useState } from "react";
import {
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import {
  Check,
  Command,
  GitBranch,
  Hand,
  Maximize2,
  PanelLeft,
  PanelRight,
  X,
} from "lucide-react";
import {
  createPreviewEdges,
  createPreviewNodes,
  previewNodeKinds,
  type CanvasDirection,
  type CanvasNode,
  type CanvasNodeData,
} from "./canvas-design-data";
import { CanvasFlowSurface } from "./components/CanvasFlowSurface";
import { CanvasOutline } from "./components/CanvasOutline";
import { CanvasInspector } from "./components/CanvasInspector";
import { CanvasRunExample } from "./components/CanvasRunExample";

import { CanvasDocumentBar } from "./components/CanvasDocumentBar";
import { CanvasTools } from "./components/CanvasTools";

import { CanvasFloatingRail } from "./components/CanvasFloatingRail";

/** 可操作的方案预览：内存草稿、真实画布交互与独立面板状态。 */
export function WorkflowCanvasPreview({
  direction,
  theme,
}: {
  direction: CanvasDirection;
  theme: "light" | "dark";
}) {
  const [nodes, setNodes] = useState<CanvasNode[]>(createPreviewNodes);
  const [edges, setEdges] = useState<Edge[]>(createPreviewEdges);
  const [selectedId, setSelectedId] = useState<string | null>("research");
  const [leftOpen, setLeftOpen] = useState(
    () => direction !== "float" && window.innerWidth > 1100,
  );
  const [inspectorOpen, setInspectorOpen] = useState(
    () => window.innerWidth > 760,
  );
  const [outlineTab, setOutlineTab] = useState<"layers" | "library">("layers");
  const [mode, setMode] = useState<"select" | "pan">("select");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [runOpen, setRunOpen] = useState(direction === "console");
  const [notice, setNotice] = useState("");
  const nextId = useRef(1);
  const flow = useReactFlow<CanvasNode>();
  const selectedNode = nodes.find((node) => node.id === selectedId);
  const panMode = mode === "pan" || spaceHeld;

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (
        (event.target as HTMLElement)?.closest(
          'input, textarea, select, [contenteditable="true"]',
        )
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceHeld(true);
      }
      if (event.key.toLowerCase() === "v") setMode("select");
      if (event.key.toLowerCase() === "h") setMode("pan");
      if (event.key === "Escape") {
        setSelectedId(null);
        setNodes((current) =>
          current.map((node) => ({ ...node, selected: false })),
        );
      }
      if (event.key === "1" && event.shiftKey) {
        event.preventDefault();
        void flow.fitView({ padding: 0.18, duration: 250 });
      }
    }
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
    };
  }, [flow, setNodes]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const connect = useCallback(
    (connection: Connection) => {
      if (connection.source === connection.target) {
        setNotice("请选择另一个节点进行连接。");
        return;
      }
      setEdges((current) => addEdge({ ...connection, type: "smart" }, current));
    },
    [setEdges],
  );

  function selectNode(id: string | null, locate = false) {
    setSelectedId(id);
    if (id) setInspectorOpen(true);
    setNodes((current) =>
      current.map((node) => ({ ...node, selected: node.id === id })),
    );
    if (locate && id)
      void flow.fitView({
        nodes: [{ id }],
        maxZoom: 1,
        duration: 300,
        padding: 0.5,
      });
  }

  function addNode(kind: CanvasNodeData["kind"]) {
    const id = `node-${nextId.current++}`;
    const current = flow.getViewport();
    const position = {
      x: (320 - current.x) / current.zoom,
      y: (180 - current.y) / current.zoom,
    };
    const meta = previewNodeKinds[kind];
    const node: CanvasNode = {
      id,
      type: "preview",
      position,
      selected: true,
      data: {
        kind,
        label: meta.label,
        description: meta.description,
        model: kind === "research" ? "跟随 Agent 配置" : "",
        prompt: "",
      },
    };
    setNodes((currentNodes) => [
      ...currentNodes.map((item) => ({ ...item, selected: false })),
      node,
    ]);
    setSelectedId(id);
    setInspectorOpen(true);
    if (window.innerWidth < 760) setLeftOpen(false);
    setNotice(`已添加${meta.label}，可拖动端口连接到流程。`);
  }

  function deleteSelected() {
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) =>
      current.filter(
        (edge) => edge.source !== selectedId && edge.target !== selectedId,
      ),
    );
    setSelectedId(null);
  }

  function exportPreview() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              title: "研究简报 · 设计示例",
              nodes: nodes.map(
                ({ selected: _, measured: __, ...node }) => node,
              ),
              edges,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "orbit-canvas-design-example.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("已导出当前设计示例。");
  }

  const toggleLibrary = () => {
    setOutlineTab("library");
    setLeftOpen((open) => outlineTab !== "library" || !open);
  };

  return (
    <div
      className={`wc-editor ${leftOpen ? "has-outline" : ""} ${inspectorOpen ? "has-inspector" : ""} ${runOpen ? "has-run" : ""}`}
      data-layout={direction}
    >
      <CanvasDocumentBar
        direction={direction}
        runOpen={runOpen}
        onReset={() => {
          setNodes(createPreviewNodes());
          setEdges(createPreviewEdges());
          setSelectedId("research");
          setNotice("已恢复初始示例。");
          void flow.fitView({ padding: 0.18, duration: 300 });
        }}
        onExport={exportPreview}
        onToggleRun={() => setRunOpen((open) => !open)}
        onShowRun={() => setRunOpen(true)}
      />
      <div className="wc-editor-stage">
        {direction === "float" && (
          <CanvasFloatingRail
            leftOpen={leftOpen}
            outlineTab={outlineTab}
            inspectorOpen={inspectorOpen}
            runOpen={runOpen}
            onToggleLayers={() => {
              setOutlineTab("layers");
              setLeftOpen((open) => outlineTab !== "layers" || !open);
            }}
            onToggleLibrary={toggleLibrary}
            onToggleInspector={() => setInspectorOpen((open) => !open)}
            onToggleRun={() => setRunOpen((open) => !open)}
          />
        )}
        {leftOpen && (
          <CanvasOutline
            nodes={nodes}
            selectedId={selectedId}
            tab={outlineTab}
            onTabChange={setOutlineTab}
            onSelect={(id) => selectNode(id, true)}
            onAdd={addNode}
            onClose={() => setLeftOpen(false)}
          />
        )}
        <main className="wc-canvas-region" aria-label="工作流设计画布">
          <div className="wc-canvas-caption">
            <GitBranch size={13} />
            <span>主流程</span>
            <span>/</span>
            <small>研究简报</small>
          </div>
          <div className="wc-panel-controls">
            <button
              className="wc-icon"
              aria-label="切换图层面板"
              title="图层面板"
              aria-pressed={leftOpen}
              onClick={() => setLeftOpen((open) => !open)}
            >
              <PanelLeft size={15} />
            </button>
            <button
              className="wc-icon"
              aria-label="切换节点属性"
              title="节点属性"
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen((open) => !open)}
            >
              <PanelRight size={15} />
            </button>
          </div>
          <CanvasFlowSurface
            nodes={nodes}
            edges={edges}
            setNodes={setNodes}
            setEdges={setEdges}
            onConnect={connect}
            onSelect={(id) => {
              setSelectedId(id);
              if (id) setInspectorOpen(true);
            }}
            panMode={panMode}
            direction={direction}
            theme={theme}
          />
          <CanvasTools
            panMode={panMode}
            onModeChange={setMode}
            onAdd={toggleLibrary}
          />
          {notice && (
            <div className="wc-notice" role="status">
              <Check size={13} />
              {notice}
              <button
                className="wc-icon"
                aria-label="关闭提示"
                onClick={() => setNotice("")}
              >
                <X size={12} />
              </button>
            </div>
          )}
          <div className="wc-canvas-hint">
            <Hand size={11} />
            自动对齐吸附<span>·</span>Alt 自由拖动<span>·</span>空格平移
          </div>
        </main>
        {inspectorOpen && (
          <CanvasInspector
            node={selectedNode}
            onChange={(patch) =>
              setNodes((current) =>
                current.map((node) =>
                  node.id === selectedId
                    ? { ...node, data: { ...node.data, ...patch } }
                    : node,
                ),
              )
            }
            onDelete={deleteSelected}
            onClose={() => setInspectorOpen(false)}
          />
        )}
        {runOpen && <CanvasRunExample onClose={() => setRunOpen(false)} />}
      </div>
      <footer className="wc-editor-status">
        <span>
          <GitBranch size={11} />
          主流程
        </span>
        <span>
          {nodes.length} 个节点<span className="wc-status-divider">/</span>
          {edges.length} 条连线
        </span>
        <span className="wc-status-spacer" />
        <span>
          <Command size={11} />V 选择 / H 平移
        </span>
        <span className="wc-status-device">
          <Maximize2 size={11} />
          无限画布
        </span>
      </footer>
    </div>
  );
}
