import { useEffect, useState } from "react";
import {
  fetchModelConnections,
  type ModelConnectionCatalog,
  type ModelConnectionSummary,
} from "../../../api/model-connections";
import { ModelConnectionDialog } from "../../settings/components/ModelConnectionDialog";
import "../../settings/styles/models.css";

/** Agent 只选择模型引用；添加连接与设置页共用凭据表单。 */
export function AgentModelFields({
  value,
  onChange,
}: {
  value: string;
  onChange: (reference: string) => void;
}) {
  const [catalog, setCatalog] = useState<ModelConnectionCatalog | null>(null);
  const [adding, setAdding] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    try {
      setCatalog(await fetchModelConnections());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型目录加载失败。");
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  function saved(connection: ModelConnectionSummary) {
    onChange(connection.reference);
    setAdding(false);
    void refresh();
  }
  const deleted = catalog?.deletedConnections?.find((connection) => connection.reference === value || connection.previousReferences?.includes(value));
  const revised = catalog?.connections.find((connection) => connection.previousReferences?.includes(value));
  const known =
    catalog?.connections.some((connection) => connection.reference === value) ||
    catalog?.configuredModels.includes(value);
  return (
    <section
      className="agent-config-card"
      aria-labelledby="agent-model-heading"
    >
      <header className="agent-config-heading">
        <h2 id="agent-model-heading">模型</h2>
        <p>选择一个模型连接，用于这个 Agent 的任务执行。</p>
      </header>
      <div className="field">
        <label htmlFor="agent-model">使用模型</label>
        <select
          id="agent-model"
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">
            {catalog?.defaultModel
              ? `系统默认模型 · ${catalog.defaultModel}`
              : "请选择模型连接"}
          </option>
          {catalog?.connections.map((connection) => (
            <option key={connection.id} value={connection.reference}>
              {connection.name} · {connection.modelId}
            </option>
          ))}
          {catalog?.configuredModels.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
          {value && !known ? (
            <option value={value}>{deleted ? `${deleted.name} · 已删除配置（保留当前绑定）` : revised ? `${revised.name} · 历史修订（保持原配置）` : `当前模型 · ${value}`}</option>
          ) : null}
        </select>
        <p className="draft-sub">
          选择已保存的模型连接，多个 Agent 可复用同一连接。
        </p>
      </div>
      {deleted ? <p className="agent-model-empty" role="status">此模型配置已从目录删除，当前 Agent 仍可使用。可前往模型配置页恢复。</p> : null}
      {revised ? <div className="agent-model-empty" role="status">此模型有新修订，当前 Agent 仍使用原配置。<button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(revised.reference)}>使用最新配置</button></div> : null}
      <div className="ag-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setAdding(!adding)}
        >
          添加模型
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void refresh()}
        >
          刷新模型
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          高级：模型引用
        </button>
      </div>
      {!value && catalog && !catalog.defaultModel ? (
        <p className="agent-model-empty" role="status">
          尚未选择模型。可以先保存草稿，添加模型后再试跑。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="agent-field-error">
          {error}
        </p>
      ) : null}
      {advanced ? (
        <div className="field">
          <label htmlFor="agent-model-reference">模型引用</label>
          <input
            id="agent-model-reference"
            className="input"
            maxLength={160}
            value={value}
            placeholder="例如：anthropic/claude-sonnet-4-5"
            onChange={(e) => onChange(e.target.value)}
          />
          <p className="draft-sub">
            用于已有部署别名或供应商模型；凭据使用服务端配置。
          </p>
        </div>
      ) : null}
      {adding ? (
        <ModelConnectionDialog
          onSaved={saved}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </section>
  );
}
