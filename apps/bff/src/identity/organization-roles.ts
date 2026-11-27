/** Orbit 业务角色；必须由 IdP 按组织成员关系签发，不能使用 realm 全局角色替代。 */
export const ORGANIZATION_ROLES = ["viewer", "editor", "publisher", "operator", "approver", "admin"] as const;
export type OrganizationRole = typeof ORGANIZATION_ROLES[number];

/** 校验自定义 ID Token 声明 orbit_org_roles；缺省仅表示没有业务角色。 */
export function organizationRolesFromClaim(raw: unknown, memberIds: ReadonlySet<string>): ReadonlyMap<string, readonly OrganizationRole[]> {
  const result = new Map<string, readonly OrganizationRole[]>();
  if (raw === undefined) return result;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length > 100) {
    throw new Error("OIDC organization roles mapping is invalid");
  }
  for (const [tenantId, values] of Object.entries(raw)) {
    if (!memberIds.has(tenantId) || !Array.isArray(values) || values.length > ORGANIZATION_ROLES.length) {
      throw new Error("OIDC organization roles mapping is invalid");
    }
    const roles: OrganizationRole[] = [];
    for (const value of values) {
      const role = ORGANIZATION_ROLES.find((candidate) => candidate === value);
      if (!role || roles.includes(role)) throw new Error("OIDC organization role is invalid");
      roles.push(role);
    }
    result.set(tenantId, Object.freeze(roles));
  }
  return result;
}
