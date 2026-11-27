import { describe, expect, it } from "vitest";
import { currentServiceTenant, decodeServiceTenant, encodeServiceTenant, matchesServiceTenant,
  runWithServiceTenant, serviceTenantOwner } from "../../src/tenant-context.js";

const identity = { issuer: "https://id.example", tenantId: "org-a", subject: "user-a" };

describe("受信服务租户上下文", () => {
  it("严格校验身份字段与编码，不允许缺失字段、控制字符或额外键", () => {
    expect(decodeServiceTenant(encodeServiceTenant(identity))).toEqual(identity);
    for (const value of [{ ...identity, subject: "" }, { ...identity, tenantId: "a\n" }, {}, { ...identity, admin: true }]) {
      expect(() => decodeServiceTenant(Buffer.from(JSON.stringify(value)).toString("base64url"))).toThrow();
    }
    for (const raw of ["e30=", "[object Object]", "a".repeat(12_001)]) expect(() => decodeServiceTenant(raw)).toThrow();
    const unicodeIdentity = { issuer: "组".repeat(2048), tenantId: "织".repeat(2048), subject: "员".repeat(2048) };
    expect(() => encodeServiceTenant(unicodeIdentity)).toThrow(/Invalid service tenant identity/);
  });

  it("并发异步链身份独立，同组织共享 owner 且 issuer 参与归属", async () => {
    const other = { ...identity, tenantId: "org-b" };
    await Promise.all([identity, other].map((value) => runWithServiceTenant(value, async () => {
      await Promise.resolve();
      expect(currentServiceTenant()).toEqual(value);
      expect(matchesServiceTenant({ ...value, subject: "colleague" })).toBe(true);
      expect(matchesServiceTenant({ ...value, issuer: "https://other.example" })).toBe(false);
      expect(matchesServiceTenant(undefined)).toBe(false);
    })));
    expect(currentServiceTenant()).toBeUndefined();
    expect(matchesServiceTenant(identity)).toBe(false);
    expect(serviceTenantOwner(identity)).toBe(serviceTenantOwner({ ...identity, subject: "colleague" }));
    expect(serviceTenantOwner(identity)).not.toBe(serviceTenantOwner({ ...identity, issuer: "https://other.example" }));
  });
});
