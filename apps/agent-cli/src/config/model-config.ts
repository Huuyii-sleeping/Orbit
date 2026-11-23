import { readFileSync } from "node:fs";
import { z } from "zod";

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.string(), z.number(), z.boolean(), z.array(jsonValue), z.record(jsonValue)]),
);
const providerSchema = z
  .object({
    provider: z.string().min(1),
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
    apiKeyEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
      .optional(),
  })
  .strict();
const configSchema = z
  .object({
    providers: z.record(providerSchema).default({}),
    models: z
      .record(
        z
          .object({
            provider: z.string().min(1),
            modelId: z.string().trim().min(1),
            supportsTools: z.boolean().optional(),
            supportsTemperature: z.boolean().optional(),
            providerOptions: z.record(z.record(jsonValue)).optional(),
          })
          .strict(),
      )
      .default({}),
  })
  .strict();

/** 读取服务端连接与别名配置；provider 使用 Mastra 注册名称，不维护自己的协议枚举。 */
export function loadModelConfig(env: NodeJS.ProcessEnv, input?: unknown) {
  let raw = input;
  if (raw === undefined && env.MODEL_CONFIG_FILE?.trim()) {
    try {
      raw = JSON.parse(readFileSync(env.MODEL_CONFIG_FILE.trim(), "utf8"));
    } catch {
      throw new Error("无法读取 MODEL_CONFIG_FILE；请检查文件路径与 JSON 格式。");
    }
  }
  const parsed = configSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    // 只报告字段位置，避免将配置中的凭据回显到错误日志。
    throw new Error(
      `模型配置格式无效：${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }
  return parsed.data;
}
