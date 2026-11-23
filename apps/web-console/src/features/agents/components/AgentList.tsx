import type { WorkflowRunStatus } from "@orbit/workflow-core";
import { ErrorNotice } from "../../../components/feedback/ErrorNotice";
import { useState } from "react";
import { Bot, ChevronRight, MessageSquare, RefreshCw } from "lucide-react";
import type { AgentProfile } from "../../../api/index";
import { selectAgentRows, type AgentListFilter, type AgentListSort } from "../lib/agent-list";
import type { AgentViewProps } from "./agent-view-types";

const testLabels: Record<WorkflowRunStatus, string> = { queued: "测试排队中", running: "测试运行中", waiting: "测试等待中", succeeded: "最近试跑通过", failed: "最近试跑失败", cancelled: "最近试跑已取消" };

const dateFormat = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** 使用真实 Agent 草稿与会话数据的紧凑列表。 */
export function AgentList({ active, agents, query, sessions, installedSkills, error, onRefresh, onNewAgent, onClearQuery, onOpen, testStates = {} }: Pick<AgentViewProps, "active" | "agents" | "query" | "sessions" | "installedSkills" | "error" | "onRefresh" | "onNewAgent" | "onClearQuery"> & { testStates?: Record<string, WorkflowRunStatus>; onOpen: (agent: AgentProfile) => void }) {
  const [filter, setFilter] = useState<AgentListFilter>("all");
  const [sort, setSort] = useState<AgentListSort>("updated");
  const rows = selectAgentRows(agents, query, filter, sort);
  const boundCount = agents.filter((agent) => agent.skills.length > 0).length;
  const filters: { id: AgentListFilter; label: string; count: number }[] = [
    { id: "all", label: "全部", count: agents.length },
    { id: "bound", label: "已绑定技能", count: boundCount },
    { id: "unbound", label: "未绑定技能", count: agents.length - boundCount },
  ];
  const recentSessions = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 5);

  return (
    <section className={`view-pad ${active ? "" : "view-hide"}`} data-view="agent">
      <div className="section-head">
        <h1 className="h2">Agent <span className="heading-count">{agents.length}</span></h1>
        <p className="sub">管理职责、绑定技能与测试配置。</p>
      </div>
      {error ? <ErrorNotice message={error} onRetry={onRefresh} /> : null}
      <div className="collection-toolbar">
        <div className="collection-filters" aria-label="按技能绑定筛选">
          {filters.map((item) => <button type="button" key={item.id} aria-pressed={filter === item.id} className={filter === item.id ? "on" : ""} onClick={() => setFilter(item.id)}>{item.label}<span>{item.count}</span></button>)}
        </div>
        <label className="collection-sort"><span className="sr-only">Agent 排序</span><select aria-label="Agent 排序" value={sort} onChange={(event) => setSort(event.target.value as AgentListSort)}><option value="updated">最近更新</option><option value="name">名称排序</option></select></label>
        <button type="button" className="tool-btn" aria-label="刷新 Agent 列表" onClick={onRefresh}><RefreshCw aria-hidden="true" /></button>
      </div>
      <div className="collection-layout">
        <div className="collection-main">
          <div className="agent-table-wrap">
            <table className="compact-agent-table">
              <thead><tr><th scope="col">名称</th><th scope="col">状态</th><th scope="col">技能</th><th scope="col">最近更新</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
              <tbody>{rows.map((agent) => <tr key={agent.id} className="agent-clickable-row" onClick={() => onOpen(agent)}>
                <td><button type="button" className="agent-row-name" onClick={(event) => { event.stopPropagation(); onOpen(agent); }}><span className="row-icon"><Bot aria-hidden="true" /></span><span><strong>{agent.name}</strong><small>{agent.scenario || agent.description || "未填写说明"}</small></span></button></td>
                <td><span className="row-state"><i />{testStates[agent.id] ? testLabels[testStates[agent.id]] : "草稿"}</span></td>
                <td>{agent.skills.length} 项技能</td>
                <td><time dateTime={agent.updatedAt ? new Date(agent.updatedAt).toISOString() : undefined}>{agent.updatedAt ? dateFormat.format(agent.updatedAt) : "—"}</time></td>
                <td><button type="button" className="tool-btn" aria-label={`编辑 ${agent.name}`} onClick={(event) => { event.stopPropagation(); onOpen(agent); }}><ChevronRight aria-hidden="true" /></button></td>
              </tr>)}</tbody>
            </table>
          </div>
          {rows.length === 0 ? <div className="collection-empty"><Bot aria-hidden="true" /><strong>{agents.length ? "没有匹配的 Agent" : "还没有 Agent"}</strong><p>{agents.length ? "调整搜索词或技能筛选后重试。" : "新建一个 Agent，配置职责与技能。"}</p><button type="button" className="btn btn-ghost btn-sm" onClick={agents.length ? () => { setFilter("all"); onClearQuery(); } : onNewAgent}>{agents.length ? "清除搜索与筛选" : "新建 Agent"}</button></div> : null}
          <div className="collection-footer"><span>{rows.length} 个 Agent</span><span>草稿配置</span></div>
          <section className="recent-sessions" aria-labelledby="recent-sessions-heading">
            <div className="list-section-heading"><h2 id="recent-sessions-heading">最近会话</h2><span>{sessions.length} 条记录</span></div>
            {recentSessions.length ? recentSessions.map((session) => <div className="recent-session" key={session.id}><MessageSquare aria-hidden="true" /><div><strong>{session.agent?.name ?? "Orbit"}</strong><small>{session.id}</small></div><span>{session.busy ? "运行中" : `${session.messageCount} 条消息`}</span><time>{session.updatedAt ? dateFormat.format(session.updatedAt) : "—"}</time></div>) : <p className="list-empty-note">暂无会话。在测试对话中创建会话后，记录会显示在这里。</p>}
          </section>
        </div>
        <aside className="collection-aside" aria-label="工作空间摘要">
          <h2>工作空间概览</h2><dl><div><dt>Agent 草稿</dt><dd>{agents.length}</dd></div><div><dt>已安装技能</dt><dd>{installedSkills.length}</dd></div><div><dt>测试会话</dt><dd>{sessions.length}</dd></div></dl>
          <div className="aside-note"><Bot aria-hidden="true" /><h3>从职责开始配置</h3><p>为 Agent 设置清晰的职责，绑定已安装技能，再通过测试对话检查实际表现。</p></div>
          <h2>配置说明</h2><p>列表展示可编辑的 Agent 草稿。技能绑定保留来源和版本，保存后用于新的测试会话。</p>
        </aside>
      </div>
    </section>
  );
}
