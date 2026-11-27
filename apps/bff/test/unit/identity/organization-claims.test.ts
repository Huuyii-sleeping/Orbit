import { describe, expect, it } from "vitest";
import { verifiedIdentityFromClaims } from "../../../src/identity/organization-claims.js";

const claims = {
  iss: "https://id.example", sub: "alice",
  organization: { alpha: { id: "org-a" }, beta: { id: "org-b" } },
};

describe("组织身份与角色声明", () => {
  it("只从按稳定组织 ID 映射的声明读取角色，组织间不继承权限", () => {
    const identity = verifiedIdentityFromClaims({
      ...claims, orbit_org_roles: { "org-a": ["admin"], "org-b": ["viewer", "approver"] },
    });
    expect(identity.organizations).toEqual([
      { id: "org-a", alias: "alpha", roles: ["admin"] },
      { id: "org-b", alias: "beta", roles: ["viewer", "approver"] },
    ]);
    expect(Object.isFrozen(identity.organizations[0].roles)).toBe(true);
  });

  it("缺少角色时默认无业务权限，不采信全局角色或组织 alias 角色", () => {
    const identity = verifiedIdentityFromClaims({ ...claims, roles: ["admin"], realm_access: { roles: ["admin"] } });
    expect(identity.organizations.map((org) => org.roles)).toEqual([[], []]);
    expect(() => verifiedIdentityFromClaims({ ...claims, orbit_org_roles: { alpha: ["admin"] } })).toThrow();
  });

  it("拒绝畸形、未知、重复角色及非成员组织授权", () => {
    for (const roles of [null, [], "admin", { "org-a": "admin" }, { "org-a": ["superadmin"] },
      { "org-a": ["admin", "admin"] }, { "org-x": ["admin"] }, { "org-a": [null] }]) {
      expect(() => verifiedIdentityFromClaims({ ...claims, orbit_org_roles: roles }), JSON.stringify(roles)).toThrow();
    }
    expect(() => verifiedIdentityFromClaims({ ...claims, organization: { alpha: { id: "org-a" }, copy: { id: "org-a" } } })).toThrow();
  });
});
