import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RegistryStore } from "../../src/registry-store.js";
import { validateSkillPackage } from "../../src/package-validator.js";

const roots: string[] = [];
const stores: RegistryStore[] = [];
const base = "http://registry.test";

function pkg(version: string, content = "original") {
  return { files: [
    { path: "SKILL.md", content: `---\nname: review-skill\ndescription: test\n---\n${content}` },
    { path: "skill.json", content: JSON.stringify({ id: "review-skill", name: `Review ${version}`, version }) },
  ] };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "orbit-registry-integrity-"));
  roots.push(root);
  const store = new RegistryStore({ dbPath: join(root, "registry.sqlite"), packageRoot: join(root, "packages") });
  stores.push(store);
  return store;
}

afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Registry publication integrity", () => {
  it.each(["../../escape", "..", "1/2", "1\\2", "1.0.0\u0000"])("拒绝越界版本 %j", (version) => {
    expect(validateSkillPackage(pkg(version)).ok).toBe(false);
  });

  it("接受带构建元数据的语义版本，拒绝非规范别名", () => {
    expect(validateSkillPackage(pkg("1.2.3+build.1")).ok).toBe(true);
    expect(validateSkillPackage(pkg("v1.2.3")).ok).toBe(false);
    expect(validateSkillPackage(pkg(" 1.2.3 ")).ok).toBe(false);
  });

  it("相同版本不同内容拒绝覆盖，相同内容重试保持原包和计数", async () => {
    const store = await setup();
    store.publishPackage({ package: pkg("1.0.0") }, base);
    const raw = store.downloadPackage("review-skill", "1.0.0");
    expect(() => store.publishPackage({ package: pkg("1.0.0", "changed") }, base)).toThrow();
    expect(store.publishPackage({ package: pkg("1.0.0") }, base).ok).toBe(true);
    expect(store.getSkill("review-skill", base)?.downloads).toBe(1);
    expect(store.downloadPackage("review-skill", "1.0.0")).toBe(raw);
  });

  it("按语义版本排序，发布旧版本返回该版本，并保留每个版本自己的元数据", async () => {
    const store = await setup();
    for (const version of ["2.9.0", "2.10.0", "2.10.0-beta.2", "2.10.0-beta.10"]) {
      const result = store.publishPackage({ package: pkg(version) }, base);
      expect(result).toMatchObject({ ok: true, skill: { version, metadata: { name: `Review ${version}` } } });
    }
    expect(store.listVersions("review-skill", base).map((item) => item.version))
      .toEqual(["2.10.0", "2.10.0-beta.10", "2.10.0-beta.2", "2.9.0"]);
    expect(store.getSkill("review-skill", base)?.version).toBe("2.10.0");
    expect(store.downloadPackage("review-skill")).toBe(store.downloadPackage("review-skill", "2.10.0"));
  });
});
