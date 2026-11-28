import type { BrowserIdentityConfiguration, BrowserIdentitySession } from "@orbit/runtime-contracts";
import { jsonRequest, requestJson, type OrganizationRequestScope } from "../../api/client";

/** 先读取服务端公开能力，避免通过失败响应猜测部署模式。 */
export function fetchIdentityConfiguration(signal?: AbortSignal) {
  return requestJson<BrowserIdentityConfiguration>("/api/auth/config", { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), cache: "no-store" });
}

/** 读取签名 Cookie 对应的服务端权限快照。 */
export function fetchIdentitySession(signal?: AbortSignal) {
  return requestJson<BrowserIdentitySession>("/api/auth/session", { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), cache: "no-store" });
}

/** 组织选择只提交 ID，不提交角色；完成后必须重新读取会话。 */
export function selectOrganization(tenantId: string, scope: OrganizationRequestScope) {
  return requestJson("/api/auth/tenant", jsonRequest("POST", { tenantId }), scope);
}

/** 本地会话注销，服务端负责撤销旧 Cookie 及活动订阅。 */
export function logoutIdentity(scope: OrganizationRequestScope) { return requestJson("/api/auth/logout", jsonRequest("POST", {}), scope); }
