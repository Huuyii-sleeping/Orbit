import { useEffect, useRef, useState } from "react";
import type { BrowserIdentitySession, BrowserWorkflowRunSummary } from "@orbit/runtime-contracts";
import type { WorkflowDraft } from "@orbit/workflow-core";
import type { SopVersionSummary } from "../../api/types";
import { ApiRequestError } from "../../api/client";
import { fetchSopVersions, publishSopDraft, saveSopDraftRemote, startWorkflowRun } from "../../api/workflows";
import { getErrorMessage } from "../../lib/errors/error-factory";
import { fetchOrganizationRuns } from "./tenant-workflow-api";
import { createOrganizationApprovalWorkflow, organizationApprovalText } from "./approval-workflow";
import { TenantRunPanel } from "./TenantRunPanel";


/** 服务端 revision 是编辑依据；已发布版本独立选择，保存草稿不会修改正在运行的版本。 */
export function TenantWorkflowDetail({ draft, session, onSaved, onSessionInvalid }: {
  draft: WorkflowDraft; session: BrowserIdentitySession; onSaved: (draft: WorkflowDraft) => void; onSessionInvalid: () => void;
}) {
  const [versions, setVersions] = useState<SopVersionSummary[]>([]);
  const [versionId, setVersionId] = useState("");
  const [runs, setRuns] = useState<BrowserWorkflowRunSummary[]>([]);
  const [runId, setRunId] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [name, setName] = useState(draft.name);
  const initialText = organizationApprovalText(draft);
  const [text, setText] = useState(initialText ?? "");
  const [inputs, setInputs] = useState("{}");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const live = useRef(false);
  const pending = useRef(false);
  const reads = useRef(0);
  const failure = (reason: unknown) => {
    if (!live.current) return;
    if (reason instanceof ApiRequestError && (reason.status === 401 || reason.code === "ORGANIZATION_CONTEXT_CHANGED")) onSessionInvalid();
    else setError(getErrorMessage(reason));
  };
  const reload = async () => {
    const generation = ++reads.current;
    setLoading(true); setError("");
    try {
      const [published, recent] = await Promise.all([fetchSopVersions(draft.id, session), fetchOrganizationRuns(draft.id, session)]);
      if (!live.current || generation !== reads.current) return;
      setVersions(published); setRuns(recent);
      setVersionId((id) => published.some((item) => item.id === id) ? id : published[0]?.id ?? "");
    } catch (reason) { if (generation === reads.current) failure(reason); }
    finally { if (live.current && generation === reads.current) setLoading(false); }
  };
  useEffect(() => {
    live.current = true; void reload();
    return () => { live.current = false; reads.current++; };
  }, [draft.id]);
  const perform = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await operation(); }
    catch (reason) { failure(reason); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };
  const save = async () => {
    const changed = createOrganizationApprovalWorkflow(name, text);
    const saved = await saveSopDraftRemote(draft.id, draft.revision, { ...draft, name: changed.name, nodes: changed.nodes, edges: changed.edges }, session);
    if (live.current) onSaved(saved);
  };
  const publish = async () => {
    const version = await publishSopDraft(draft.id, draft.revision, "", session);
    if (!live.current) return;
    await reload(); if (live.current) setVersionId(version.id);
  };
  const start = async () => {
    const value: unknown = JSON.parse(inputs);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("运行输入必须为 JSON 对象。");
    const run = await startWorkflowRun({ workflowId: draft.id, versionId, mode: "production", inputs: value as Record<string, unknown> }, session);
    if (!live.current) return;
    setRunId(run.id); await reload();
  };
  const dirty = initialText !== undefined && (name !== draft.name || text !== initialText);
  return <>
    <section className="tenant-card" aria-label="工作流详情">
      <h2>{draft.name}</h2><p className="tenant-caption">草稿修订 {draft.revision} · {draft.nodes.length} 个节点</p>
      {error ? <p className="tenant-error" role="alert">{error}</p> : null}
      {initialText !== undefined ? <form onSubmit={(event) => { event.preventDefault(); void perform(save); }}>
        <label>草稿名称<input required maxLength={120} disabled={!session.permissions.includes("workflow.edit") || busy} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>审批正文<textarea aria-label="审批正文" required maxLength={20_000} rows={4} disabled={!session.permissions.includes("workflow.edit") || busy} value={text} onChange={(event) => setText(event.target.value)} /></label>
        {session.permissions.includes("workflow.edit") ? <button disabled={busy || !dirty}>保存草稿</button> : null}
      </form> : <p>此流程由其他编辑器创建，本页可查看、发布和运行。</p>}
      <div className="tenant-actions">
        {session.permissions.includes("workflow.publish") ? <button disabled={busy || dirty} onClick={() => void perform(publish)}>发布当前草稿</button> : null}
        <button disabled={busy || loading} onClick={() => void reload()}>刷新版本与运行</button>
      </div>
      {dirty ? <p>草稿尚未保存。刷新列表会重新读取草稿并丢弃未保存修改。修订冲突时请先核对。</p> : null}
      <label>发布版本<select aria-label="发布版本" value={versionId} disabled={busy || loading} onChange={(event) => setVersionId(event.target.value)}>
        {!versions.length ? <option value="">尚未发布</option> : null}
        {versions.map((version) => <option key={version.id} value={version.id}>{version.id}</option>)}
      </select></label>
      {session.permissions.includes("workflow.run") ? <>
        <label>运行输入 JSON<textarea aria-label="运行输入 JSON" rows={2} maxLength={20_000} value={inputs} onChange={(event) => setInputs(event.target.value)} /></label>
        <button className="tenant-primary" disabled={busy || loading || !versionId} onClick={() => void perform(start)}>运行所选版本</button>
      </> : null}
      <h3>运行记录</h3><p className="tenant-caption">未完成运行优先，最多 10 条。选中后读取 Runtime 的最新状态。</p>
      <div className="tenant-run-list">{runs.map((run) => <button key={run.id} aria-pressed={run.id === runId} onClick={() => setRunId(run.id)}>{run.id} · {run.status}</button>)}</div>
      {!loading && !runs.length ? <p>暂无运行。</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); setRunId(lookupId.trim()); }}>
        <label>打开运行 ID<input required maxLength={200} value={lookupId} onChange={(event) => setLookupId(event.target.value)} /></label>
        <button disabled={!lookupId.trim()}>打开运行</button>
      </form>
    </section>
    {runId ? <TenantRunPanel key={runId} runId={runId} session={session} onSessionInvalid={onSessionInvalid} /> : null}
  </>;
}
