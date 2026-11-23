import { describe, expect, it } from "vitest";
import { resolveSkillRegistryConfig } from "../../src/config.js";

describe("Registry production config", () => {
  it("生产环境不能使用公开的开发管理 token", () => {
    expect(() => resolveSkillRegistryConfig({ NODE_ENV: "production" })).toThrow(/SKILL_REGISTRY_ADMIN_TOKEN/);
    expect(() => resolveSkillRegistryConfig({ NODE_ENV: "production", SKILL_REGISTRY_ADMIN_TOKEN: "local-dev-skill-registry-admin-token" })).toThrow();
    expect(resolveSkillRegistryConfig({ NODE_ENV: "production", SKILL_REGISTRY_ADMIN_TOKEN: "deployment-secret" }).adminToken).toBe("deployment-secret");
  });
});
