import { useState } from "react";
import {
  DEFAULT_AGENT_CONFIGURATION,
  normalizeAgentConfiguration,
  stableSerialize,
  type AgentConfiguration,
} from "@orbit/workflow-core";

/** 默认文本契约内置；折叠高级编辑器不会修改已配置的输出 schema。 */
export function AgentOutputFields({
  configuration,
  onChange,
  onValidityChange,
}: {
  configuration: AgentConfiguration;
  onChange: (configuration: AgentConfiguration) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [text, setText] = useState(() =>
    JSON.stringify(configuration.outputSchema, null, 2),
  );
  const [error, setError] = useState("");
  const custom =
    stableSerialize(configuration.outputSchema) !==
    stableSerialize(DEFAULT_AGENT_CONFIGURATION.outputSchema);
  function change(value: string) {
    setText(value);
    try {
      const config = normalizeAgentConfiguration({
        ...configuration,
        outputSchema: JSON.parse(value),
      });
      onChange(config);
      setError("");
      onValidityChange(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "输出格式无效。");
      onValidityChange(false);
    }
  }
  return (
    <section className="agent-output-fields">
      <div className="agent-output-summary">
        <strong>输出</strong>
        <span>{custom ? "自定义结构化结果" : "文本 · 内置格式"}</span>
      </div>
      <p className="draft-sub">
        默认返回文本结果，无需配置。给工作流传递指定字段时可自定义输出。
      </p>
      <details className="agent-output-advanced">
        <summary>高级输出配置{custom ? " · 已自定义" : ""}</summary>
        <div className="field">
          <label htmlFor="agent-output-schema">自定义输出 · JSON Schema</label>
          <textarea
            id="agent-output-schema"
            className="input agent-code-input"
            rows={9}
            value={text}
            aria-invalid={Boolean(error)}
            onChange={(e) => change(e.target.value)}
          />
          <p className="draft-sub">
            根类型须为 object；试跑和工作流会校验输出。收起面板会保留配置。
          </p>
        </div>
        {error ? (
          <p role="alert" className="agent-field-error">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() =>
            change(
              JSON.stringify(DEFAULT_AGENT_CONFIGURATION.outputSchema, null, 2),
            )
          }
        >
          恢复内置文本格式
        </button>
      </details>
    </section>
  );
}
