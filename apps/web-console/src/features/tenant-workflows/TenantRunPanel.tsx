import { useEffect, useRef, useState } from "react";
import type { BrowserIdentitySession, BrowserWorkflowRun } from "@orbit/runtime-contracts";
import { isTerminalWorkflowRunStatus } from "@orbit/workflow-core";
import { cancelWorkflowRun, createWorkflowRunEventStream, resumeWorkflowRun } from "../../api/workflows";
import { fetchOrganizationRun } from "./tenant-workflow-api";
import { SopRunInterruptCard, type SopRunInterruptDecision } from "../sop/runs/components/SopRunInterruptCard";
import { ApiRequestError } from "../../api/client";
import { getErrorMessage } from "../../lib/errors/error-factory";

const labels = { queued: "排队中", running: "运行中", waiting: "等待审批", succeeded: "已完成", failed: "失败", cancelled: "已取消" };

/** 一次只订阅当前运行；卸载或切换组织立即关闭 EventSource，不取消运行。 */
export function TenantRunPanel({ runId, session, onSessionInvalid }: { runId: string; session: BrowserIdentitySession; onSessionInvalid: () => void }) {
  const [run, setRun] = useState<BrowserWorkflowRun | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const live = useRef(true);
  const pending = useRef(false);
  const latestRead = useRef(0);
  const reload = async (signal?: AbortSignal) => {
    const generation = ++latestRead.current;
    try { const value = await fetchOrganizationRun(runId, session, signal); if (live.current && !signal?.aborted && generation === latestRead.current) { setRun(value); setError(""); } return value; }
    catch (error) {
      if (signal?.aborted || !live.current || generation !== latestRead.current) return;
      if (error instanceof ApiRequestError && (error.status === 401 || error.code === "ORGANIZATION_CONTEXT_CHANGED")) onSessionInvalid();
      else setError(getErrorMessage(error));
    }
  };
  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    let stream: ReturnType<typeof createWorkflowRunEventStream> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    // 回放可能一次送达大量事件，只合并刷新快照，不为每帧额外发起查询。
    const scheduleReload = () => {
      if (refreshTimer || controller.signal.aborted) return;
      refreshTimer = setTimeout(() => { refreshTimer = undefined; void reload(controller.signal); }, 50);
    };
    const open = async () => {
      const value = await reload(controller.signal);
      if (controller.signal.aborted || !value || isTerminalWorkflowRunStatus(value.status)) return;
      stream = createWorkflowRunEventStream({ runId, scope: session,
        onEvent: (event) => { if (event.type === "run.waiting" || event.type === "run.status") scheduleReload(); },
        onError: () => { stream?.close(); if (!controller.signal.aborted) { void reload(controller.signal).then(() => { if (!controller.signal.aborted) setError("实时连接已断开，请刷新运行以重新连接。"); }); } },
        onTerminal: scheduleReload,
      });
    };
    void open();
    return () => { live.current = false; controller.abort(); clearTimeout(refreshTimer); stream?.close(); };
  }, [runId, connectionAttempt]);
  const perform = async (operation: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await operation(); await reload(); }
    catch (error) {
      if (!live.current) return;
      if (error instanceof ApiRequestError && (error.status === 401 || error.code === "ORGANIZATION_CONTEXT_CHANGED")) onSessionInvalid();
      else setError(getErrorMessage(error));
    } finally { pending.current = false; if (live.current) setBusy(false); }
  };
  const canApprove = session.permissions.includes("workflow.approve") && !!run?.initiatedBy && run.initiatedBy !== session.user.subject;
  return <section className="tenant-card" aria-label="运行详情">
    <div className="tenant-actions"><h2>运行详情</h2><button disabled={busy} onClick={() => setConnectionAttempt((value) => value + 1)}>刷新运行</button></div>
    <p className="tenant-caption">运行 ID：{runId}</p>
    {error ? <p className="tenant-error" role="alert">{error}</p> : null}
    {run ? <>
      <p className="tenant-caption">工作流 ID：{run.workflowId}</p>
      <p className="tenant-status">{labels[run.status]}</p>
      {session.permissions.includes("workflow.cancel") && !isTerminalWorkflowRunStatus(run.status) ? <button disabled={busy} onClick={() => void perform(() => cancelWorkflowRun(runId, session))}>取消运行</button> : null}
      {run.status === "waiting" && !canApprove ? <p>等待另一位具备审批权限的成员处理。发起人不能审批自己的运行。</p> : null}
      {canApprove ? <SopRunInterruptCard run={run} decisionPending={busy} onResume={(decision: SopRunInterruptDecision) => void perform(() => resumeWorkflowRun(runId, decision, session))} /> : null}
      {run.error ? <p role="alert">{run.error.message}</p> : null}
      {run.output ? <pre aria-label="运行输出">{JSON.stringify(run.output, null, 2)}</pre> : null}
    </> : <p role="status">正在读取运行…</p>}
  </section>;
}
