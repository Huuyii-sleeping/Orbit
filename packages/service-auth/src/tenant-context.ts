import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

/** 已验证的组织成员身份；只可由 OIDC 边界或已鉴权的服务请求建立。 */
export interface ServiceTenantIdentity {
  readonly issuer: string;
  readonly tenantId: string;
  readonly subject: string;
}

/** 仅用于受信服务网络，不可直接转发浏览器提交的同名 header。 */
export const SERVICE_TENANT_HEADER = "x-orbit-tenant-context";
const context = new AsyncLocalStorage<Readonly<ServiceTenantIdentity>>();
const maxEncodedIdentityLength = 12_000;

/** 在独立异步链中保留不可变的身份快照。 */
export function runWithServiceTenant<T>(identity: ServiceTenantIdentity, operation: () => T): T {
  return context.run(Object.freeze({ ...identity }), operation);
}

/** 无上下文代表本地宿主调用；HTTP SaaS 模式必须在入口拒绝缺失身份。 */
export function currentServiceTenant() { return context.getStore(); }

/** SaaS 存储不可退回本地全局命名空间。 */
export function requireServiceTenant(): Readonly<ServiceTenantIdentity> {
  const identity = context.getStore();
  if (!identity) throw new Error("Trusted tenant context is required");
  return identity;
}

/** 校验并编码服务身份；调用方必须先验证服务 Bearer 凭据。 */
export function encodeServiceTenant(identity: ServiceTenantIdentity): string {
  const value = { issuer: identity.issuer, tenantId: identity.tenantId, subject: identity.subject };
  for (const field of Object.values(value)) {
    if (typeof field !== "string" || !field.trim() || field.length > 2048 || /[\u0000-\u001f\u007f]/.test(field)) {
      throw new Error("Invalid service tenant identity");
    }
  }
  const encoded = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  if (encoded.length > maxEncodedIdentityLength) throw new Error("Invalid service tenant identity");
  return encoded;
}

/** 只解码已通过服务鉴权的单一 header，拒绝歧义编码与超长输入。 */
export function decodeServiceTenant(raw: string): ServiceTenantIdentity {
  if (raw.length > maxEncodedIdentityLength || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error("Invalid service tenant identity");
  const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid service tenant identity");
  const identity = value as ServiceTenantIdentity;
  if (encodeServiceTenant(identity) !== raw) throw new Error("Invalid service tenant identity");
  return Object.freeze({ issuer: identity.issuer, tenantId: identity.tenantId, subject: identity.subject });
}

/** 组织级执行 owner；包含 issuer，避免不同 IdP 下相同组织 ID 碰撞。 */
export function serviceTenantOwner(identity: ServiceTenantIdentity): string {
  return `tenant:${createHash("sha256").update(JSON.stringify([identity.issuer, identity.tenantId])).digest("hex")}`;
}

/** 同组织成员可共享运行；本地上下文与组织上下文互不可见。 */
export function matchesServiceTenant(stored: ServiceTenantIdentity | undefined): boolean {
  const current = currentServiceTenant();
  return current ? stored?.issuer === current.issuer && stored.tenantId === current.tenantId : !stored;
}
