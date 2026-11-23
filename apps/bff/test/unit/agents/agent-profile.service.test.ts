import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStoreService } from "../../../src/local-store.service.js";
import { AgentProfileService } from "../../../src/agents/agent-profile.service.js";

const roots: string[] = [];
const stores: LocalStoreService[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.onModuleDestroy());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "orbit-agent-profile-test-"));
  roots.push(root);
  const store = new LocalStoreService({ filePath: join(root, "business.json") });
  stores.push(store);
  return new AgentProfileService(store, { listSkills: vi.fn(async () => []) });
}

describe("Agent 草稿并发控制", () => {
  it("并发创建保留所有 Agent，并发编辑不同 Agent 不互相覆盖", async () => {
    const service = setup();
    const created = await Promise.all(Array.from({ length: 12 }, (_, i) => service.createAgent({ name: `助手${i}`, systemPrompt: "职责" })));
    expect(await service.listAgents()).toHaveLength(12);
    await Promise.all(created.map((agent) => service.updateAgent(agent.id, { description: agent.name })));
    for (const agent of created) expect((await service.getAgent(agent.id))?.description).toBe(agent.name);
  });

  it("携带过期 revision 的编辑明确冲突，保留最新草稿", async () => {
    const service = setup();
    const draft = await service.createAgent({ name: "助手", systemPrompt: "职责" });
    await service.updateAgent(draft.id, { ...draft, name: "新名称" });
    await expect(service.updateAgent(draft.id, { ...draft, name: "旧页面" })).rejects.toThrow(/revision/);
    expect((await service.getAgent(draft.id))?.name).toBe("新名称");
  });

  it("无效 revision 不修改草稿", async () => {
    const service = setup();
    const draft = await service.createAgent({ name: "助手", systemPrompt: "职责" });
    await expect(service.updateAgent(draft.id, { revision: -1, name: "无效编辑" })).rejects.toThrow(/revision/);
    expect((await service.getAgent(draft.id))?.name).toBe("助手");
  });
});
