import { createAppError } from "../lib/errors/error-factory";
import {
  isTerminalWorkflowRunStatus,
  isWorkflowDraft,
  normalizeWorkflowDraft,
  type WorkflowDraft,
  type WorkflowRunSnapshot,
  type WorkflowRuntimeEvent,
  type WorkflowVersion,
} from "@orbit/workflow-core";
import {
  type SopVersionSummary,
  type SopImportPreview,
  type StartWorkflowRunInput,
  type WorkflowRunEventStream,
} from "./types";
import {
  type EventSourceConstructor,
  asObject,
  asString,
  requestJson,
  jsonRequest,
  parseEventData,
} from "./client";

function workflowDraft(value: unknown): WorkflowDraft {
  if (!isWorkflowDraft(value))
    throw createAppError(value, { code: "INVALID_RESPONSE" });
  return normalizeWorkflowDraft(value);
}

/** 读取服务端权威 SOP 草稿列表。 */
export async function fetchSopDrafts(): Promise<WorkflowDraft[]> {
  const response = await requestJson<{ data?: unknown }>("/api/sops");
  return Array.isArray(response.data) ? response.data.map(workflowDraft) : [];
}

/** 读取一份服务端 SOP 草稿。 */
export async function fetchSopDraft(id: string): Promise<WorkflowDraft> {
  const response = await requestJson<{ data?: unknown }>(
    `/api/sops/${encodeURIComponent(id)}`,
  );
  return workflowDraft(response.data);
}

/** 在服务端创建 SOP 草稿。 */
export async function createSopDraftRemote(
  draft: WorkflowDraft,
): Promise<WorkflowDraft> {
  const response = await requestJson<{ data?: unknown }>(
    "/api/sops",
    jsonRequest("POST", { draft }),
  );
  return workflowDraft(response.data);
}

/** 使用 expectedRevision 显式保存 SOP 草稿。 */
export async function saveSopDraftRemote(
  id: string,
  expectedRevision: number,
  draft: WorkflowDraft,
): Promise<WorkflowDraft> {
  const response = await requestJson<{ data?: unknown }>(
    `/api/sops/${encodeURIComponent(id)}`,
    jsonRequest("PUT", { expectedRevision, draft }),
  );
  return workflowDraft(response.data);
}

/** 使用 expectedRevision 自动保存 SOP 草稿。 */
export async function autoSaveSopDraft(
  id: string,
  expectedRevision: number,
  draft: WorkflowDraft,
): Promise<WorkflowDraft> {
  const response = await requestJson<{ data?: unknown }>(
    `/api/sops/${encodeURIComponent(id)}/autosave`,
    jsonRequest("POST", { expectedRevision, draft }),
  );
  return workflowDraft(response.data);
}

/** 删除指定 revision 的服务端 SOP 草稿。 */
export async function deleteSopDraftRemote(
  id: string,
  revision: number,
): Promise<void> {
  await requestJson(
    `/api/sops/${encodeURIComponent(id)}?revision=${revision}`,
    { method: "DELETE" },
  );
}

/** 发布当前 revision 为不可变版本。 */
export async function publishSopDraft(
  id: string,
  expectedRevision: number,
  releaseNotes = "",
): Promise<WorkflowVersion> {
  const response = await requestJson<{ data: WorkflowVersion }>(
    `/api/sops/${encodeURIComponent(id)}/publish`,
    jsonRequest("POST", { expectedRevision, releaseNotes }),
  );
  return response.data;
}

/** 读取 SOP 不可变版本摘要。 */
export async function fetchSopVersions(
  id: string,
): Promise<SopVersionSummary[]> {
  const response = await requestJson<{ data?: SopVersionSummary[] }>(
    `/api/sops/${encodeURIComponent(id)}/versions`,
  );
  return Array.isArray(response.data) ? response.data : [];
}

/** 从历史版本创建一份独立草稿。 */
export async function createDraftFromSopVersion(
  id: string,
  versionId: string,
): Promise<WorkflowDraft> {
  const response = await requestJson<{ data?: unknown }>(
    `/api/sops/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/drafts`,
    { method: "POST" },
  );
  return workflowDraft(response.data);
}

/** 预检 workflow v2 或旧 v1 导入数据。 */
export async function previewSopImport(
  draft: unknown,
): Promise<SopImportPreview> {
  const response = await requestJson<{ data: SopImportPreview }>(
    "/api/sops/import/preview",
    jsonRequest("POST", { draft }),
  );
  return { ...response.data, draft: workflowDraft(response.data.draft) };
}

