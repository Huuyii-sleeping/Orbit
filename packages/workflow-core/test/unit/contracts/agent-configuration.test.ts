import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIGURATION, normalizeAgentConfiguration } from "../../../src/index.js";

describe("Agent 配置边界", () => {
  it("旧草稿默认不授权工具，返回独立副本", () => {
    const result = normalizeAgentConfiguration(undefined);
    result.allowedToolIds.push("read_file");
    expect(DEFAULT_AGENT_CONFIGURATION.allowedToolIds).toEqual([]);
  });
  it.each([
    { outputSchema: { type: "array" } },
    { outputSchema: { type: "object", properties: { a: { type: "invented" } } } },
    { outputSchema: { type: "object", required: ["missing"] } },
    { outputSchema: { type: "object", patternProperties: {} } },
    { allowedToolIds: [12] },
    { outputSchema: { type: "object", properties: { n: { type: "number", minimum: 10, maximum: 1 } } } },
  ])("拒绝无法执行的配置 %j", (config) => {
    expect(() => normalizeAgentConfiguration(config)).toThrow();
  });
});
