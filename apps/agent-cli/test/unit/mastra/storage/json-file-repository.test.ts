import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileRepository } from "../../../../src/mastra/storage/json-file-repository.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

describe("JsonFileRepository", () => {
  it("空文件或损坏 JSON 不能被当成首次创建", async () => {
    root = await mkdtemp(path.join(tmpdir(), "orbit-json-quota-store-"));
    const file = path.join(root, "runs.json");
    for (const raw of ["", "  ", "{broken"]) {
      await writeFile(file, raw, "utf8");
      await expect(new JsonFileRepository(file, () => ({ count: 0 })).read()).rejects.toThrow();
    }
  });

  it("存储读取失败时不能当成空仓库放行配额，恢复后重读原始记录", async () => {
    root = await mkdtemp(path.join(tmpdir(), "orbit-json-quota-store-"));
    const file = path.join(root, "runs.json");
    await mkdir(file);
    const repository = new JsonFileRepository(file, () => ({ count: 0 }));
    await expect(repository.update((value) => value.count++)).rejects.toThrow();
    await rm(file, { recursive: true });
    await writeFile(file, '{"count":5}', "utf8");
    expect(await repository.read()).toEqual({ count: 5 });
  });

  it("首次缺失允许创建，更新后新实例可以读取完整记录", async () => {
    root = await mkdtemp(path.join(tmpdir(), "orbit-json-quota-store-"));
    const file = path.join(root, "runs.json");
    const repository = new JsonFileRepository(file, () => ({ count: 0 }));
    await repository.update((value) => value.count++);
    expect(await new JsonFileRepository(file, () => ({ count: 0 })).read()).toEqual({ count: 1 });
  });
});
