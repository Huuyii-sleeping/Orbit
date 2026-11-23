import type { ModelConnectionLifecycleInput, ModelConnectionCatalog, ModelConnectionInput, ModelConnectionUpdate, ModelConnectionSummary } from "@orbit/runtime-contracts";
import { jsonRequest, requestJson } from "./client";

export type { ModelConnectionCatalog, ModelConnectionInput, ModelConnectionUpdate, ModelConnectionSummary };

/** 读取无凭据的模型目录，供设置和 Agent 选择器共用。 */
export function fetchModelConnections() {
  return requestJson<ModelConnectionCatalog>("/api/model-connections");
}

/** 密钥仅在提交时传给本机服务端，返回摘要不含密钥。 */
export async function createModelConnection(input: ModelConnectionInput) {
  const result = await requestJson<{ connection: ModelConnectionSummary }>("/api/model-connections", jsonRequest("POST", input));
  return result.connection;
}

/** 保存模型修订；旧引用继续服务已发布版本。 */
export async function updateModelConnection(id: string, input: ModelConnectionUpdate) {
  const result = await requestJson<{ connection: ModelConnectionSummary }>(`/api/model-connections/${encodeURIComponent(id)}`, jsonRequest("PATCH", input));
  return result.connection;
}

/** 删除只隐藏可选配置，保留已有绑定。 */
export async function deleteModelConnection(id: string, input: ModelConnectionLifecycleInput) {
  await requestJson(`/api/model-connections/${encodeURIComponent(id)}`, jsonRequest("DELETE", input));
}

/** 恢复已删除配置的可选状态。 */
export async function restoreModelConnection(id: string, input: ModelConnectionLifecycleInput) {
  await requestJson(`/api/model-connections/${encodeURIComponent(id)}/restore`, jsonRequest("POST", input));
}
