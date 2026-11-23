import { describe, expect, it, vi } from "vitest";
import { AgentVersionService } from "../../../src/agents/agent-version.service.js";
import { normalizeAgentProfile } from "../../../src/agents/agent-profile.service.js";

function setup() {
  const profile = normalizeAgentProfile({
    id: "agent-1", name: "分析师", systemPrompt: "分析并引用证据", skills: [],
    configuration: {
      modelId: "analysis-model", allowedToolIds: ["read_file"],
      outputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    },
  });
  const profiles = { getAgent: vi.fn(async () => profile) };
  const versions = { publish: vi.fn((snapshot) => ({ ...snapshot, id: "v1", version: 1 })) };
  return { profile, versions, service: new AgentVersionService(profiles as never, versions as never) };
}

describe("AgentVersionService", () => {
  it("发布快照保留模型、工具和输出约束，后续编辑不影响已发布配置", async () => {
    const { service, profile } = setup();
    const first = await service.publish(profile.id, {});
    expect(first).toMatchObject({
      modelId: "analysis-model", toolPolicy: { allowedToolIds: ["read_file"] },
      outputSchema: { required: ["summary"] }, instructions: ["分析并引用证据"],
    });
    profile.systemPrompt = "另一个职责";
    profile.configuration!.allowedToolIds.push("write_file");
    const second = await service.publish(profile.id, {});
    expect(first.toolPolicy.allowedToolIds).toEqual(["read_file"]);
    expect(first.instructions).toEqual(["分析并引用证据"]);
    expect(second.contentHash).not.toBe(first.contentHash);
  });
});
