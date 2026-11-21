import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowRuntimeEvent } from "@orbit/workflow-core";
import { useSopEditor } from "../use-sop-editor";
import { useSopWorkflowReferences } from "../use-sop-workflow-references";
import { useSopAgentReferences } from "../use-sop-agent-references";
import { SopContainerScopeBar } from "./SopContainerScopeBar";
import { SopInspector } from "./SopInspector";
import { SopPalette } from "./SopPalette";
import { SopToolbar } from "./SopToolbar";
import { SopRunPanel } from "../../runs/components/SopRunPanel";
import { useSopRun } from "../../runs/use-sop-run";

import type { SopCanvasProps } from "../sop-editor-types";
import { SopCanvasViewport } from "./SopCanvasViewport";
import { SopCanvasDock } from "./SopCanvasDock";
import { SopFloatingRail } from "./SopFloatingRail";
import { SopLayersPanel } from "./SopLayersPanel";

/** SOP 编辑器外壳，负责组合画布、工具栏、节点库和检查器。 */
export function SopCanvasShell({
  initial,
  legacyBackup,
  onSave,
  onAutoSave,
  onRecoveryChange,
  onBack,
  onOpenLifecycle,
  theme,
  onThemeToggle,
  saveState,
  saveMessage,
}: SopCanvasProps) {
  const editor = useSopEditor(initial);
  const workflowReferences = useSopWorkflowReferences(
    editor.selectedNode?.data.node.kind === "builtin" &&
      editor.selectedNode.data.node.type === "subworkflow",
  );
  const agentReferences = useSopAgentReferences(
    editor.selectedNode?.data.node.kind === "builtin" &&
      editor.selectedNode.data.node.type === "agent",
  );
  const handleRunEvent = useCallback(
    (event: WorkflowRuntimeEvent) => {
      editor.applyRunEvent(event);
      if (event.type === "node.status" && event.status === "failed")
        editor.focusNode(event.nodeId);
    },
    [editor.applyRunEvent, editor.focusNode],
  );
  const run = useSopRun({
    draft: editor.currentDraft,
    onEvent: handleRunEvent,
    onReset: editor.clearRunState,
  });
  const [interactionMode, setInteractionMode] = useState<"select" | "pan">(
    "select",
  );
  const [leftPanel, setLeftPanel] = useState<"layers" | "palette" | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const flow = useReactFlow();
  const panMode = interactionMode === "pan" || spaceHeld;
  const togglePalette = () =>
    setLeftPanel((current) => (current === "palette" ? null : "palette"));
  const currentDraftRef = useRef(editor.currentDraft);
  const autoSaveRef = useRef(onAutoSave);
  const recoveryChangeRef = useRef(onRecoveryChange);
  currentDraftRef.current = editor.currentDraft;
  autoSaveRef.current = onAutoSave;
  recoveryChangeRef.current = onRecoveryChange;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") {
        setLeftPanel(null);
        setInspectorOpen(false);
        return;
      }
      if (target?.closest("input, textarea, select, [contenteditable='true']"))
        return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceHeld(true);
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.shiftKey && event.code === "Digit1") {
        event.preventDefault();
        void flow.fitView({ padding: 0.2, duration: 200 });
      }
      if (event.key.toLowerCase() === "h") setInteractionMode("pan");
      else if (event.key.toLowerCase() === "v") setInteractionMode("select");
    };
    const release = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", release);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", blur);
    };
  }, [flow]);

  useEffect(() => {
    if (editor.showJsonPanel) setInspectorOpen(true);
  }, [editor.showJsonPanel]);

  useEffect(() => {
    if (editor.dirtyRevision === 0) return;
    const draft = currentDraftRef.current();
    recoveryChangeRef.current?.(draft);
    const timer = window.setTimeout(() => {
      void autoSaveRef.current?.(currentDraftRef.current());
    }, 900);
    return () => window.clearTimeout(timer);
  }, [editor.dirtyRevision]);

  return (
    <div className="sop-wrap sop-free-canvas">
      <SopToolbar
        name={editor.name}
        summary={editor.summary}
        theme={theme}
        onThemeToggle={onThemeToggle}
        saveState={saveState}
        saveMessage={saveMessage}
        debugMessage={editor.debugState.message}
        legacyBackup={legacyBackup}
        onNameChange={editor.setName}
        onSummaryChange={editor.setSummary}
        onBack={onBack}
        onValidate={() => {
          editor.runValidation();
          setInspectorOpen(true);
        }}
        onSave={() => void onSave(editor.currentDraft())}
        onOpenLifecycle={onOpenLifecycle}
        onExportJson={editor.openJsonExport}
        onImportText={(text) => {
          editor.setJsonText(text);
          editor.setJsonError(null);
          editor.setShowJsonPanel(true);
        }}
        onLayout={editor.autoLayout}
        onTogglePin={editor.toggleSelectedPinned}
        canTestNode={Boolean(editor.selectedNode)}
        onTestNode={() => void run.prepare("node-test")}
        onRunDraft={() => void run.prepare("draft")}
        onRunProduction={() => void run.prepare("production")}
      />
      <div className="sop-editor-body">
        <SopFloatingRail
          leftPanel={leftPanel}
          inspectorOpen={inspectorOpen}
          runOpen={run.open}
          onLayers={() =>
            setLeftPanel((current) => (current === "layers" ? null : "layers"))
          }
          onPalette={togglePalette}
          onInspector={() => setInspectorOpen((open) => !open)}
          onRun={() => (run.open ? run.close() : run.show())}
        />
        <SopPalette
          open={leftPanel === "palette"}
          onAdd={(type) => {
            const position = flow.screenToFlowPosition({
              x: window.innerWidth / 2 - 100,
              y: window.innerHeight / 2 - 50,
            });
            // 点击新增选择附近空位；拖入画布仍尊重用户指定的位置。
            while (
              editor.nodes.some(
                (node) =>
                  position.x <
                    node.position.x + (node.measured?.width ?? 216) + 24 &&
                  position.x + 240 > node.position.x &&
                  position.y <
                    node.position.y + (node.measured?.height ?? 100) + 24 &&
                  position.y + 124 > node.position.y,
              )
            )
              position.y += 140;
            editor.addNodeOfType(type, position);
            if (window.innerWidth < 760) setLeftPanel(null);
          }}
          onClose={() => setLeftPanel(null)}
        />
        {leftPanel === "layers" && (
          <SopLayersPanel
            nodes={editor.nodes}
            selectedIds={editor.selectedNodeIds}
            onSelect={(id) => { editor.focusNode(id); setInspectorOpen(true); }}
            onClose={() => setLeftPanel(null)}
          />
        )}
        <div className="sop-workspace">
          <div className="sop-workspace-body">
            <div className="sop-main">
              <SopContainerScopeBar
                crumbs={editor.scopeCrumbs}
                onNavigate={editor.navigateToScope}
                onExit={editor.exitContainer}
              />
              <SopCanvasViewport
                editor={editor}
                panMode={panMode}
                theme={theme}
                onInspect={() => setInspectorOpen(true)}
              />
              <SopCanvasDock
                mode={panMode ? "pan" : "select"}
                onModeChange={setInteractionMode}
                onAdd={togglePalette}
                canUndo={editor.canUndo}
                canRedo={editor.canRedo}
                onUndo={editor.undo}
                onRedo={editor.redo}
                onFitSelection={editor.fitSelection}
              />
              <div className="sop-canvas-help">
                空格平移 · 滚轮移动 · ⌘ / Ctrl 滚轮缩放 · Alt 取消吸附
              </div>
            </div>
            <SopInspector
              open={inspectorOpen}
              showJson={editor.showJsonPanel}
              name={editor.name}
              jsonText={editor.jsonText}
              jsonError={editor.jsonError}
              selectedNodeIds={editor.selectedNodeIds}
              selectedNode={editor.selectedNode}
              selectedEdge={editor.selectedEdge}
              scopeNodes={editor.nodes.map((node) => node.data.node)}
              currentWorkflowId={initial.id}
              scopeDepth={editor.scopePath.length}
              workflowReferences={workflowReferences}
              agentReferences={agentReferences}
              validation={editor.validation}
              availableVariables={editor.availableVariables}
              selectedDiagnostics={editor.selectedDiagnostics}
              onJsonTextChange={(text) => {
                editor.setJsonText(text);
                editor.setJsonError(null);
              }}
              onImportJson={editor.importJson}
              onCloseJson={() => editor.setShowJsonPanel(false)}
              onUpdateNode={editor.updateSelectedNode}
              onUpdateEdgeLabel={editor.updateSelectedEdgeLabel}
              onDelete={editor.deleteSelected}
              onDuplicate={editor.duplicateSelected}
              onClearValidation={editor.clearValidation}
              onFocusNode={editor.focusNode}
              onToggleCollapsed={editor.toggleSelectedCollapsed}
              onEnterContainer={(nodeId) => {
                editor.enterContainer(nodeId);
                setInspectorOpen(false);
              }}
              onClose={() => setInspectorOpen(false)}
            />
          </div>
          <SopRunPanel
            open={run.open}
            mode={run.mode}
            phase={run.phase}
            draft={editor.currentDraft()}
            selectedNode={editor.selectedNode?.data.node ?? null}
            run={run.run}
            events={run.events}
            versions={run.versions}
            message={run.message}
            decisionPending={run.decisionPending}
            onStart={(input) => {
              void run.start(input);
            }}
            onCancel={() => {
              void run.cancel();
            }}
            onResume={(decision) => {
              void run.resume(decision);
            }}
            onClose={run.close}
          />
        </div>
      </div>
      <footer className="sop-canvas-status">
        <span>
          {editor.nodes.length} 个节点 / {editor.edges.length} 条连线
        </span>
        <span>{editor.scopePath.length ? "容器子流程" : "主流程"}</span>
        <span>V 选择 · H 平移</span>
      </footer>
    </div>
  );
}
