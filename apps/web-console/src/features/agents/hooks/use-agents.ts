import { getErrorMessage } from "../../../lib/errors/error-factory";
import { useMemo, useState } from "react";
import {
  createAgentProfile,
  deleteAgentProfile,
  fetchAgents,
  updateAgentProfile,
  resolveAgentSkills,
  defaultAgentProfileInput,
  type AgentProfile,
  type AgentProfileInput,
  type AgentRuntimeContext,
  type AgentSkillPreflightResult,
} from "../../../api/index";
import { agentDraftFromProfile } from "../lib/agent-profile";

/** 管理 Agent 草稿、保存和绑定技能检查。 */
export function useAgents(
  onOpen: () => void,
) {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentProfileInput>(
    defaultAgentProfileInput,
  );
  const [isNewAgentDraft, setIsNewAgentDraft] = useState(false);
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentSkillPreflight, setAgentSkillPreflight] =
    useState<AgentSkillPreflightResult | null>(null);
  const [agentSkillPreflightLoading, setAgentSkillPreflightLoading] =
    useState(false);
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [agents, activeAgentId],
  );

  function runtimeContextFromDraft(): AgentRuntimeContext {
    return {
      id: activeAgent?.id ?? "draft-agent",
      name: agentDraft.name,
      skills: agentDraft.skills,
    };
  }

  async function refreshAgents(selectFirst = false): Promise<AgentProfile[]> {
    const nextAgents = await fetchAgents();
    setAgents(nextAgents);
    const nextActiveAgent =
      nextAgents.find((agent) => agent.id === activeAgentId) ??
      (selectFirst ? (nextAgents[0] ?? null) : null);
    if (nextActiveAgent) {
      setActiveAgentId(nextActiveAgent.id);
      setAgentDraft(agentDraftFromProfile(nextActiveAgent));
      setIsNewAgentDraft(false);
    } else if (nextAgents.length === 0) {
      setActiveAgentId(null);
      setAgentDraft(defaultAgentProfileInput);
      setIsNewAgentDraft(false);
    }
    return nextAgents;
  }

  async function refreshAgentsSafely(selectFirst = false): Promise<void> {
    try {
      await refreshAgents(selectFirst);
      setAgentError(null);
    } catch (err) {
      setAgentError(getErrorMessage(err));
    }
  }


  function selectAgent(agent: AgentProfile): void {
    setActiveAgentId(agent.id);
    setAgentDraft(agentDraftFromProfile(agent));
    setAgentSkillPreflight(null);
    setIsNewAgentDraft(false);
  }

  function handleCreateAgent(): void {
    setActiveAgentId(null);
    setAgentDraft({
      ...defaultAgentProfileInput,
    });
    setAgentSkillPreflight(null);
    setIsNewAgentDraft(true);
    onOpen();
    setAgentError(null);
  }

  function handleAgentDraftChange(nextDraft: AgentProfileInput): void {
    setAgentDraft(nextDraft);
    setAgentSkillPreflight(null);
  }

  async function handleResolveAgentSkills(): Promise<void> {
    setAgentSkillPreflightLoading(true);
    try {
      setAgentSkillPreflight(
        await resolveAgentSkills(runtimeContextFromDraft()),
      );
      setAgentError(null);
    } catch (err) {
      setAgentError(getErrorMessage(err));
    } finally {
      setAgentSkillPreflightLoading(false);
    }
  }

  async function handleSaveAgent() {
    if (!activeAgent && !isNewAgentDraft) {
      return null;
    }
    if (!agentDraft.name.trim() || !agentDraft.systemPrompt.trim()) {
      setAgentError("请填写 Agent 名称和职责。");
      return null;
    }
    setAgentSaving(true);
    try {
      const draftToSave = agentDraft;
      const agent = activeAgent
        ? await updateAgentProfile(activeAgent.id, draftToSave)
        : await createAgentProfile(draftToSave);
      setAgents((current) =>
        activeAgent
          ? current.map((item) => (item.id === agent.id ? agent : item))
          : [agent, ...current],
      );
      setActiveAgentId(agent.id);
      setAgentDraft(agentDraftFromProfile(agent));
      setAgentSkillPreflight(null);
      setIsNewAgentDraft(false);
      onOpen();
      setAgentError(null);
      return agent;
    } catch (err) {
      setAgentError(getErrorMessage(err));
      return null;
    } finally {
      setAgentSaving(false);
    }
  }

  async function handleDeleteAgent(agent: AgentProfile): Promise<void> {
    setAgentSaving(true);
    try {
      await deleteAgentProfile(agent.id);
      const nextAgents = agents.filter((item) => item.id !== agent.id);
      setAgents(nextAgents);
      const nextAgent = nextAgents[0] ?? null;
      setActiveAgentId(nextAgent?.id ?? null);
      setAgentDraft(
        nextAgent ? agentDraftFromProfile(nextAgent) : defaultAgentProfileInput,
      );
      setAgentSkillPreflight(null);
      setIsNewAgentDraft(false);
      onOpen();
      setAgentError(null);
    } catch (err) {
      setAgentError(getErrorMessage(err));
    } finally {
      setAgentSaving(false);
    }
  }

  function discardAgentDraft(): void {
    const nextAgent = activeAgent ?? agents[0] ?? null;
    setActiveAgentId(nextAgent?.id ?? null);
    setAgentDraft(
      nextAgent ? agentDraftFromProfile(nextAgent) : defaultAgentProfileInput,
    );
    setAgentSkillPreflight(null);
    setIsNewAgentDraft(false);
    setAgentError(null);
    onOpen();
  }

  return {
    agents,
    activeAgent,
    activeAgentId,
    agentDraft,
    isNewAgentDraft,
    agentSaving,
    agentError,
    agentSkillPreflight,
    agentSkillPreflightLoading,
    refreshAgentsSafely,
    selectAgent,
    handleCreateAgent,
    handleAgentDraftChange,
    handleResolveAgentSkills,
    handleSaveAgent,
    handleDeleteAgent,
    discardAgentDraft,
  };
}
