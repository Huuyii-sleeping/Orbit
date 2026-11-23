import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStoreService } from "../../../src/local-store.service.js";

const roots: string[] = [];
const stores: LocalStoreService[] = [];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "orbit-business-storage-"));
  roots.push(root);
  const filePath = join(root, "business.json");
  const store = new LocalStoreService({ filePath });
  stores.push(store);
  return { store, filePath };
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.onModuleDestroy?.();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LocalStoreService transactions", () => {
  it("并发写不同 section 不丢更新，另一实例也能读到所有结果", async () => {
    const { store, filePath } = await setup();
    await Promise.all(Array.from({ length: 24 }, (_, i) => store.writeSection(`key-${i}`, { value: i })));
    const other = new LocalStoreService({ filePath });
    stores.push(other);
    for (let i = 0; i < 24; i++) expect(await other.readSection(`key-${i}`, null)).toEqual({ value: i });
  });

  it("不同连接对同一 section 的事务修改不会覆盖彼此", async () => {
    const { store, filePath } = await setup();
    const other = new LocalStoreService({ filePath });
    stores.push(other);
    await Promise.all(Array.from({ length: 40 }, (_, index) =>
      (index % 2 ? store : other).updateSection("counter", 0, (current) => current + 1)));
    expect(await store.readSection("counter", 0)).toBe(40);
  });

  it("首次导入旧 JSON，保留原文件，重新启动不覆盖数据库中的新值", async () => {
    const { store, filePath } = await setup();
    const legacy = JSON.stringify({ profile: { displayName: "旧用户" }, settings: { theme: "light" } });
    await writeFile(filePath, legacy);
    expect(await store.readSection("profile", null)).toEqual({ displayName: "旧用户" });
    await store.writeSection("profile", { displayName: "新用户" });
    expect(await readFile(filePath, "utf8")).toBe(legacy);
    const other = new LocalStoreService({ filePath });
    stores.push(other);
    expect(await other.readSection("profile", null)).toEqual({ displayName: "新用户" });
    expect(await other.readSection("settings", null)).toEqual({ theme: "light" });
  });

  it("损坏的旧文件明确失败，修复文件后可以重试导入", async () => {
    const { store, filePath } = await setup();
    await writeFile(filePath, "{broken");
    await expect(store.readSection("profile", null)).rejects.toThrow();
    await writeFile(filePath, JSON.stringify({ profile: { displayName: "恢复用户" } }));
    expect(await store.readSection("profile", null)).toEqual({ displayName: "恢复用户" });
  });
});
