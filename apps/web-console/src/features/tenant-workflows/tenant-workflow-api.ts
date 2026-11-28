import type { BrowserWorkflowRun, BrowserWorkflowRunSummary } from "@orbit/runtime-contracts";
import { requestJson, type OrganizationRequestScope } from "../../api/client";

/** 只读取服务端当前组织下的近期索引，不把运行或草稿写入浏览器持久化。 */
export async function fetchOrganizationRuns(workflowId: string, scope: OrganizationRequestScope, signal?: AbortSignal) {
  const response = await requestJson<{ data: BrowserWorkflowRunSummary[] }>(`/api/workflow-runs?workflowId=${encodeURIComponent(workflowId)}`, { signal }, scope);
  return response.data;
}

/** 读取真实状态及可信发起人，用于展示自审批限制。 */
export async function fetchOrganizationRun(runId: string, scope: OrganizationRequestScope, signal?: AbortSignal) {
  const response = await requestJson<{ data: BrowserWorkflowRun }>(`/api/workflow-runs/${encodeURIComponent(runId)}`, { signal }, scope);
  return response.data;
}
