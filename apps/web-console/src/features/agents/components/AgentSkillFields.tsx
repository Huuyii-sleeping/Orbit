import { RefreshCw } from "lucide-react";
import type {
  AgentProfileInput,
  AgentSkillPreflightResult,
  SkillRegistryItem,
} from "../../../api/index";

/** 技能绑定与预检；技能不隐式授予工具权限。 */
export function AgentSkillFields({
  draft,
  installedSkills,
  skillPreflight,
  skillPreflightLoading,
  saving,
  onDraftChange,
  onResolveAgentSkills,
}: {
  draft: AgentProfileInput;
  installedSkills: SkillRegistryItem[];
  skillPreflight: AgentSkillPreflightResult | null;
  skillPreflightLoading: boolean;
  saving: boolean;
  onDraftChange: (draft: AgentProfileInput) => void;
  onResolveAgentSkills: () => void;
}) {
  const selected = new Set(draft.skillIds);
  const missing = draft.skills.filter(
    (binding) => !installedSkills.some((skill) => skill.id === binding.skillId),
  );

  function toggleSkill(skill: SkillRegistryItem) {
    const bindings = selected.has(skill.id)
      ? draft.skills.filter((binding) => binding.skillId !== skill.id)
      : [
          ...draft.skills,
          {
            skillId: skill.id,
            version: skill.installedVersion || skill.version,
            sourceType: skill.sourceType,
            registrySource: skill.registrySource,
          },
        ];
    onDraftChange({
      ...draft,
      skills: bindings,
      skillIds: bindings.map((binding) => binding.skillId),
    });
  }

  return (
    <details className="agent-skill-fields">
      <summary>技能 · 已绑定 {draft.skills.length} 项</summary>
      <div className="field">
        <label>绑定技能 · {draft.skills.length} 项</label>
        {!installedSkills.length ? (
          <p className="draft-sub">
            没有已安装技能，可先创建 Agent，或前往技能市场安装。
          </p>
        ) : (
          <div className="check-list">
            {installedSkills.map((skill) => (
              <label className="agent-tool-option" key={skill.id}>
                <input
                  type="checkbox"
                  checked={selected.has(skill.id)}
                  onChange={() => toggleSkill(skill)}
                />
                <span>
                  <b>{skill.name}</b>
                  <small>
                    {draft.skills.find(
                      (binding) => binding.skillId === skill.id,
                    )?.version ||
                      skill.installedVersion ||
                      skill.version}
                  </small>
                </span>
              </label>
            ))}
          </div>
        )}
        {missing.map((binding) => (
          <div className="agent-unavailable-tool" key={binding.skillId}>
            <span>{binding.skillId} · 当前未安装</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const skills = draft.skills.filter(
                  (item) => item.skillId !== binding.skillId,
                );
                onDraftChange({
                  ...draft,
                  skills,
                  skillIds: skills.map((item) => item.skillId),
                });
              }}
            >
              移除绑定
            </button>
          </div>
        ))}
        <div className="ag-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onResolveAgentSkills}
            disabled={saving || skillPreflightLoading}
          >
            <RefreshCw aria-hidden="true" />
            {skillPreflightLoading ? "检查中…" : "检查技能加载"}
          </button>
        </div>
        {skillPreflight?.ok ? (
          <p role="status">技能加载通过 · {skillPreflight.skills.length} 项</p>
        ) : skillPreflight ? (
          <div role="alert" className="agent-field-error">
            <p>{skillPreflight.message}</p>
            {skillPreflight.issues.map((issue) => (
              <p key={issue.skillId}>
                {issue.skillId}：{issue.message}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
