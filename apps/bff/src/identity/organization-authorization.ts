import { AsyncLocalStorage } from "node:async_hooks";
import { currentServiceTenant } from "@orbit/service-auth";
import { runWithTenant, type TenantContext } from "./tenant-context.js";
import type { VerifiedIdentity } from "./organization-claims.js";
import type { OrganizationRole } from "./organization-roles.js";

/** 组织内操作契约；拥有权限仍需通过资源归属、输入和执行能力检查。 */
export const ORGANIZATION_PERMISSIONS = [
  "workflow.read", "workflow.edit", "workflow.publish", "workflow.run", "workflow.cancel", "workflow.approve", "organization.members.manage",
] as const;
export type OrganizationPermission = typeof ORGANIZATION_PERMISSIONS[number];

const rolePermissions: Record<OrganizationRole, readonly OrganizationPermission[]> = {
  viewer: ["workflow.read"],
  editor: ["workflow.read", "workflow.edit", "workflow.run"],
  publisher: ["workflow.read", "workflow.publish"],
  operator: ["workflow.read", "workflow.run", "workflow.cancel"],
  approver: ["workflow.read", "workflow.approve"],
  admin: ORGANIZATION_PERMISSIONS,
};

/** 仅表示当前组织的授权快照，不是可提交到服务端的授权凭据。 */
export interface OrganizationAccess {
  readonly roles: readonly OrganizationRole[];
  readonly permissions: readonly OrganizationPermission[];
}

const context = new AsyncLocalStorage<{ readonly tenant: TenantContext; readonly access: OrganizationAccess }>();

/** 从服务端已验证身份计算当前组织权限；历史无角色会话默认无业务权限。 */
export function organizationAccess(identity: VerifiedIdentity): OrganizationAccess {
  const membership = identity.organizations.find((organization) => organization.id === identity.selectedTenantId);
  if (!membership) throw new Error("Verified organization membership is required");
  const roles = Object.freeze([...(membership.roles ?? [])]);
  const granted = new Set<OrganizationPermission>(roles.flatMap((role) => rolePermissions[role] ?? []));
  return Object.freeze({ roles, permissions: Object.freeze(ORGANIZATION_PERMISSIONS.filter((permission) => granted.has(permission))) });
}

/** 仅供 OIDC 请求边界建立授权；与租户上下文绑定，防止嵌套组织切换沿用权限。 */
export function runWithOrganizationAuthorization<T>(identity: VerifiedIdentity, operation: () => T): T {
  const tenant = Object.freeze({ issuer: identity.issuer, tenantId: identity.selectedTenantId, subject: identity.subject });
  const scope = Object.freeze({ tenant, access: organizationAccess(identity) });
  return runWithTenant(tenant, () => context.run(scope, operation));
}

/** 返回与当前用户和组织一致的授权快照；没有可信授权链时不退回默认角色。 */
export function currentOrganizationAccess(): OrganizationAccess | undefined {
  const scope = context.getStore();
  const tenant = currentServiceTenant();
  if (!scope || !tenant || scope.tenant.issuer !== tenant.issuer || scope.tenant.tenantId !== tenant.tenantId || scope.tenant.subject !== tenant.subject) return undefined;
  return scope.access;
}

/** 业务 service 可据此返回一致的拒绝结果，不暴露角色或资源信息。 */
export class OrganizationAuthorizationError extends Error {
  readonly statusCode = 403;
  readonly code = "PERMISSION_DENIED";
  constructor() { super("Organization permission is required"); }
}

/** 缺少上下文和缺少权限均拒绝；本地模式由业务装配显式决定是否调用。 */
export function requireOrganizationPermission(permission: OrganizationPermission): void {
  if (!currentOrganizationAccess()?.permissions.includes(permission)) throw new OrganizationAuthorizationError();
}
