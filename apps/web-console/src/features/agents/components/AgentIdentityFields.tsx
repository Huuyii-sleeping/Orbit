import { Check } from "lucide-react";
import type { AgentProfileInput } from "../../../api/index";
import { AgentActionLabels } from "./AgentActionLabels";
import { ACCENT_PALETTE } from "../lib/agent-appearance";

/** 编辑 Agent 卡片的名称、用途和视觉标识。 */
export function AgentIdentityFields({
  draft,
  onDraftChange,
}: {
  draft: AgentProfileInput;
  agentId?: string;
  isNewDraft: boolean;
  onDraftChange: (draft: AgentProfileInput) => void;
}) {
  return (
    <section
      className="agent-config-card"
      aria-labelledby="agent-identity-heading"
    >
      <header className="agent-config-heading">
        <h2 id="agent-identity-heading">基本信息</h2>
        <p>给 Agent 命名，并说明它的用途。</p>
      </header>
      <div className="field">
        <label htmlFor="agent-name">
          名称 <span className="agent-required">必填</span>
        </label>
        <input
          className="input"
          id="agent-name"
          maxLength={36}
          value={draft.name}
          placeholder="例如：代码审查助手"
          onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="agent-description">描述</label>
        <textarea
          className="input"
          rows={2}
          id="agent-description"
          placeholder="简要说明这个 Agent 负责什么"
          maxLength={140}
          value={draft.description}
          onChange={(e) =>
            onDraftChange({ ...draft, description: e.target.value })
          }
        />
      </div>
      <details className="agent-display-settings">
        <summary>
          展示设置 <span>场景、颜色与操作标签</span>
        </summary>
        <div className="field">
          <label htmlFor="agent-scenario">适用场景</label>
          <textarea
            className="input"
            rows={2}
            id="agent-scenario"
            placeholder="例如：提交前检查、文档整理"
            maxLength={180}
            value={draft.scenario}
            onChange={(e) =>
              onDraftChange({ ...draft, scenario: e.target.value })
            }
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
                {draft.color === c.value ? (
                  <Check aria-hidden="true" width={14} height={14} />
                ) : null}
              </button>
            ))}
          </div>
          <div className="draft-sub">选择卡片颜色，或使用自动配色。</div>
        </div>
        <AgentActionLabels
          value={draft.actions}
          onChange={(actions) => onDraftChange({ ...draft, actions })}
        />
      </details>
    </section>
  );
}
