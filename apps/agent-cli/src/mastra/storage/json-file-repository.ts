import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** 为小型运行控制面状态提供串行、原子 JSON 文件读写。 */
export class JsonFileRepository<T> {
  private value: T | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly initialValue: () => T,
    private readonly persistenceEnabled = true,
  ) {}

  async read(): Promise<T> {
    if (this.value !== null) return structuredClone(this.value);
    if (!this.persistenceEnabled) {
      this.value = this.initialValue();
      return structuredClone(this.value);
    }
    const raw = await readFile(this.filePath, "utf8").catch(() => "");
    this.value = raw.trim() ? JSON.parse(raw) as T : this.initialValue();
    return structuredClone(this.value);
  }

  async update(mutator: (value: T) => void): Promise<T> {
    let result: T | null = null;
    const operation = this.pending.catch(() => undefined).then(async () => {
      const current = await this.read();
      mutator(current);
      if (this.persistenceEnabled) await this.write(current);
      this.value = structuredClone(current);
      result = structuredClone(current);
    });
    this.pending = operation;
    await operation;
    return result as T;
  }

  private async write(value: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rm(this.filePath, { force: true }).catch(() => undefined);
    await rename(temp, this.filePath);
  }
}
