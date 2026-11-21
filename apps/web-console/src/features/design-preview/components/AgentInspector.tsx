import { ArrowRight, Check, Circle, FileText } from "lucide-react";
import type { PreviewAgent } from "../design-data";

/** 所选 Agent 的配置、技能和测试摘要。 */
export function AgentInspector({
  agent,
  onOpen,
  onTest,
  showVersions,
}: {
  agent: PreviewAgent;
  onOpen: () => void;
  onTest: () => void;
  showVersions: boolean;
}) {
  return (
    <section className="agent-inspector" aria-label="Agent 详情">
      <div className="inspector-title">
        <span className="agent-inline-icon">
          <agent.icon size={24} />
        </span>
        <span className="mono">{agent.code}</span>
        <span
          className={`agent-state ${agent.status === "未发布" ? "draft" : ""}`}
        >
          <i />
          {agent.status}
        </span>
      </div>
      <h2>{agent.name}</h2>
      <p className="inspector-description">{agent.description}</p>
      <div className="inspector-actions">
        <button type="button" className="workspace-primary" onClick={onTest}>
          测试对话
          <ArrowRight size={14} />
        </button>
        <button type="button" className="scene-secondary" onClick={onOpen}>
          编辑配置
        </button>
      </div>
      <dl className="inspector-properties">
        {showVersions && (
          <div>
            <dt>发布版本</dt>
            <dd>{agent.version}</dd>
          </div>
        )}
        <div>
          <dt>使用场景</dt>
          <dd>{agent.category}</dd>
        </div>
        <div>
          <dt>所有者</dt>
          <dd>
            <span className="owner-dot">H</span>
            {agent.owner}
          </dd>
        </div>
        <div>
          <dt>最近更新</dt>
          <dd>{agent.updated}</dd>
        </div>
      </dl>
      <div className="inspector-section">
        <h3>
          绑定技能<span>{agent.skills.length}</span>
        </h3>
        {agent.skills.map((skill) => (
          <div className="inspector-skill" key={skill}>
            <FileText size={14} />
            <span>{skill}</span>
            <span>已绑定</span>
          </div>
        ))}
      </div>
      <div className="inspector-section">
        <h3>最近测试</h3>
        <div className="inspector-test">
          <span className="run-check">
            {agent.lastTest === "通过" ? (
              <Check size={12} />
            ) : (
              <Circle size={10} />
            )}
          </span>
          <span>
            {agent.lastTest === "通过" ? "测试通过" : "尚未运行测试"}
            <small>
              {agent.lastTest === "通过"
                ? "今天 09:42 · 示例运行记录"
                : "配置完成后，可发起测试对话。"}
            </small>
          </span>
        </div>
      </div>
      <p className="inspector-footnote">
        在正式工作台中，发布操作会生成不可变版本。
      </p>
    </section>
  );
}
