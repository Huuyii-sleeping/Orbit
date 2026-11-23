import type { TenantContext } from "./tenant-context.js";

/** 已验签身份中的组织列表和选择；仅服务端 session 可以保存该对象。 */
export interface VerifiedIdentity extends Pick<TenantContext, "issuer" | "subject"> {
  readonly organizations: ReadonlyArray<{ readonly id: string; readonly alias: string }>;
  readonly selectedTenantId: string;
  readonly selectedAt: number;
}

/** 解析 Keycloak Organizations 稳定 ID 映射；缺失或歧义立即拒绝。 */
export function verifiedIdentityFromClaims(claims: Record<string, unknown>): VerifiedIdentity {
  const organization = claims.organization;
  if (typeof claims.iss !== "string" || !claims.iss || typeof claims.sub !== "string" || !claims.sub ||
    !organization || typeof organization !== "object" || Array.isArray(organization)) {
    throw new Error("Verified OIDC identity requires organization IDs");
  }
  const organizations: Array<{ id: string; alias: string }> = [];
  const seen = new Set<string>();
  for (const [alias, value] of Object.entries(organization)) {
    if (!alias || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("OIDC organization mapping is invalid");
    const id = (value as Record<string, unknown>).id;
    if (typeof id !== "string" || !id.trim() || id.length > 200 || seen.has(id)) throw new Error("OIDC organization ID is invalid");
    organizations.push({ id, alias });
    seen.add(id);
  }
  if (organizations.length === 0) throw new Error("Verified OIDC identity requires organization IDs");
  return {
    issuer: claims.iss, subject: claims.sub,
    organizations, selectedTenantId: organizations[0].id, selectedAt: Date.now(),
  };
}
