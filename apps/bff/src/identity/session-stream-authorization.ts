import type { ServerResponse } from "node:http";
import type { SqliteSessionStore } from "./sqlite-session-store.js";

/** 活动连接复查间隔；本进程会话变更另有同步通知。 */
export const SESSION_STREAM_RECHECK_MS = 1_000;

/** 绑定实际 SDK 会话；失效只关闭订阅，不取消对应 Workflow 执行。 */
export function protectSessionStream(store: SqliteSessionStore, res: ServerResponse): boolean {
  const session = store.currentRequestSession();
  if (!session || !store.isCurrent(session)) return false;
  let finished = false;
  const check = () => {
    if (finished) return;
    try { if (store.isCurrent(session)) return; }
    catch { console.error("SSE session authorization check failed; closing connection"); }
    res.destroy();
    cleanup();
  };
  const interval = setInterval(check, SESSION_STREAM_RECHECK_MS);
  const expiry = setTimeout(check, Math.max(0, session.expiresAt - Date.now()));
  interval.unref(); expiry.unref();
  const unsubscribe = store.subscribeToChanges(check);
  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearInterval(interval); clearTimeout(expiry);
    unsubscribe();
    res.off("finish", cleanup); res.off("close", cleanup);
  };
  res.once("finish", cleanup); res.once("close", cleanup);
  return true;
}
