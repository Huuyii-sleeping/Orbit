import { useEffect, useState } from "react";
import {
  fetchModelConnections,
  deleteModelConnection,
  restoreModelConnection,
  type ModelConnectionCatalog,
  type ModelConnectionSummary,
} from "../../../api/model-connections";
import { ModelConnectionDialog } from "./ModelConnectionDialog";
import { modelFormatLabel } from "../lib/model-formats";

/** 管理可复用模型配置，删除隐藏目录项并允许恢复。 */
export function ModelConnectionsPanel() {
  const [catalog, setCatalog] = useState<ModelConnectionCatalog | null>(null);
  const [editing, setEditing] = useState<ModelConnectionSummary | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      setCatalog(await fetchModelConnections());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型目录加载失败。");
    }
  }
  async function changeAvailability(connection: ModelConnectionSummary, restore = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const action = restore ? restoreModelConnection : deleteModelConnection;
      await action(connection.id, { reference: connection.reference });
      setDeleting(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型配置操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <div className="set-card model-connections-panel">
      <div className="ag-actions">
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={busy}
          onClick={() => setAdding(true)}
        >
          添加模型
        </button>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          刷新模型
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {adding || editing ? (
        <ModelConnectionDialog
          connection={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}
      {catalog ? (
        <>
          <p className="draft-sub">
            系统默认模型：
            {catalog.defaultModel || "未配置，请在 Agent 中选择连接"}
          </p>
          {catalog.connections.map((connection) => (
            <article className="model-connection-item" key={connection.id}>
              <div className="model-connection-heading">
                <strong>{connection.name}</strong>
                <div className="model-connection-actions">
                  <button type="button" disabled={busy} className="btn btn-ghost btn-sm" aria-label={`编辑模型 ${connection.name}`} onClick={() => setEditing(connection)}>编辑</button>
                  <button type="button" disabled={busy} className="btn btn-ghost btn-sm model-delete-button" aria-label={`删除模型 ${connection.name}`} onClick={() => setDeleting(connection.id)}>删除</button>
                </div>
              </div>
              <span>
                {modelFormatLabel(connection.provider)} · {connection.modelId}
              </span>
              <small>
                {connection.baseUrl || "供应商默认地址"} ·{" "}
                {connection.hasApiKey ? "API Key 已配置" : "未保存 API Key"}
              </small>
              {deleting === connection.id ? (
                <div className="model-delete-confirm" role="group" aria-label={`确认删除 ${connection.name}`}>
                  <p>删除「{connection.name}」后，它将从可选模型中移除。已绑定的 Agent 和发布版本仍可使用，凭据保留，可在下方恢复。</p>
                  <div className="model-connection-actions">
                    <button type="button" disabled={busy} className="btn btn-ghost btn-sm" onClick={() => setDeleting(null)}>取消</button>
                    <button type="button" disabled={busy} className="btn btn-ghost btn-sm model-delete-button" onClick={() => changeAvailability(connection)}>{busy ? "处理中…" : "确认删除"}</button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
          {!catalog.connections.length ? (
            <p className="draft-sub">
              还没有模型配置。添加后可在多个 Agent 中复用。
            </p>
          ) : (
            <p className="draft-sub">
              点击「编辑」可修改接口格式、模型、API 地址与密钥。修改后在 Agent 中选择新修订；已发布版本继续使用原配置。
            </p>
          )}
          {catalog.deletedConnections?.length ? (
            <details className="model-deleted-list">
              <summary>已删除配置（{catalog.deletedConnections.length}）</summary>
              <p className="draft-sub">保留已有 Agent 的绑定与凭据，恢复后可重新选择。</p>
              {catalog.deletedConnections.map((connection) => (
                <article className="model-connection-item" key={connection.id}>
                  <div className="model-connection-heading">
                    <strong>{connection.name}</strong>
                    <button type="button" disabled={busy} className="btn btn-ghost btn-sm" aria-label={`恢复模型 ${connection.name}`} onClick={() => changeAvailability(connection, true)}>恢复</button>
                  </div>
                  <span>{modelFormatLabel(connection.provider)} · {connection.modelId}</span>
                </article>
              ))}
            </details>
          ) : null}
          {catalog.configuredModels.length ? (
            <p className="draft-sub">
              部署配置的模型：{catalog.configuredModels.join("、")}
            </p>
          ) : null}
        </>
      ) : !error ? (
        <p role="status">加载模型配置…</p>
      ) : null}
    </div>
  );
}
