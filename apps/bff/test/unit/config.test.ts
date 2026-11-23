import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSkillHubDataRoot, resolveSkillRegistryAdminToken } from "../../src/config.js";

describe("bff config", () => {
  it("生产环境拒绝缺失或默认的 Registry 管理凭据", () => {
    expect(() => resolveSkillRegistryAdminToken({ NODE_ENV: "production" })).toThrow(/SKILL_REGISTRY_ADMIN_TOKEN/);
    expect(() => resolveSkillRegistryAdminToken({ NODE_ENV: "production", SKILL_REGISTRY_ADMIN_TOKEN: "local-dev-skill-registry-admin-token" })).toThrow();
    expect(resolveSkillRegistryAdminToken({ NODE_ENV: "production", SKILL_REGISTRY_ADMIN_TOKEN: "deployment-secret" })).toBe("deployment-secret");
  });

  it("resolves the shared SkillHub data root from environment", () => {
    expect(resolveSkillHubDataRoot({ SKILLHUB_DATA_ROOT: " /var/lib/skillhub " }, "/repo/apps/bff")).toBe(
      "/var/lib/skillhub",
    );
  });

  it("uses a deterministic local SkillHub data root by default", () => {
    expect(resolveSkillHubDataRoot({}, "/repo/apps/bff")).toBe(join("/repo/apps/bff", ".data", "skills"));
  });
});
