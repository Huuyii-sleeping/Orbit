import { useEffect, useState } from "react";
import { fetchAgentTools, type AgentToolOption } from "../../../api/index";
import { agentToolGroup, agentToolLabels } from "../lib/agent-tool-groups";

/** 逐项授权 Agent 可调用的真实工具，内部管理工具默认收起。 */
export function AgentToolFields({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [tools, setTools] = useState<AgentToolOption[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  async function load() {
    try {
      setTools(await fetchAgentTools());
      setError("");
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工具目录加载失败。");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const filtered = tools.filter((tool) =>
    `${agentToolLabels[tool.name] ?? ""} ${tool.name} ${tool.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  function group(name: string) {
    const entries = filtered.filter(
      (tool) => agentToolGroup(tool.name) === name,
    );
    if (!entries.length) return null;
    return (
      <fieldset className="agent-tool-group" key={name}>
        <legend>{name}</legend>
        {entries.map((tool) => (
          <label key={tool.name} className="agent-tool-option">
            <input
              type="checkbox"
              checked={value.includes(tool.name)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, tool.name]
                    : value.filter((id) => id !== tool.name),
                )
              }
            />
            <span>
              <b>{agentToolLabels[tool.name] || tool.name}</b>
              <small>
                {tool.name} · {tool.description}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <details className="agent-capabilities">
      <summary>工具授权 · 已授权 {value.length} 项</summary>
      <p className="draft-sub">
        控制这个 Agent
        能执行哪些操作。默认只生成回答；勾选后才能读取文件、执行命令等。绑定技能不会自动授权工具。
      </p>
      <div className="field">
        <label htmlFor="agent-tool-search">查找能力</label>
        <input
          id="agent-tool-search"
          className="input"
          placeholder="搜索名称或工具 ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="agent-field-error">
          {error}{" "}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void load()}
          >
            重试
          </button>
        </p>
      ) : !loaded ? (
        <p role="status">加载工具目录…</p>
      ) : null}
      <div className="agent-tool-list">
        {["文件", "命令", "记忆", "技能与任务"].map(group)}
        <details className="agent-internal-tools">
          <summary>
            高级工具 ·{" "}
            {
              filtered.filter(
                (tool) => agentToolGroup(tool.name) === "高级工具",
              ).length
            }
          </summary>
          {group("高级工具")}
        </details>
      </div>
      {loaded
        ? value
            .filter((id) => !tools.some((tool) => tool.name === id))
            .map((id) => (
              <div className="agent-unavailable-tool" key={id}>
                <span>{id} · 当前不可用</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onChange(value.filter((item) => item !== id))}
                >
                  移除授权
                </button>
              </div>
            ))
        : null}
    </details>
  );
}
