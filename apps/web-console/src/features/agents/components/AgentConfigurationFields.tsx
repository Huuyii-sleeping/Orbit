import { normalizeAgentConfiguration } from "@orbit/workflow-core";
import type { ReactNode } from "react";
import type { AgentProfileInput } from "../../../api/index";
import { AgentModelFields } from "./AgentModelFields";
import { AgentToolFields } from "./AgentToolFields";
import { AgentOutputFields } from "./AgentOutputFields";

/** 装配模型选择、可用能力与输出配置，各区块独立管理交互。 */
export function AgentConfigurationFields({
  draft,
  onChange,
  onValidityChange,
  children,
}: {
  draft: AgentProfileInput;
  onChange: (draft: AgentProfileInput) => void;
  onValidityChange: (valid: boolean) => void;
  children?: ReactNode;
}) {
  const configuration = normalizeAgentConfiguration(draft.configuration);
  return (
    <>
      <AgentModelFields
        value={configuration.modelId}
        onChange={(modelId) =>
          onChange({ ...draft, configuration: { ...configuration, modelId } })
        }
      />
      <section
        className="agent-config-card"
        aria-labelledby="agent-capabilities-heading"
      >
        <header className="agent-config-heading">
          <h2 id="agent-capabilities-heading">能力</h2>
          <p>技能提供处理方法，工具授权决定 Agent 能执行哪些操作。</p>
        </header>
        {children}
        <AgentToolFields
          value={configuration.allowedToolIds}
          onChange={(allowedToolIds) =>
            onChange({
              ...draft,
              configuration: { ...configuration, allowedToolIds },
            })
          }
        />
      </section>
      <section
        className="agent-config-card agent-advanced-card"
        aria-labelledby="agent-advanced-heading"
      >
        <header className="agent-config-heading">
          <h2 id="agent-advanced-heading">高级配置</h2>
          <p>默认输出文本，需要向工作流传递指定字段时再调整。</p>
        </header>
        <AgentOutputFields
          configuration={configuration}
          onChange={(next) => onChange({ ...draft, configuration: next })}
          onValidityChange={onValidityChange}
        />
      </section>
    </>
  );
}
