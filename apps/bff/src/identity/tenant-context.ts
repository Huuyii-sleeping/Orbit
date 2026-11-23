import { AsyncLocalStorage } from "node:async_hooks";

/** 已通过 OIDC 认证并通过成员资格校验的请求身份；禁止由请求参数直接创建。 */
export interface TenantContext {
  readonly issuer: string;
  readonly tenantId: string;
  readonly subject: string;
}

const context = new AsyncLocalStorage<Readonly<TenantContext>>();

/** 在独立异步请求链上运行；快照避免租户选择影响仍在执行的旧请求。 */
export function runWithTenant<T>(identity: TenantContext, operation: () => T): T {
  return context.run(Object.freeze({ ...identity }), operation);
}

/** SaaS 存储必须显式要求上下文，缺失时禁止读取本地全局数据。 */
export function requireTenantContext(): Readonly<TenantContext> {
  const current = context.getStore();
  if (!current) throw new Error("Trusted tenant context is required");
  return current;
}
