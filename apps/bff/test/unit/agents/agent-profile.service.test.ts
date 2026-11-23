import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStoreService } from "../../../src/storage/local-store.service.js";
import { AgentProfileService, normalizeAgentProfile } from "../../../src/agents/agent-profile.service.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function setup() {
  const root = mkdtempSync(join(tmpdir(), "orbit-agent-profile-test-"));
  roots.push(root);
  const store = new LocalStoreService({ filePath: join(root, "business.json") });
  return new AgentProfileService(store, { listSkills: vi.fn(async () => []) });
}

describe("Agent 创建表单", () => {
  it("可选文本留空保存后仍为空，不补入示例文案或技能", async () => {
    const service = setup();
    const agent = await service.createAgent({ name: "测试助手", systemPrompt: "整理资料", description: "", scenario: "" });
    expect(agent).toMatchObject({ description: "", scenario: "", actions: [], skills: [] });
    expect(await service.getAgent(agent.id)).toMatchObject({ description: "", scenario: "" });
  });

  it("创建和更新时拒绝空名称或职责，同时保留旧数据读取", async () => {
    const service = setup();
    await expect(service.createAgent({ name: " ", systemPrompt: "职责" })).rejects.toThrow("名称");
    await expect(service.createAgent({ name: "助手", systemPrompt: " " })).rejects.toThrow("职责");
    const agent = await service.createAgent({ name: "助手", systemPrompt: "职责" });
    await expect(service.updateAgent(agent.id, { systemPrompt: "" })).rejects.toThrow("职责");
    expect(normalizeAgentProfile({ id: "old", name: "旧卡片", systemPrompt: "已有职责" }).name).toBe("旧卡片");
  });
});
