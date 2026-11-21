import { ErrorNotice } from "../../../components/feedback/ErrorNotice";
import { ArrowLeft, Check, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import type { SkillRegistryItem } from "../../../api";
import type { AgentViewProps } from "./agent-view-types";

function skillBindingFromRegistryItem(skill: SkillRegistryItem) {
  return {
    skillId: skill.id,
    version: skill.installedVersion || skill.version,
    sourceType: skill.sourceType,
    registrySource: skill.registrySource,
  };
}

/* ── Card personalization ─────────────────────────────────── */

/** Shared accent palette used by both the auto-hash fallback and the color picker. */
const ACCENT_PALETTE: readonly { value: string; label: string }[] = [
  { value: "#3b82f6", label: "蓝" },
  { value: "#8b5cf6", label: "紫" },
  { value: "#f59e0b", label: "琥珀" },
  { value: "#ec4899", label: "粉" },
  { value: "#06b6d4", label: "青" },
  { value: "#84cc16", label: "青柠" },
  { value: "#f43f5e", label: "玫红" },
];

/** Stable accent color derived from agent id (deterministic, no random). */
function agentAccent(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return ACCENT_PALETTE[Math.abs(hash) % ACCENT_PALETTE.length].value;
}

/** Resolve an agent's effective accent: explicit color wins, else deterministic hash. */
function resolveAccent(color: string, id: string): string {
  return color || agentAccent(id);
}

/** 编辑 Agent 配置，保留技能锁定和服务端预检。 */
export function AgentEditor({ active, draft, activeAgent, isNewDraft, error, saving, installedSkills, skillPreflight, skillPreflightLoading, onDraftChange, onResolveAgentSkills, onSaveAgent, onDiscardDraft, onDeleteAgent, onRefresh, onBack }: AgentViewProps & { onBack: () => void }) {
  const effActive = activeAgent;
  const detailAccent = resolveAccent(draft.color, effActive?.id ?? "new-agent");
  const selectedSkillSet = new Set(draft.skillIds);
  const runtimeOk = skillPreflight?.ok ?? false;

  function toggleSkill(skillId: string): void {
    const nextSkillIds = selectedSkillSet.has(skillId)
      ? draft.skillIds.filter((id) => id !== skillId)
      : [...draft.skillIds, skillId];
    onDraftChange({
      ...draft,
      skillIds: nextSkillIds,
      skills: installedSkills
        .filter((skill) => nextSkillIds.includes(skill.id))
        .map(skillBindingFromRegistryItem),
    });
  }

  function updateAction(index: number, value: string): void {
    onDraftChange({ ...draft, actions: draft.actions.map((action, i) => (i === index ? value : action)) });
  }

  function removeAction(index: number): void {
    onDraftChange({ ...draft, actions: draft.actions.filter((_, i) => i !== index) });
  }

  function addAction(): void {
    onDraftChange({ ...draft, actions: [...draft.actions, "新的自定义操作"] });
  }

  /* ── Detail (full config) ─────────────────────────────────── */
  return (
    <section className={`view-pad ${active ? "" : "view-hide"}`} data-view="agent">
      {error ? <ErrorNotice message={error} onRetry={onRefresh} /> : null}
      {/* back header */}
      <div className="ag-detail-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} disabled={saving}>
          <ArrowLeft aria-hidden="true" /> 返回列表
        </button>
        <div style={{ flex: 1 }} />
        {(effActive || isNewDraft) ? (
          <span className={`pill ${isNewDraft ? "" : "green"}`}>
            <span className="d" />{isNewDraft ? "新草稿" : "草稿"}
          </span>
        ) : null}
      </div>

      {/* empty state when no agent selected */}
      {!effActive && !isNewDraft ? (
        <div className="ag-empty" style={{ marginTop: 80 }}>
          <ShieldCheck aria-hidden="true" width={36} height={36} />
          <b>没有选中的 Agent</b>
          <span>从列表选择一个 Agent，或新建一个。</span>
        </div>
      ) : (
        <>
          {/* identity */}
          <div className="ag-section">
            <div className="ag-s-h">
              <span
                className="icon-box"
                aria-hidden="true"
                style={{ color: detailAccent, borderColor: detailAccent + "44", background: detailAccent + "14" }}
              >
                <Pencil aria-hidden="true" />
              </span>
              <div>
                <div className="nm">{draft.name || "未命名 Agent"}</div>
                {isNewDraft ? (
                  <span className="pill"><span className="d" />草稿</span>
                ) : (
                  <span className="pill"><span className="d" />草稿</span>
                )}
              </div>
            </div>
            <div className="field">
              <label htmlFor="agent-name">名称</label>
              <input
                className="input"
                id="agent-name"
                value={draft.name}
                onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="agent-description">描述</label>
              <textarea
                className="input"
                rows={2}
                id="agent-description"
                value={draft.description}
                onChange={(e) => onDraftChange({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="agent-scenario">适用场景</label>
              <textarea
                className="input"
                rows={2}
                id="agent-scenario"
                value={draft.scenario}
                onChange={(e) => onDraftChange({ ...draft, scenario: e.target.value })}
              />
            </div>
            <div className="field">
              <label>主题色</label>
              <div className="color-picker">
                <button
                  type="button"
                  className={`color-swatch color-swatch--auto ${draft.color === "" ? "is-active" : ""}`}
                  aria-pressed={draft.color === ""}
                  title="自动（按 ID 哈希分配）"
                  onClick={() => onDraftChange({ ...draft, color: "" })}
                >
                  自动
                </button>
                {ACCENT_PALETTE.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`color-swatch ${draft.color === c.value ? "is-active" : ""}`}
                    style={{ background: c.value }}
                    aria-pressed={draft.color === c.value}
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => onDraftChange({ ...draft, color: c.value })}
                  >
                    {draft.color === c.value ? <Check aria-hidden="true" width={14} height={14} /> : null}
                  </button>
                ))}
              </div>
              <div className="draft-sub">选“自动”时按 Agent ID 稳定分配颜色；选定颜色后会持久化到该 Agent。</div>
            </div>
          </div>

          {/* skills */}
          <div className="ag-section">
            <div className="field">
              <label>已绑定技能</label>
              {installedSkills.length === 0 ? (
                <div className="draft-sub">没有已安装技能，请先到 Skill Hub 安装。</div>
              ) : (
                <div className="check-list">
                  {installedSkills.map((skill) => {
                    const selected = selectedSkillSet.has(skill.id);
                    return (
                      <button type="button" key={skill.id}
                        className="check"
                        aria-pressed={selected}
                        onClick={() => toggleSkill(skill.id)}
                      >
                        <span className="nm">{skill.name}</span>
                        {selected ? (
                          <span className="ok"><span className="d" />已绑定</span>
                        ) : (
                          <span className="warn"><span className="d" />未绑定</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* preflight */}
          <div className="ag-section">
            <div className="field">
              <label>技能预检</label>
              <div className="check-list">
                <div className="check">
                  <span className="nm">技能可解析</span>
                  <span className={runtimeOk ? "ok" : "warn"}>
                    <span className="d" />{skillPreflightLoading ? "检查中" : runtimeOk ? "通过" : skillPreflight ? "未通过" : "未检查"}
                  </span>
                </div>
              </div>
              {skillPreflight && !skillPreflight.ok ? <p className="draft-sub" role="alert">{skillPreflight.message}{skillPreflight.issues.map((issue) => <span className="preflight-issue" key={`${issue.skillId}:${issue.code}`}>{issue.skillId} · {issue.message}</span>)}</p> : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: "flex-start", marginTop: 10 }}
                onClick={onResolveAgentSkills}
                disabled={saving || skillPreflightLoading}
              >
                <RefreshCw aria-hidden="true" /> 运行预检
              </button>
            </div>
          </div>

          {/* custom actions */}
          <div className="ag-section">
            <div className="field">
              <label>自定义动作</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {draft.actions.map((action, index) => (
                  <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      value={action}
                      onChange={(e) => updateAction(index, e.target.value)}
                    />
                    <button
                      type="button"
                      className="tool-btn"
                      aria-label="移除操作"
                      onClick={() => removeAction(index)}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={addAction}>
                  <Plus aria-hidden="true" /> 添加动作
                </button>
              </div>
            </div>
          </div>

          {/* system prompt */}
          <div className="ag-section">
            <div className="field">
              <label htmlFor="agent-systemPrompt">系统提示</label>
              <textarea
                className="input"
                rows={6}
                style={{ fontFamily: "var(--ff-mono)", fontSize: 12.5 }}
                id="agent-systemPrompt"
                value={draft.systemPrompt}
                onChange={(e) => onDraftChange({ ...draft, systemPrompt: e.target.value })}
              />
            </div>
          </div>

          {/* actions */}
          <div className="ag-actions">
            <button type="button" className="btn btn-primary" onClick={onSaveAgent} disabled={saving}>
              <Check aria-hidden="true" />{saving ? "保存中…" : "保存配置"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onDiscardDraft} disabled={saving}>
              重置草稿
            </button>
            {activeAgent ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => onDeleteAgent(activeAgent)} disabled={saving}>
                  <Trash2 aria-hidden="true" /> 删除此 Agent
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => onRefresh()} disabled={saving}>
                  <RefreshCw aria-hidden="true" /> 刷新数据
                </button>
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
