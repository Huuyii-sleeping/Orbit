import { useState } from "react";
import { AgentEditor } from "../../../features/agents/components/AgentEditor";
import { AgentList } from "../../../features/agents/components/AgentList";
import type { AgentViewProps } from "../../../features/agents/components/agent-view-types";

/** 装配 Agent 列表与配置页，领域状态由 useAgents 管理。 */
export function AgentView(props: AgentViewProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const showEditor = props.isNewDraft || props.agents.some((agent) => agent.id === detailId);

  if (showEditor) {
    return <AgentEditor {...props} onBack={() => {
      if (props.isNewDraft) props.onDiscardDraft();
      setDetailId(null);
    }} />;
  }
  return <AgentList {...props} onOpen={(agent) => {
    props.onSelectAgent(agent);
    setDetailId(agent.id);
  }} />;
}
