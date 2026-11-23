import { readdir, readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const errors = [];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx|css)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

const workspaceRoots = ["apps", "packages"];
const sources = [];
for (const directory of workspaceRoots) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = join(root, directory, entry.name, "src");
    if (await exists(source)) sources.push(...await sourceFiles(source));
  }
}

// 包括已跟踪文件，防止宽泛的 ignore 规则再次隐藏生产源码。
try {
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: root,
    input: sources.map((file) => relative(root, file)).join("\n") + "\n",
    encoding: "utf8",
  }).trim();
  if (ignored) errors.push(`生产源码被 Git 忽略：\n${ignored}`);
} catch (error) {
  if (error.status !== 1) throw error;
}

for (const file of sources) {
  const content = await readFile(file, "utf8");
  // 只检查模块声明，避免把业务数据中的相对路径当作源码依赖。
  const imports = content.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|@import\s*)["']([^"'\n]+)["']/g);
  for (const [, specifier] of imports) {
    if (!specifier.startsWith(".")) continue;
    const target = resolve(dirname(file), specifier);
    if (!target.startsWith(join(root, "apps") + "/") && !target.startsWith(join(root, "packages") + "/")) {
      errors.push(`${relative(root, file)} 引用了工作区源码之外的路径：${specifier}`);
      continue;
    }
    const candidates = [target];
    if (specifier.endsWith(".js")) candidates.push(target.slice(0, -3) + ".ts", target.slice(0, -3) + ".tsx");
    if (!extname(specifier)) candidates.push(target + ".ts", target + ".tsx", join(target, "index.ts"), join(target, "index.tsx"));
    if (!(await Promise.all(candidates.map(exists))).some(Boolean)) {
      errors.push(`${relative(root, file)} 的相对模块不存在：${specifier}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Repository structure check passed (${sources.length} source files).`);
}
