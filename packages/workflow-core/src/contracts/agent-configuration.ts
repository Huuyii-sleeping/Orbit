import type { AgentOutputSchema } from "./nodes.js";

/** Agent 草稿可编辑、发布时固定的运行配置；空 modelId 使用系统模型策略。 */
export type AgentConfiguration = {
  modelId: string;
  allowedToolIds: string[];
  outputSchema: AgentOutputSchema;
};

/** 旧草稿与新建 Agent 的默认配置。 */
export const DEFAULT_AGENT_CONFIGURATION: AgentConfiguration = {
  modelId: "",
  allowedToolIds: [],
  outputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
};

/** 无效配置在保存和发布边界明确拒绝。 */
export class AgentConfigurationError extends Error {
  readonly code = "AGENT_CONFIGURATION_INVALID";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const schemaKeys = new Set([
  "type",
  "title",
  "description",
  "properties",
  "required",
  "items",
  "enum",
  "minimum",
  "maximum",
  "additionalProperties",
]);
const schemaTypes = new Set([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

function validateSchema(value: unknown, path: string, depth = 0): void {
  const fail = (message: string): never => {
    throw new AgentConfigurationError(`${path}：${message}`);
  };
  if (!record(value) || depth > 16)
    fail("必须是 JSON Schema 对象，嵌套不能超过 16 层。");
  const schema = value as Record<string, unknown>;
  for (const key of Object.keys(schema))
    if (!schemaKeys.has(key)) fail(`暂不支持 ${key}。`);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (
      !types.length ||
      types.some((type) => typeof type !== "string" || !schemaTypes.has(type))
    )
      fail("type 无效。");
  }
  for (const key of ["title", "description"])
    if (schema[key] !== undefined && typeof schema[key] !== "string")
      fail(`${key} 必须是文本。`);
  if (schema.properties !== undefined) {
    if (!record(schema.properties)) fail("properties 必须是对象。");
    for (const [key, child] of Object.entries(
      schema.properties as Record<string, unknown>,
    ))
      validateSchema(child, `${path}.${key}`, depth + 1);
  }
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      schema.required.some(
        (key) =>
          typeof key !== "string" ||
          !record(schema.properties) ||
          !Object.hasOwn(schema.properties, key),
      ))
  )
    fail("required 必须引用 properties 中的字段。");
  if (schema.items !== undefined)
    validateSchema(schema.items, `${path}.items`, depth + 1);
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== "boolean"
  )
    fail("additionalProperties 目前仅支持布尔值。");
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) ||
      !schema.enum.length ||
      schema.enum.some((item) => item !== null && typeof item === "object"))
  )
    fail("enum 必须是非空基本值数组。");
  for (const key of ["minimum", "maximum"])
    if (
      schema[key] !== undefined &&
      (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))
    )
      fail(`${key} 必须是有限数字。`);
  if (
    typeof schema.minimum === "number" &&
    typeof schema.maximum === "number" &&
    schema.minimum > schema.maximum
  )
    fail("minimum 不能大于 maximum。");
}

/** 校验配置并复制数据，防止草稿编辑改变发布快照。 */
export function normalizeAgentConfiguration(
  value: unknown,
): AgentConfiguration {
  if (value === undefined) return structuredClone(DEFAULT_AGENT_CONFIGURATION);
  if (!record(value)) throw new AgentConfigurationError("运行配置必须是对象。");
  const modelId = value.modelId ?? "";
  if (typeof modelId !== "string" || modelId.length > 160)
    throw new AgentConfigurationError("模型 ID 必须是不超过 160 字符的文本。");
  const tools = value.allowedToolIds ?? [];
  if (
    !Array.isArray(tools) ||
    tools.length > 128 ||
    tools.some((id) => typeof id !== "string" || !id.trim() || id.length > 160)
  )
    throw new AgentConfigurationError("工具权限必须是有效的工具 ID 列表。");
  const schema = value.outputSchema ?? DEFAULT_AGENT_CONFIGURATION.outputSchema;
  if (JSON.stringify(schema).length > 32_000)
    throw new AgentConfigurationError("输出格式不能超过 32KB。");
  validateSchema(schema, "输出格式");
  if (!record(schema) || schema.type !== "object")
    throw new AgentConfigurationError("输出格式的根类型必须是 object。");
  return {
    modelId: modelId.trim(),
    allowedToolIds: [...new Set(tools.map((id: string) => id.trim()))],
    outputSchema: structuredClone(schema) as AgentOutputSchema,
  };
}
