import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { valid } from "semver";
import type { ValidatedSkillPackage } from "./skill-types.js";

async function storedFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await storedFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error("unsupported file in stored skill package");
  }
  return files;
}

/** 整包原子写入：相同版本允许相同内容重试，拒绝覆盖已存在的内容。 */
export async function writeSkillPackage(root: string, source: "remote" | "custom", skillPackage: ValidatedSkillPackage): Promise<void> {
  const { id, version } = skillPackage.manifest;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !version || version.length > 40 || valid(version) !== version.split("+")[0]) {
    throw new Error("invalid skill id or semantic version");
  }
  const parent = resolve(root, source, id);
  const target = join(parent, version);
  const temporary = join(parent, `.staging-${randomUUID()}`);
  // 独立验证文件路径，不依赖外部类型断言或先前的校验。
  for (const file of skillPackage.files) {
    const path = resolve(temporary, file.path);
    if (!path.startsWith(`${temporary}/`)) throw new Error(`unsafe package path: ${file.path}`);
  }
  await mkdir(temporary, { recursive: true });
  try {
    for (const file of skillPackage.files) {
      const path = resolve(temporary, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content, { encoding: "utf8", flag: "wx", flush: true });
    }
    try { await rename(temporary, target); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && (error.code === "EEXIST" || error.code === "ENOTEMPTY"))) throw error;
      const existing = (await storedFiles(target)).sort();
      const expected = skillPackage.files.map((file) => file.path).sort();
      const conflict = () => new Error(`skill ${id}@${version} already exists with different content`);
      if (JSON.stringify(existing) !== JSON.stringify(expected)) throw conflict();
      for (const file of skillPackage.files) {
        if (await readFile(resolve(target, file.path), "utf8") !== file.content) throw conflict();
      }
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
