import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillValidatorService } from "../../../src/skills/skill-validator.service.js";
import { SkillStoreService } from "../../../src/skills/skill-store.service.js";

const validator = new SkillValidatorService();

describe("技能包存储边界", () => {
  it.each(["../../escape", "..", "1/2", "1\\2", "v1", "1.0.0\u0000", "1.0.0/" ])("拒绝无效版本 %j", (version) => {
    expect(validator.validatePackage({ files: [
      { path: "SKILL.md", content: "---\nname: safe-skill\ndescription: test\n---\n" },
      { path: "skill.json", content: JSON.stringify({ id: "safe-skill", name: "safe", version }) },
    ] }).ok).toBe(false);
  });

  it("存储层独立拒绝越界 manifest，且不留下任何目录", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-skill-boundary-"));
    try {
      const store = new SkillStoreService(validator, { skillDataRoot: root });
      await expect(store.writePackage("custom", {
        manifest: { id: "safe-skill", version: "../../escape", name: "safe", description: "test", summary: "test", category: "test", provider: "test", runtime: "test", permissions: [], tags: [], updatedAt: "", maturity: "stable", entry: "SKILL.md" },
        files: [{ path: "SKILL.md", content: "test" }],
      })).rejects.toThrow();
      expect(await readdir(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