/** 将 workflow v2 或旧 v1 数据导入服务端。 */
export async function importSopDraft(draft: unknown): Promise<WorkflowDraft> {
  const response = await requestJson<{ data?: unknown }>(
    "/api/sops/import",
    jsonRequest("POST", { draft }),
  );
  return workflowDraft(response.data);
}

/** 从服务端权威数据源导出 workflow v2 草稿。 */
export async function exportSopDraft(id: string): Promise<WorkflowDraft> {
  const response = await requestJson<{ data?: unknown }>(
    `/api/sops/${encodeURIComponent(id)}/export`,
  );
  return workflowDraft(response.data);
}

function workflowRun(value: unknown): WorkflowRunSnapshot {
  const run = asObject(value);
  if (
    !asString(run.id) ||
    !asString(run.workflowId) ||
    !asString(run.mode) ||
    !asString(run.status)
  ) {
    throw createAppError(value, { code: "INVALID_RESPONSE" });
  }
  return run as WorkflowRunSnapshot;
}

/** 启动单节点、草稿或发布版本运行。 */
export async function startWorkflowRun(
  input: StartWorkflowRunInput,
): Promise<WorkflowRunSnapshot> {
  const response = await requestJson<{ data?: unknown }>(
    "/api/workflow-runs",
    jsonRequest("POST", input),
  );
  return workflowRun(response.data);
}

/** 查询运行最新快照。 */
export async function fetchWorkflowRun(
  runId: string,
): Promise<WorkflowRunSnapshot> {
  const response = await requestJson<{ data?: unknown }>(
    `/api/workflow-runs/${encodeURIComponent(runId)}`,
  );
  return workflowRun(response.data);
}

/** 取消运行并返回 Agent 当前快照。 */
export async function cancelWorkflowRun(
  runId: string,
): Promise<WorkflowRunSnapshot> {
  const response = await requestJson<{ data?: unknown }>(
    `/api/workflow-runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" },
  );
  return workflowRun(response.data);
}

/** 向具体 Workflow run 提交当前 waiting interrupt 的决定。 */
export async function resumeWorkflowRun(
  runId: string,
  input: {
    interruptId: string;
    action: "approve" | "reject";
    data: Record<string, unknown>;
    idempotencyKey: string;
  },
): Promise<WorkflowRunSnapshot> {
  const response = await requestJson<{ data?: unknown }>(
    `/api/workflow-runs/${encodeURIComponent(runId)}/resume`,
    jsonRequest("POST", input),
  );
  return workflowRun(response.data);
}

const workflowEventTypes = [
  "run.status",
  "node.status",
  "node.log",
  "node.output",
  "run.output",
  "run.waiting",
];

/** 建立可自动重连的 EventSource，并在客户端按 event id 去重。 */
export function createWorkflowRunEventStream(input: {
  runId: string;
  sinceId?: number;
  onEvent: (event: WorkflowRuntimeEvent) => void;
  onError?: () => void;
  onTerminal?: (
    event: Extract<WorkflowRuntimeEvent, { type: "run.status" }>,
  ) => void;
  eventSourceCtor?: EventSourceConstructor;
}): WorkflowRunEventStream {
  const EventSourceImpl = input.eventSourceCtor ?? globalThis.EventSource;
  if (!EventSourceImpl) throw createAppError("EventSource unavailable", { code: "BROWSER_UNSUPPORTED" });
  const delivered = new Set<number>();
  const source = new EventSourceImpl(
    `/api/workflow-runs/${encodeURIComponent(input.runId)}/events?since_id=${input.sinceId ?? 0}`,
  );
  source.onerror = () => input.onError?.();
  for (const type of workflowEventTypes) {
    source.addEventListener(type, (rawEvent) => {
      const message = rawEvent as MessageEvent<string>;
      const event = parseEventData(message.data) as WorkflowRuntimeEvent;
      if (!event || typeof event.id !== "number" || delivered.has(event.id))
        return;
      delivered.add(event.id);
      input.onEvent(event);
      if (
        event.type === "run.status" &&
        isTerminalWorkflowRunStatus(event.status)
      ) {
        source.close();
        input.onTerminal?.(event);
      }
    });
  }
  return { close: () => source.close() };
}
