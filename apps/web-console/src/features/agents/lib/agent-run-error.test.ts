import { describe, expect, it } from "vitest";
import { agentRunErrorMessage } from "./agent-run-error";

describe("Agent 运行错误提示", () => {
  it("免费额度错误说明原因和下一步，避免误报为普通限流", () => {
    expect(
      agentRunErrorMessage(
        'Free quota exhausted. To continue accessing the model on a paid basis, please add funds or disable the "use free tier only" mode in the management console.',
      ),
    ).toContain("免费额度已用尽");
    expect(agentRunErrorMessage("AllocationQuota.FreeTierOnly")).toContain(
      "更换模型连接",
    );
  });
  it.each([
    ["Incorrect API key provided", "API Key"],
    ["Authentication Fails", "API Key"],
    ["Insufficient Balance", "余额"],
    ["insufficient_quota", "额度"],
    ["Rate limit reached", "请求过于频繁"],
    ["节点执行超过 30000ms。", "超时"],
    ["Agent child run qa 的输出不符合发布版本 schema。", "输出格式"],
    ["Agent 工具不可用：read_file", "工具"],
  ])("解释 %s 并给出下一步", (raw, expected) => {
    const result = agentRunErrorMessage(raw);
    expect(result).toContain(expected);
    expect(result).not.toBe(raw);
  });
  it("未知错误和缺少模型提示保留原文", () => {
    expect(
      agentRunErrorMessage("请选择模型连接，或配置系统默认 MODEL_ID。"),
    ).toBe("请选择模型连接，或配置系统默认 MODEL_ID。");
    expect(agentRunErrorMessage("Unrecognized provider error")).toBe("Unrecognized provider error");
  });
});
