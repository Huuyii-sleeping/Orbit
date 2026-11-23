/** 接口格式映射至 Mastra 内置供应商，产品层不实现协议转换。 */
export const MODEL_FORMATS = [
  {
    value: "openai-compatible",
    label: "OpenAI 兼容",
    hint: "适用于通义兼容接口、DeepSeek 和多数本地服务，填写服务提供的兼容 API 地址。",
  },
  {
    value: "anthropic",
    label: "Anthropic Messages",
    hint: "使用 Anthropic 原生 Messages 接口，可保留默认地址或填写兼容地址。",
  },
  {
    value: "google",
    label: "Google Gemini",
    hint: "使用 Gemini 原生接口，可保留默认地址或填写兼容地址。",
  },
] as const;

/** 为已有连接展示接口格式；其他原生供应商配置继续保留。 */
export function modelFormatLabel(provider: string) {
  return (
    MODEL_FORMATS.find((format) => format.value === provider)?.label ?? provider
  );
}
