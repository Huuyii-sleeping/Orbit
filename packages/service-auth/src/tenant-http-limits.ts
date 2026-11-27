import { rateLimit, MemoryStore } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { currentServiceTenant, serviceTenantOwner } from "./tenant-context.js";

/** 单个 HTTP 进程的固定窗口与 SSE 上限；BFF 和 Agent 各自执行。 */
export const TENANT_HTTP_LIMITS = Object.freeze({
  windowMs: 60_000,
  globalRequests: 2_000,
  readRequests: 300,
  writeRequests: 60,
  executionRequests: 20,
  controlRequests: 60,
  tenantStreams: 8,
  globalStreams: 128,
});

function requestGroup(req: Request) {
  const path = new URL(req.originalUrl ?? req.url, "http://localhost").pathname.toLowerCase().replace(/\/+$/, "");
  if (req.method === "POST" && /\/workflow-runs\/[^/]+\/(?:cancel|resume)$/.test(path)) return "control";
  if (req.method === "POST" && /\/workflow-runs\/?$/.test(path)) return "execution";
  return req.method === "GET" || req.method === "HEAD" ? "read" : "write";
}

/** 必须安装在可信租户边界之后、JSON 解析器之前；本地无身份调用保持原行为。 */
export function createTenantHttpLimits(): { middleware: RequestHandler; close(): void } {
  const stores: MemoryStore[] = [];
  const tenantStreams = new Map<string, number>();
  let streams = 0;
  const limiter = (limit: number, global = false) => {
    const store = new MemoryStore(); stores.push(store);
    return rateLimit({
      windowMs: TENANT_HTTP_LIMITS.windowMs, limit, store,
      keyGenerator: () => global ? "process" : serviceTenantOwner(currentServiceTenant()!),
      standardHeaders: "draft-7", legacyHeaders: false, passOnStoreError: false,
      handler: (_req, res) => res.status(429).json({ ok: false, error: {
        code: "TENANT_REQUEST_RATE_LIMIT", message: "Request rate limit exceeded; retry after the indicated delay.",
      } }),
    });
  };
  const global = limiter(TENANT_HTTP_LIMITS.globalRequests, true);
  const groups = {
    read: limiter(TENANT_HTTP_LIMITS.readRequests), write: limiter(TENANT_HTTP_LIMITS.writeRequests),
    execution: limiter(TENANT_HTTP_LIMITS.executionRequests), control: limiter(TENANT_HTTP_LIMITS.controlRequests),
  };
  const middleware: RequestHandler = (req, res, next) => {
    const tenant = currentServiceTenant();
    if (!tenant) { next(); return; }
    const key = serviceTenantOwner(tenant);
    // 组织超额请求先拒绝，不再消耗全局额度，以免一个组织耗尽其他组织的保护容量。
    void groups[requestGroup(req)](req, res, (error?: unknown) => {
      if (error) { next(error); return; }
      void global(req, res, (groupError?: unknown) => {
        if (groupError) { next(groupError); return; }
        if (res.destroyed || res.writableEnded) return;
        const path = new URL(req.originalUrl ?? req.url, "http://localhost").pathname.toLowerCase().replace(/\/+$/, "");
        if (req.method !== "GET" || !/\/workflow-runs\/[^/]+\/events$/.test(path)) { next(); return; }
        const count = tenantStreams.get(key) ?? 0;
        if (count >= TENANT_HTTP_LIMITS.tenantStreams || streams >= TENANT_HTTP_LIMITS.globalStreams) {
          res.setHeader("Retry-After", "5");
          res.status(429).json({ ok: false, error: { code: "TENANT_STREAM_LIMIT", message: "Too many active event streams." } });
          return;
        }
        tenantStreams.set(key, count + 1); streams++;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          const remaining = (tenantStreams.get(key) ?? 1) - 1;
          if (remaining) tenantStreams.set(key, remaining); else tenantStreams.delete(key);
          streams--;
          res.off("finish", release); res.off("close", release);
        };
        res.once("finish", release); res.once("close", release);
        next();
      });
    });
  };
  return { middleware, close: () => stores.forEach((store) => store.shutdown()) };
}
