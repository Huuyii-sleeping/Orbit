import type { WorkflowRunStatus } from "@orbit/workflow-core";
import { useState } from "react";
import { AgentEditor } from "../features/agents/components/AgentEditor";
import { AgentList } from "../features/agents/components/AgentList";
import "../features/agents/styles/workbench.css";
import type { AgentViewProps } from "../features/agents/components/agent-view-types";

/** 装配 Agent 列表与配置页，领域状态由 useAgents 管理。 */
export function AgentView(props: AgentViewProps) {
  const [testStates, setTestStates] = useState<Record<string, WorkflowRunStatus>>({});
  const [detailId, setDetailId] = useState<string | null>(null);
  const showEditor = props.isNewDraft || props.agents.some((agent) => agent.id === detailId);

  if (showEditor) {
    return <section className={`view-pad ${props.active ? "" : "view-hide"}`} data-view="agent"><AgentEditor {...props} onSaveAgent={async () => {
      const saved = await props.onSaveAgent();
      if (saved) setDetailId(saved.id);
    }} onTestStatus={(status) => { if (props.activeAgent) setTestStates((states) => ({ ...states, [props.activeAgent!.id]: status })); }} onBack={() => {
      if (props.isNewDraft) props.onDiscardDraft();
      setDetailId(null);
    }} /></section>;
  }
  return <AgentList {...props} testStates={testStates} onOpen={(agent) => {
    props.onSelectAgent(agent);
    setDetailId(agent.id);
  }} />;
}
