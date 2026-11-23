import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ModelConnectionSummary } from "@orbit/runtime-contracts";

const connectionSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    provider: z.string().trim().min(1).max(80),
    modelId: z.string().trim().min(1).max(160),
    baseUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      })
      .optional(),
    apiKey: z.string().trim().max(8192).optional(),
  })
  .strict();

/** 连接配置错误只报告字段，不回显密钥或请求体。 */
export class ModelConnectionError extends Error {}

/** 校验工作台连接输入，阻止无效地址和凭据进入持久化文件。 */
export function parseModelConnection(input: unknown) {
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success)
    throw new ModelConnectionError(
      `请检查模型连接字段：${parsed.error.issues.map((issue) => issue.path.join(".")).join("、")}`,
    );
  return parsed.data;
}

type StoredConnection = ModelConnectionSummary & { encryptedKey?: string };
const storedSchema = connectionSchema.omit({ apiKey: true }).extend({
  id: z.string().uuid(),
  reference: z.string().startsWith("connection:"),
  hasApiKey: z.boolean(),
  createdAt: z.number(),
  deletedAt: z.number().optional(),
  encryptedKey: z.string().optional(),
});

/** 本机模型连接仓库；修订参数不可变，密钥加密保存且不进入公开目录。 */
export class ModelConnectionStore {
  constructor(private readonly root = join(process.cwd(), ".runtime", "model-connections")) {}

  private read(): StoredConnection[] {
    const file = join(this.root, "connections.json");
    if (!existsSync(file)) return [];
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error("模型连接存储格式无效或无法读取。");
    }
    const parsed = z.array(storedSchema).safeParse(data);
    if (!parsed.success) throw new Error("模型连接存储格式无效。");
    return parsed.data;
  }

  private key(create = false) {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const file = join(this.root, "key");
    if (!existsSync(file)) {
      if (!create) throw new Error("模型连接密钥文件不存在，无法读取已保存的 API Key。");
      writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
    }
    chmodSync(file, 0o600);
    const key = readFileSync(file);
    if (key.length !== 32) throw new Error("模型连接密钥文件无效。");
    return key;
  }

  list(deleted = false): ModelConnectionSummary[] {
    const records = this.read();
    const seen = new Set<string>();
    return records.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return Boolean(item.deletedAt) === deleted;
    }).map(({ encryptedKey: _secret, ...summary }) => {
      const previousReferences = records.filter((item) => item.id === summary.id && item.reference !== summary.reference).map((item) => item.reference);
      return previousReferences.length ? { ...summary, previousReferences } : summary;
    });
  }

  get(reference: string) {
    const entry = this.read().find((item) => item.reference === reference);
    if (!entry) throw new ModelConnectionError("模型连接不存在，请重新选择模型。");
    let apiKey: string | undefined;
    if (entry.encryptedKey) {
      const [iv, tag, payload] = entry.encryptedKey
        .split(".")
        .map((part) => Buffer.from(part, "base64"));
      const decipher = createDecipheriv("aes-256-gcm", this.key(), iv);
      decipher.setAuthTag(tag);
      apiKey = Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
    }
    const { encryptedKey: _secret, ...summary } = entry;
    return { ...summary, apiKey };
  }

  create(input: unknown): ModelConnectionSummary {
    return this.save(input, randomUUID());
  }

  /** 检查编辑基线后创建新修订；历史引用继续解析到原始配置。 */
  current(id: string, reference: string) {
    const current = this.read().find((item) => item.id === id);
    if (!current) throw new ModelConnectionError("模型配置不存在，请刷新后重试。");
    if (current.reference !== reference) throw new ModelConnectionError("模型配置已被修改，请刷新后重新编辑。");
    if (current.deletedAt) throw new ModelConnectionError("模型配置已删除，请先恢复后再编辑。");
    return this.get(current.reference);
  }

  /** 仅由目录服务在校验参数及编辑基线后写入修订。 */
  revise(id: string, input: unknown): ModelConnectionSummary {
    return this.save(input, id, `connection:${randomUUID()}`);
  }

  /** 标记全部修订的目录状态；解析已有引用时不受影响，也不需要解密凭据。 */
  setDeleted(id: string, reference: string, deleted: boolean) {
    const records = this.read();
    const current = records.find((item) => item.id === id);
    if (!current) throw new ModelConnectionError("模型配置不存在，请刷新后重试。");
    if (current.reference !== reference) throw new ModelConnectionError("模型配置已被修改，请刷新后重试。");
    const deletedAt = deleted ? current.deletedAt ?? Date.now() : undefined;
    this.write(records.map((item) => item.id === id ? { ...item, deletedAt } : item));
  }

  private save(input: unknown, id: string, reference = `connection:${id}`): ModelConnectionSummary {
    const { apiKey, ...config } = parseModelConnection(input);
    const summary = {
      ...config,
      id,
      reference,
      hasApiKey: Boolean(apiKey),
      createdAt: Date.now(),
    };
    const entry: StoredConnection = { ...summary };
    if (apiKey) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key(true), iv);
      const payload = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
      entry.encryptedKey = [iv, cipher.getAuthTag(), payload]
        .map((part) => part.toString("base64"))
        .join(".");
    }
    this.write([entry, ...this.read()]);
    return summary;
  }

  private write(records: StoredConnection[]) {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const file = join(this.root, "connections.json");
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(records), { mode: 0o600 });
    renameSync(temporary, file);
  }
}
