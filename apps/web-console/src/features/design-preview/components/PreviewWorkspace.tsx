import { useState } from "react";
import {
  ChevronDown,
  ChevronsUpDown,
  FileText,
  FolderOpen,
  HelpCircle,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react";
import {
  previewViews,
  sampleAgents,
  type DesignDirection,
  type PreviewAgent,
  type PreviewView,
} from "../design-data";
import { AgentCollection } from "./AgentCollection";
import { PreviewScenes } from "./PreviewScenes";
import { AgentPreviewDialog } from "./AgentPreviewDialog";

/** 装配导航、Agent 管理和其他产品场景；演示不访问业务 API。 */
export function PreviewWorkspace({
  direction,
}: {
  direction: DesignDirection;
}) {
  const [view, setView] = useState<PreviewView>("agents");
  const [query, setQuery] = useState("");
  const [activeAgent, setActiveAgent] = useState<PreviewAgent | "new" | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const currentView = previewViews.find((item) => item.id === view)!;

  function navigate(next: PreviewView) {
    setView(next);
    setQuery("");
    setNavigationOpen(false);
  }

  return (
    <section
      className={`preview-workspace ${navigationOpen ? "navigation-open" : ""}`}
      aria-label="Orbit 工作台预览"
    >
      <aside className="preview-sidebar">
        <button
          type="button"
          className="workspace-select"
          onClick={() => setNotice("当前为个人空间。此页面为独立设计预览。 ")}
        >
          <span className="workspace-monogram">o</span>
          <span>
            Orbit<small>个人工作空间</small>
          </span>
          <ChevronsUpDown size={14} />
        </button>
        <button
          type="button"
          className="sidebar-search"
          onClick={() => {
            navigate("agents");
            requestAnimationFrame(() =>
              document.getElementById("agent-search")?.focus(),
            );
          }}
        >
          <Search size={15} />
          <span>搜索 Agent</span>
          <kbd>⌕</kbd>
        </button>
        <div className="sidebar-label">工作空间</div>
        <nav className="workspace-nav" aria-label="预览功能">
          {previewViews.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`workspace-nav-item ${view === item.id ? "active" : ""}`}
              aria-pressed={view === item.id}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {item.id === "agents" && <span className="nav-count">3</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-label sidebar-group-label">快捷访问</div>
        <div className="sidebar-shortcuts">
          <button type="button" onClick={() => setActiveAgent(sampleAgents[0])}>
            <FileText size={14} />
            行业研究助手
          </button>
          <button type="button" onClick={() => navigate("workflow")}>
            <FolderOpen size={14} />
            每周行业简报
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            type="button"
            onClick={() =>
              setNotice(
                "预览支持 Agent 配置、搜索、主题切换和场景导航。正式数据请在工作台中管理。 ",
              )
            }
          >
            <HelpCircle size={15} />
            使用说明
          </button>
          <a href="/studio#settings/profile">
            <Settings2 size={15} />
            设置
          </a>
          <div className="profile-mini">
            <span className="workspace-avatar">H</span>
            <span>
              Huayi<small>个人账户</small>
            </span>
            <ChevronDown size={14} />
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb">
            <button
              type="button"
              className="mobile-nav-toggle"
              aria-label="切换导航"
              aria-expanded={navigationOpen}
              onClick={() => setNavigationOpen(!navigationOpen)}
            >
              <PanelLeft size={17} />
            </button>
            <span>个人空间</span>
            <span>/</span>
            <strong>{currentView.label}</strong>
          </div>
          <div className="workspace-top-actions">
            <span className="preview-badge">示例工作空间</span>
            <button
              className="scene-secondary"
              type="button"
              onClick={() => setActiveAgent("new")}
            >
              <Plus size={14} />
              新建 Agent
            </button>
          </div>
        </header>
        <main className="workspace-content">
          {view === "agents" ? (
            <AgentCollection
              direction={direction}
              query={query}
              onQueryChange={setQuery}
              onOpenAgent={setActiveAgent}
              onTest={() => navigate("chat")}
              onWorkflow={() => navigate("workflow")}
            />
          ) : (
            <PreviewScenes view={view} query={query} onQueryChange={setQuery} />
          )}
        </main>
        <footer className="workspace-statusbar">
          <span>
            个人空间<span className="statusbar-divider">/</span>3 个 Agent
          </span>
          <span>预览数据 · 不调用模型服务</span>
        </footer>
      </div>
      {notice && (
        <div className="preview-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            aria-label="关闭通知"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {activeAgent && (
        <AgentPreviewDialog
          agent={activeAgent}
          onClose={() => setActiveAgent(null)}
          onTest={() => {
            setActiveAgent(null);
            navigate("chat");
          }}
        />
      )}
    </section>
  );
}
