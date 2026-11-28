import { useEffect, useRef, useState } from "react";
import type { BrowserIdentitySession } from "@orbit/runtime-contracts";
import type { WorkflowDraft } from "@orbit/workflow-core";
import { ApiRequestError } from "../api/client";
import { createSopDraftRemote, fetchSopDrafts } from "../api/workflows";
import { getErrorMessage } from "../lib/errors/error-factory";
import { createOrganizationApprovalWorkflow } from "../features/tenant-workflows/approval-workflow";
import { TenantWorkflowDetail } from "../features/tenant-workflows/TenantWorkflowDetail";

/** SaaS 最小闭环仅装配组织工作流，不读取本地工作台缓存。 */
export function TenantWorkflowPage({ session, onSessionInvalid }: { session: BrowserIdentitySession; onSessionInvalid: () => void }) {
  const [drafts, setDrafts] = useState<WorkflowDraft[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const reads = useRef(0);
  const canRead = session.permissions.includes("workflow.read");
  const failure = (reason: unknown) => {
    if (!mounted.current) return;
    if (reason instanceof ApiRequestError && (reason.status === 401 || reason.code === "ORGANIZATION_CONTEXT_CHANGED")) onSessionInvalid();
    else setError(getErrorMessage(reason));
  };
  const reload = async () => {
    const generation = ++reads.current;
    setLoading(true); setError("");
    try {
      const items = await fetchSopDrafts(session);
      if (!mounted.current || generation !== reads.current) return;
      setDrafts(items); setSelected((id) => items.some((item) => item.id === id) ? id : items[0]?.id ?? "");
    } catch (reason) { if (generation === reads.current) failure(reason); }
    finally { if (mounted.current && generation === reads.current) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true;
    if (canRead) void reload(); else setLoading(false);
    return () => { mounted.current = false; reads.current++; };
  }, [canRead]);
  const create = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    // 防止创建前已发出的旧列表覆盖刚创建的草稿。
    reads.current++;
    try {
      const saved = await createSopDraftRemote(createOrganizationApprovalWorkflow(name, text), session);
      if (!mounted.current) return;
      setDrafts((items) => [saved, ...items]); setSelected(saved.id); setName(""); setText("");
    } catch (reason) { failure(reason); }
    finally { pending.current = false; if (mounted.current) { setBusy(false); setLoading(false); } }
  };
  if (!canRead) return <main className="tenant-entry"><h1>尚无工作流访问权限</h1><p>请由组织管理员分配工作流角色。</p></main>;
  const draft = drafts.find((item) => item.id === selected);
  return <main className="tenant-layout">
    <aside aria-label="组织工作流列表">
      <h1>工作流</h1><button disabled={loading || busy} onClick={() => void reload()}>刷新列表</button>
      {loading ? <p role="status">正在读取工作流…</p> : null}
      {!loading && !drafts.length ? <p>当前组织暂无工作流。</p> : null}
      {drafts.map((item) => <button key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{item.name}</button>)}
    </aside>
    <div>
      {error ? <p className="tenant-error" role="alert">{error}</p> : null}
      {session.permissions.includes("workflow.edit") ? <section className="tenant-card">
        <h2>新建审批工作流</h2><p>准备文本 → 由组织内另一位成员审批 → 完成。发布与审批分别需要授权。</p>
        <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <label>工作流名称<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>待审批内容<textarea aria-label="待审批内容" required maxLength={20_000} rows={4} value={text} onChange={(event) => setText(event.target.value)} /></label>
          <button className="tenant-primary" disabled={busy || loading}>{busy ? "正在创建…" : "创建草稿"}</button>
        </form>
      </section> : null}
      {draft ? <TenantWorkflowDetail key={`${draft.id}:${draft.revision}`} draft={draft} session={session} onSessionInvalid={onSessionInvalid}
        onSaved={(saved) => setDrafts((items) => items.map((item) => item.id === saved.id ? saved : item))} /> : null}
    </div>
  </main>;
}
