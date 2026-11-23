import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileRepository } from "../../../src/runtime/json-file-repository.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("JsonFileRepository", () => {
  it("serializes concurrent mutations, preserves data after failure and reopens from disk", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "orbit-runtime-repository-"));
    directories.push(directory);
    const file = path.join(directory, "state.json");
    const repository = new JsonFileRepository(file, () => ({ count: 0 }));
    await Promise.all(Array.from({ length: 30 }, () => repository.update((state) => { state.count += 1; })));
    const beforeFailure = await readFile(file, "utf8");
    await expect(repository.update((state) => {
      state.count = -1;
      throw new Error("mutation failed");
    })).rejects.toThrow("mutation failed");
    expect(await readFile(file, "utf8")).toBe(beforeFailure);
    await repository.update((state) => { state.count += 1; });
    await expect(new JsonFileRepository(file, () => ({ count: 0 })).read()).resolves.toEqual({ count: 31 });
    expect(await readdir(directory)).toEqual(["state.json"]);
  });

  it("rejects corrupt files and filesystem errors instead of initializing empty state", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "orbit-runtime-repository-"));
    directories.push(directory);
    const file = path.join(directory, "state.json");
    await writeFile(file, "{broken");
    await expect(new JsonFileRepository(file, () => ({})).read()).rejects.toThrow();
    await expect(new JsonFileRepository(directory, () => ({})).read()).rejects.toMatchObject({ code: "EISDIR" });
  });
});
