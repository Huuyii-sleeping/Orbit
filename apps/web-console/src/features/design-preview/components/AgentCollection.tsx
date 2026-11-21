import { useState } from "react";
import { AgentInspector } from "./AgentInspector";
import {
  ArrowDownUp,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  sampleAgents,
  sampleRuns,
  type DesignDirection,
  type PreviewAgent,
} from "../design-data";

type CollectionProps = {
  direction: DesignDirection;
  query: string;
  onQueryChange: (query: string) => void;
  onOpenAgent: (agent: PreviewAgent | "new") => void;
  onTest: () => void;
  onWorkflow: () => void;
};

/** 用列表、内容目录和主从双栏比较相同 Agent 管理任务。 */
export function AgentCollection({
  direction,
  query,
  onQueryChange,
  onOpenAgent,
  onTest,
  onWorkflow,
}: CollectionProps) {
  const [filter, setFilter] = useState("全部");
  const [selectedId, setSelectedId] = useState(sampleAgents[0].id);
  const [sortByName, setSortByName] = useState(false);
  const [showVersions, setShowVersions] = useState(true);
  const [displayOptionsOpen, setDisplayOptionsOpen] = useState(false);
  const agents = sampleAgents.filter(
    (agent) =>
      `${agent.name}${agent.description}${agent.category}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "全部" || agent.status === filter),
  );
  if (sortByName) agents.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  // 搜索或状态筛选隐藏当前选中项时，详情跟随可见结果，不展示不匹配的条目。
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];

  return (
    <div className="agent-collection">
      <header className="collection-heading">
        <div>
          <div className="collection-kicker">工作空间 / AGENTS</div>
          <h1>
            {direction === "library" ? "Agent 目录" : "Agent"}
            <span>{sampleAgents.length}</span>
          </h1>
          <p>
            {direction === "desk"
              ? "选择一个 Agent，检查它的配置和最近测试。"
              : "管理职责、技能与发布版本。"}
          </p>
        </div>
        <button
          type="button"
          className="workspace-primary"
          onClick={() => onOpenAgent("new")}
        >
          <Plus size={15} />
          新建 Agent
        </button>
      </header>
      <div className="collection-toolbar">
        <nav className="agent-filters" aria-label="Agent 状态">
          {["全部", "已发布", "未发布"].map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? "active" : ""}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
              <span>
                {item === "全部"
                  ? sampleAgents.length
                  : sampleAgents.filter((agent) => agent.status === item)
                      .length}
              </span>
            </button>
          ))}
        </nav>
        <div className="collection-tools">
          <label className="preview-search">
            <Search size={14} />
            <input
              id="agent-search"
              aria-label="搜索 Agent"
              placeholder="搜索 Agent…"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="tool-button"
            aria-label={sortByName ? "按最近更新排序" : "按名称排序"}
            title={sortByName ? "按最近更新排序" : "按名称排序"}
            onClick={() => setSortByName(!sortByName)}
          >
            <ArrowDownUp size={14} />
          </button>
          <div className="display-options">
            <button
              className="tool-button"
              type="button"
              aria-label="显示选项"
              aria-expanded={displayOptionsOpen}
              onClick={() => setDisplayOptionsOpen(!displayOptionsOpen)}
            >
              <SlidersHorizontal size={14} />
            </button>
            {displayOptionsOpen && (
              <div className="display-options-popover">
                <label>
                  <input
                    type="checkbox"
                    checked={showVersions}
                    onChange={(event) => setShowVersions(event.target.checked)}
                  />
                  显示版本
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
      {agents.length === 0 ? (
        <div className="preview-empty">
          <Search size={22} />
          <h2>没有找到 Agent</h2>
          <p>尝试其他名称、职责，或清除筛选。</p>
          <button
            type="button"
            onClick={() => {
              onQueryChange("");
              setFilter("全部");
            }}
          >
            清除筛选
          </button>
        </div>
      ) : direction === "desk" ? (
        <div className="agent-inspector-layout">
          <div className="inspector-list">
            <div className="list-caption">
              {agents.length} 个 Agent
              <span>{sortByName ? "名称" : "最近更新"}</span>
            </div>
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`inspector-list-item ${selected.id === agent.id ? "selected" : ""}`}
                aria-pressed={selected.id === agent.id}
                onClick={() => setSelectedId(agent.id)}
              >
                <span className="agent-inline-icon">
                  <agent.icon size={18} />
                </span>
                <span>
                  <strong>{agent.name}</strong>
                  <small>
                    {agent.category} · {agent.updated}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <AgentInspector
            key={selected.id}
            agent={selected}
            onOpen={() => onOpenAgent(selected)}
            onTest={onTest}
            showVersions={showVersions}
          />
        </div>
      ) : (
        <div className="collection-layout">
          <div className="collection-primary">
            {direction === "library" ? (
              <div className="agent-directory">
                <div className="directory-section-title">
                  个人 Agent<span>由 Huayi 创建和维护</span>
                </div>
                {agents.map((agent) => (
                  <button
                    type="button"
                    key={agent.id}
                    className="directory-entry"
                    onClick={() => onOpenAgent(agent)}
                  >
                    <span className="agent-inline-icon">
                      <agent.icon size={21} />
                    </span>
                    <span className="directory-entry-body">
                      <span className="directory-entry-title">
                        <strong>{agent.name}</strong>
                        <span
                          className={`agent-state ${agent.status === "未发布" ? "draft" : ""}`}
                        >
                          <i />
                          {agent.status}
                        </span>
                      </span>
                      <span className="directory-description">
                        {agent.description}
                      </span>
                      <span className="directory-entry-meta">
                        {agent.skills.join(" / ")}
                        <span>
                          {showVersions ? `${agent.version} · ` : ""}
                          {agent.updated}更新
                        </span>
                      </span>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
                <button
                  type="button"
                  className="directory-new"
                  onClick={() => onOpenAgent("new")}
                >
                  <Plus size={16} />
                  新建 Agent
                </button>
              </div>
            ) : (
              <div className="agent-table-scroll">
                <table className="agent-table">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>状态</th>
                      {showVersions && <th>版本</th>}
                      <th className="skills-column">技能</th>
                      <th>最近更新</th>
                      <th>
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => (
                      <tr key={agent.id}>
                        <td>
                          <button
                            type="button"
                            className="agent-table-name"
                            onClick={() => onOpenAgent(agent)}
                          >
                            <span className="agent-inline-icon">
                              <agent.icon size={17} />
                            </span>
                            <span>
                              <strong>{agent.name}</strong>
                              <small>{agent.code}</small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span
                            className={`agent-state ${agent.status === "未发布" ? "draft" : ""}`}
                          >
                            <i />
                            {agent.status}
                          </span>
                        </td>
                        {showVersions && (
                          <td className="mono">{agent.version}</td>
                        )}
                        <td className="skills-column">
                          {agent.skills.length} 项技能
                        </td>
                        <td className="table-time">{agent.updated}</td>
                        <td>
                          <button
                            className="table-open"
                            type="button"
                            aria-label={`打开${agent.name}`}
                            onClick={() => onOpenAgent(agent)}
                          >
                            <ChevronRight size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="table-footer">
                  {agents.length} 个 Agent<span>所有者：Huayi</span>
                </div>
              </div>
            )}
            <section className="recent-runs">
              <div className="section-heading">
                <h2>最近测试</h2>
                <span>示例记录</span>
              </div>
              {sampleRuns.map((run) => (
                <button
                  type="button"
                  className="run-row"
                  key={run.id}
                  onClick={onTest}
                >
                  <span className="run-check">
                    <Check size={12} />
                  </span>
                  <span className="run-description">
                    <strong>{run.title}</strong>
                    <small>
                      {run.agent} · {run.id}
                    </small>
                  </span>
                  <span className="run-duration mono">{run.duration}</span>
                  <time>{run.time}</time>
                  <ChevronRight size={13} />
                </button>
              ))}
            </section>
          </div>
          <aside className="collection-aside">
            <section>
              <span className="aside-label">工作空间概况</span>
              <dl className="workspace-facts">
                <div>
                  <dt>已发布</dt>
                  <dd>
                    2<span> / 3</span>
                  </dd>
                </div>
                <div>
                  <dt>绑定技能</dt>
                  <dd>
                    8<span> 项</span>
                  </dd>
                </div>
                <div>
                  <dt>关联 SOP</dt>
                  <dd>
                    1<span> 个</span>
                  </dd>
                </div>
              </dl>
            </section>
            <section className="aside-note">
              <FileText size={17} />
              <h2>草稿与发布版本</h2>
              <p>
                修改保存到草稿。发布后生成固定版本，已绑定的 SOP
                继续使用原有版本。
              </p>
            </section>
            <section className="aside-workflow">
              <span className="aside-label">关联工作流</span>
              <button type="button" onClick={onWorkflow}>
                <span className="workflow-line-icon">↳</span>
                <span>
                  每周行业简报<small>使用 行业研究助手 v1.2</small>
                </span>
                <ArrowRight size={13} />
              </button>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
