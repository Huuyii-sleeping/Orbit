import { useState } from "react";
import { MODEL_FORMATS } from "../lib/model-formats";
import {
  createModelConnection,
  updateModelConnection,
  type ModelConnectionSummary,
} from "../../../api/model-connections";

/** 设置页和 Agent 页面复用的连接表单，成功保存后立即清除内存中的密钥输入。 */
export function ModelConnectionForm({
  onSaved,
  onCancel,
  connection,
}: {
  connection?: ModelConnectionSummary;
  onSaved: (connection: ModelConnectionSummary) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(connection?.name ?? "");
  const [provider, setProvider] = useState(connection?.provider ?? "openai-compatible");
  const [modelId, setModelId] = useState(connection?.modelId ?? "");
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (
      !modelId.trim() ||
      (provider === "openai-compatible" && !baseUrl.trim())
    ) {
      setError("请填写模型 ID；OpenAI 兼容接口还需要 API 地址。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const input = {
        name: name.trim() || modelId.trim(),
        provider,
        modelId: modelId.trim(),
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      };
      const saved = connection
        ? await updateModelConnection(connection.id, { ...input, reference: connection.reference, clearApiKey })
        : await createModelConnection(input);
      setApiKey("");
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型连接保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="model-connection-form" aria-label={connection ? "编辑模型配置" : "添加模型配置"}>
      <div className="field">
        <label htmlFor="connection-format">接口格式</label>
        <select
          id="connection-format"
          className="input"
          autoFocus
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        >
          {MODEL_FORMATS.map((format) => (
            <option key={format.value} value={format.value}>
              {format.label}
            </option>
          ))}
        </select>
        <p className="draft-sub">
          {MODEL_FORMATS.find((format) => format.value === provider)?.hint}
        </p>
      </div>
      <div className="field">
        <label htmlFor="connection-model">模型 ID</label>
        <input
          id="connection-model"
          className="input"
          value={modelId}
          maxLength={160}
          placeholder={
            provider === "anthropic"
              ? "例如：claude-sonnet-4-5"
              : provider === "google"
                ? "例如：gemini-2.5-flash"
                : "填写服务提供的模型 ID"
          }
          onChange={(e) => setModelId(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="connection-url">
          API 地址{provider === "openai-compatible" ? "（必填）" : "（可选）"}
        </label>
        <input
          id="connection-url"
          className="input"
          type="url"
          value={baseUrl}
          placeholder={
            provider === "anthropic"
              ? "留空使用 Anthropic 默认地址"
              : provider === "google"
                ? "留空使用 Gemini 默认地址"
                : "https://api.example.com/v1"
          }
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="connection-key">API Key</label>
        <input
          id="connection-key"
          className="input"
          type="password"
          autoComplete="new-password"
          value={apiKey}
          disabled={clearApiKey}
          placeholder={
            connection?.hasApiKey ? "已保存密钥；留空保留，填写则替换" : provider === "openai-compatible"
              ? "输入 API Key；无认证本地服务可留空"
              : "输入服务提供的 API Key"
          }
          onChange={(e) => setApiKey(e.target.value)}
        />
        {connection?.hasApiKey ? <label className="model-key-clear"><input type="checkbox" checked={clearApiKey} onChange={(event) => { setClearApiKey(event.target.checked); setApiKey(""); }} />清除已保存的 API Key</label> : null}
        <p className="draft-sub">
          密钥仅保存在本机服务端，不写入 Agent
          或发布版本。保存连接不会调用模型。
        </p>
      </div>
      <div className="field">
        <label htmlFor="connection-name">连接名称（可选）</label>
        <input
          id="connection-name"
          className="input"
          value={name}
          maxLength={80}
          placeholder="留空使用模型 ID"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="agent-field-error">
          {error}
        </p>
      ) : null}
      {connection ? <p className="draft-sub">修改会生成新修订。已有 Agent 继续使用原配置，请在 Agent 中选择新修订后保存并试跑。</p> : null}
      <div className="ag-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={saving}
          data-action="save-connection"
          onClick={save}
        >
          {saving ? "保存中…" : connection ? "保存修改" : "保存配置"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={saving}
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </section>
  );
}
