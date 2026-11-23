import type { AgentProfile, AgentProfileInput, AgentSkillPreflightResult, SkillRegistryItem, SessionSummary } from "../../../api/index";

/** Agent 列表与配置编辑共用的页面回调。 */
export type AgentViewProps = {
  active: boolean;
  agents: AgentProfile[];
  activeAgentId: string | null;
  onSelectAgent: (agent: AgentProfile) => void;
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
  onSaveAgent: () => Promise<AgentProfile | null>;
  onDiscardDraft: () => void;
  onDeleteAgent: (agent: AgentProfile) => void;
  onNewAgent: () => void;
  onRefresh: () => void;
  query: string;
  onClearQuery: () => void;
  sessions: SessionSummary[];
};
