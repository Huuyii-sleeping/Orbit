import { ErrorNotice } from "../../../components/feedback/ErrorNotice";
import { useState } from "react";
import { ArrowLeft, Check, RefreshCw, Trash2 } from "lucide-react";
import {
  stableSerialize,
  type WorkflowRunSnapshot,
} from "@orbit/workflow-core";
import type {
  AgentProfile,
  AgentProfileInput,
  AgentSkillPreflightResult,
  SkillRegistryItem,
} from "../../../api/index";
import { AgentIdentityFields } from "./AgentIdentityFields";
import { agentDraftFromProfile } from "../lib/agent-profile";
import { AgentConfigurationFields } from "./AgentConfigurationFields";
import { AgentWorkbench } from "./AgentWorkbench";
import { AgentSkillFields } from "./AgentSkillFields";

/** Agent 配置页的业务操作由领域 hook 提供。 */
export type AgentEditorProps = {
  draft: AgentProfileInput;
  activeAgent: AgentProfile | null;
  isNewDraft: boolean;
  error: string | null;
  saving: boolean;
  installedSkills: SkillRegistryItem[];
  skillPreflight: AgentSkillPreflightResult | null;
  skillPreflightLoading: boolean;
  onDraftChange: (draft: AgentProfileInput) => void;
  onResolveAgentSkills: () => void;
  onSaveAgent: () => void;
  onDiscardDraft: () => void;
  onDeleteAgent: (agent: AgentProfile) => void;
  onRefresh: () => void;
  onBack: () => void;
  onTestStatus: (status: WorkflowRunSnapshot["status"]) => void;
};

/** 单个 Agent 的身份、运行配置及测试工作区。 */
export function AgentEditor(props: AgentEditorProps) {
  const {
    draft,
    activeAgent,
    isNewDraft,
    error,
    saving,
    installedSkills,
    skillPreflight,
    skillPreflightLoading,
    onDraftChange,
    onResolveAgentSkills,
    onSaveAgent,
    onDiscardDraft,
    onDeleteAgent,
    onRefresh,
    onBack,
    onTestStatus,
  } = props;
  const [tab, setTab] = useState<"config" | "test" | "versions">("config");
  const [configValid, setConfigValid] = useState(true);
  const [formRevision, setFormRevision] = useState(0);
  const dirty =
    !activeAgent ||
    stableSerialize(draft) !==
      stableSerialize(agentDraftFromProfile(activeAgent)) ||
    !configValid;

  return (
    <>
      <div className="ag-detail-head">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onBack}
          disabled={saving}
        >
          <ArrowLeft aria-hidden="true" /> 返回列表
        </button>
        <span className="agent-editor-title">{draft.name || "新 Agent"}</span>
        <span className="pill">
          {isNewDraft ? "新建草稿" : dirty ? "有未保存修改" : "草稿已保存"}
        </span>
      </div>
      {error ? <ErrorNotice message={error} onRetry={onRefresh} /> : null}
      <div
        className="agent-editor-tabs"
        role="tablist"
        aria-label="Agent 工作区"
      >
        {(
          [
            { id: "config", label: "配置" },
            { id: "test", label: "试跑" },
            { id: "versions", label: "版本" },
          ] as const
        ).map((item) => (
          <button
            type="button"
            role="tab"
            key={item.id}
            id={`agent-tab-${item.id}`}
            aria-controls={`agent-panel-${item.id}`}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              const ids = ["config", "test", "versions"] as const;
              const index = ids.indexOf(tab);
              const next =
                event.key === "ArrowRight"
                  ? ids[(index + 1) % 3]
                  : event.key === "ArrowLeft"
                    ? ids[(index + 2) % 3]
                    : event.key === "Home"
                      ? ids[0]
                      : event.key === "End"
                        ? ids[2]
                        : null;
              if (next) {
                event.preventDefault();
                setTab(next);
                document.getElementById(`agent-tab-${next}`)?.focus();
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="agent-editor-layout">
        <div
          className="agent-editor-config"
          role="tabpanel"
          id="agent-panel-config"
          aria-labelledby="agent-tab-config"
          hidden={tab !== "config"}
        >
          <AgentIdentityFields
            draft={draft}
            agentId={activeAgent?.id}
            isNewDraft={isNewDraft}
            onDraftChange={onDraftChange}
          />
          <section
            className="agent-config-card"
            aria-labelledby="agent-responsibility-heading"
          >
            <header className="agent-config-heading">
              <h2 id="agent-responsibility-heading">职责</h2>
              <p>定义 Agent 的任务、处理方式和回答要求。</p>
            </header>
            <div className="field">
              <label htmlFor="agent-system-prompt">
                系统提示 <span className="agent-required">必填</span>
              </label>
              <textarea
                id="agent-system-prompt"
                className="input agent-code-input"
                rows={7}
                maxLength={1600}
                value={draft.systemPrompt}
                placeholder="说明 Agent 的职责、处理方式和需要遵守的要求"
                onChange={(event) =>
                  onDraftChange({ ...draft, systemPrompt: event.target.value })
                }
              />
            </div>
          </section>
          <AgentConfigurationFields
            key={`${activeAgent?.id ?? "new"}-${formRevision}`}
            draft={draft}
            onChange={onDraftChange}
            onValidityChange={setConfigValid}
          >
            <AgentSkillFields
              draft={draft}
              installedSkills={installedSkills}
              skillPreflight={skillPreflight}
              skillPreflightLoading={skillPreflightLoading}
              saving={saving}
              onDraftChange={onDraftChange}
              onResolveAgentSkills={onResolveAgentSkills}
            />
          </AgentConfigurationFields>
          <div className="ag-actions agent-save-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                saving ||
                !configValid ||
                !draft.name.trim() ||
                !draft.systemPrompt.trim()
              }
              onClick={onSaveAgent}
            >
              <Check aria-hidden="true" />
              {saving ? "保存中…" : isNewDraft ? "创建 Agent" : "保存配置"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => {
                onDiscardDraft();
                setConfigValid(true);
                setFormRevision((value) => value + 1);
              }}
            >
              重置草稿
            </button>
            {activeAgent ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving}
                  onClick={() => onDeleteAgent(activeAgent)}
                >
                  <Trash2 aria-hidden="true" />
                  删除
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving}
                  onClick={onRefresh}
                >
                  <RefreshCw aria-hidden="true" />
                  刷新
                </button>
              </>
            ) : null}
          </div>
        </div>
        <div className="agent-editor-validation" hidden={tab === "config"}>
          {activeAgent ? (
            <AgentWorkbench
              key={activeAgent.id}
              agentId={activeAgent.id}
              view={tab === "versions" ? "versions" : "test"}
              dirty={dirty}
              disabled={
                saving ||
                !configValid ||
                !draft.name.trim() ||
                !draft.systemPrompt.trim()
              }
              onTestStatus={onTestStatus}
            />
          ) : (
            (["test", "versions"] as const).map((view) => (
              <div
                key={view}
                role="tabpanel"
                id={`agent-panel-${view}`}
                aria-labelledby={`agent-tab-${view}`}
                hidden={tab !== view}
                className="agent-config-card agent-test-empty"
              >
                <b>先创建 Agent</b>
                <p>保存名称和职责后，即可独立试跑并发布版本。</p>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setTab("config")}
                >
                  返回配置
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
