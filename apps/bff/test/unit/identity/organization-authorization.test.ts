import { describe, expect, it } from "vitest";
import { verifiedIdentityFromClaims } from "../../../src/identity/organization-claims.js";
import { runWithTenant } from "../../../src/identity/tenant-context.js";
import { currentOrganizationAccess, organizationAccess, requireOrganizationPermission,
  runWithOrganizationAuthorization } from "../../../src/identity/organization-authorization.js";

const identity = verifiedIdentityFromClaims({
  iss: "https://id.example", sub: "alice", organization: { alpha: { id: "org-a" }, beta: { id: "org-b" } },
  orbit_org_roles: { "org-a": ["admin"], "org-b": ["viewer"] },
});

describe("组织操作权限", () => {
  it("管理员权限不会随组织切换带入另一个组织；旧会话没有角色时无业务权限", () => {
    expect(organizationAccess(identity).permissions).toContain("workflow.publish");
    expect(organizationAccess({ ...identity, selectedTenantId: "org-b" })).toEqual({ roles: ["viewer"], permissions: ["workflow.read"] });
    expect(organizationAccess({ ...identity, organizations: [{ id: "org-a", alias: "alpha" }] }).permissions).toEqual([]);
    expect(() => organizationAccess({ ...identity, selectedTenantId: "org-x" })).toThrow();
  });

  it("编辑、发布、运行控制和审批相互独立，多角色取并集", () => {
    const access = (roles: string[]) => organizationAccess(verifiedIdentityFromClaims({
      iss: identity.issuer, sub: identity.subject, organization: { alpha: { id: "org-a" } }, orbit_org_roles: { "org-a": roles },
    })).permissions;
    expect(access(["editor"])).toEqual(["workflow.read", "workflow.edit", "workflow.run"]);
    expect(access(["publisher"])).toEqual(["workflow.read", "workflow.publish"]);
    expect(access(["operator"])).toEqual(["workflow.read", "workflow.run", "workflow.cancel"]);
    expect(access(["approver"])).toEqual(["workflow.read", "workflow.approve"]);
    expect(access(["editor", "approver"])).toEqual(["workflow.read", "workflow.edit", "workflow.run", "workflow.approve"]);
  });

  it("缺少权限上下文直接拒绝，单独建立租户上下文不会获得操作授权", () => {
    expect(() => requireOrganizationPermission("workflow.read")).toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED", statusCode: 403 }));
    runWithTenant({ issuer: identity.issuer, subject: identity.subject, tenantId: "org-a" }, () => {
      expect(() => requireOrganizationPermission("workflow.read")).toThrow();
    });
  });

  it("并发异步链独立，嵌套切换组织、issuer 或用户不能沿用原授权", async () => {
    await Promise.all(["org-a", "org-b"].map((selectedTenantId) => runWithOrganizationAuthorization({ ...identity, selectedTenantId }, async () => {
      await Promise.resolve();
      expect(currentOrganizationAccess()?.roles).toEqual(selectedTenantId === "org-a" ? ["admin"] : ["viewer"]);
      requireOrganizationPermission("workflow.read");
      if (selectedTenantId === "org-b") expect(() => requireOrganizationPermission("workflow.approve")).toThrow();
    })));
    runWithOrganizationAuthorization(identity, () => {
      for (const patch of [{ tenantId: "org-b" }, { issuer: "https://other.example" }, { subject: "mallory" }]) {
        runWithTenant({ issuer: identity.issuer, tenantId: "org-a", subject: identity.subject, ...patch }, () => {
          expect(() => requireOrganizationPermission("workflow.approve")).toThrow();
        });
      }
    });
    expect(currentOrganizationAccess()).toBeUndefined();
  });
});
