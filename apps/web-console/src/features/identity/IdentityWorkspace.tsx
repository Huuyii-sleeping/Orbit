import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { BrowserIdentityConfiguration, BrowserIdentitySession } from "@orbit/runtime-contracts";
import { ApiRequestError } from "../../api/client";
import { getErrorMessage } from "../../lib/errors/error-factory";
import { fetchIdentityConfiguration, fetchIdentitySession, logoutIdentity, selectOrganization } from "./identity-api";
import "./identity-workspace.css";

const LocalWorkspace = lazy(() => import("../../app/App").then((module) => ({ default: module.App })));
const TenantWorkspace = lazy(() => import("../../pages/TenantWorkflowPage").then((module) => ({ default: module.TenantWorkflowPage })));
const channelName = "orbit-session-change-v1";

type IdentityState = { phase: "loading" | "error" | "anonymous" | "ready"; config?: BrowserIdentityConfiguration; session?: BrowserIdentitySession; error?: string };

/** 在业务组件装配之前认证；组织切换/失效先卸载所有组织数据与订阅。 */
export function IdentityWorkspace() {
  const [state, setState] = useState<IdentityState>({ phase: "loading" });
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const transitioning = useRef(false);
  const controller = useRef<AbortController>();
  const channel = useRef<BroadcastChannel>();
  const refresh = useCallback(async (clear = false) => {
    const current = ++generation.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    if (clear) setState({ phase: "loading" });
    try {
      const config = await fetchIdentityConfiguration(request.signal);
      const session = config.mode === "saas" ? await fetchIdentitySession(request.signal) : undefined;
      if (current === generation.current) setState({ phase: "ready", config, session });
    } catch (error) {
      if (request.signal.aborted || current !== generation.current) return;
      setState(error instanceof ApiRequestError && error.status === 401
        ? { phase: "anonymous" } : { phase: "error", error: getErrorMessage(error) });
    }
  }, []);
  useEffect(() => {
    void refresh(true);
    const update = () => { if (document.visibilityState === "visible" && !transitioning.current) void refresh(); };
    const timer = window.setInterval(update, 30_000);
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void refresh(true); };
    window.addEventListener("pageshow", restored);
    window.addEventListener("focus", update); document.addEventListener("visibilitychange", update);
    if (typeof BroadcastChannel !== "undefined") {
      const messages = new BroadcastChannel(channelName); channel.current = messages;
      messages.onmessage = (event) => {
        if (event.data === "changing") { generation.current++; controller.current?.abort(); setState({ phase: "loading" }); }
        else if (event.data === "changed") void refresh(true);
      };
    }
    return () => {
      generation.current++; controller.current?.abort(); channel.current?.close();
      clearInterval(timer); window.removeEventListener("pageshow", restored); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
  const change = async (operation: () => Promise<unknown>) => {
    if (transitioning.current) return;
    transitioning.current = true; setBusy(true);
    generation.current++; controller.current?.abort(); setState({ phase: "loading" });
    // 其他页签先清除旧视图，提交后再读取最终会话；不跨页签传播用户数据。
    channel.current?.postMessage("changing");
    try { await operation(); await refresh(true); }
    catch (error) { setState({ phase: "error", error: getErrorMessage(error) }); }
    finally { transitioning.current = false; setBusy(false); channel.current?.postMessage("changed"); }
  };
  if (state.phase !== "ready") return <main className="tenant-entry">
    <a className="tenant-brand" href="/">Orbit</a>
    <h1>{state.phase === "anonymous" ? "登录组织工作区" : state.phase === "error" ? "无法加载工作区" : "正在确认会话…"}</h1>
    {state.phase === "anonymous" ? <><p>使用组织账户登录，访问授权的工作流。</p><a className="tenant-primary" href="/auth/login">登录</a></> : null}
    {state.error ? <><p role="alert">{state.error}</p><button onClick={() => void refresh(true)}>重试</button></> : null}
  </main>;
  if (state.config?.mode === "local") return <Suspense fallback={<p role="status">正在加载工作台…</p>}><LocalWorkspace /></Suspense>;
  const session = state.session!;
  const scope = JSON.stringify([session.issuer, session.user.subject, session.tenantId, session.permissions]);
  return <div className="tenant-studio">
    <header className="tenant-topbar">
      <a className="tenant-brand" href="/">Orbit</a><span>组织工作流</span>
      <label>当前组织<select aria-label="当前组织" disabled={busy} value={session.tenantId} onChange={(event) => void change(() => selectOrganization(event.target.value, session))}>
        {session.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.alias}</option>)}
      </select></label>
      <span className="tenant-user">{session.user.subject}</span><button disabled={busy} onClick={() => void change(() => logoutIdentity(session))}>退出登录</button>
    </header>
    <Suspense fallback={<p role="status">正在加载工作流…</p>}>
      {state.config?.workflowAccess === "restricted" ? <TenantWorkspace key={scope} session={session} onSessionInvalid={() => void refresh(true)} />
        : <main className="tenant-entry"><h1>工作流尚未开放</h1><p>当前可登录并选择组织，工作流服务等待部署验收。</p></main>}
    </Suspense>
  </div>;
}
