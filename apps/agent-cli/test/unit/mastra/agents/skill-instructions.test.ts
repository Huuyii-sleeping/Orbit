import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentExecutionContext } from "@orbit/runtime-contracts";
import { resolveVersionSkillInstructions } from "../../../../src/mastra/agents/skill-instructions.js";

const command: AgentExecutionContext = {
  agentId: "agent", agentVersion: "v1", sessionId: "non-chat-session", resourceId: "r", threadId: "t", messages: [], requestContext: {},
  policy: { allowedToolIds: [], allowedSkillIds: ["review"] },
  skillBindings: [{ skillId: "review", version: "1.0.0", sourceType: "remote", registrySource: "official" }],
};

describe("固定技能指令", () => {
  it("不存在聊天 session 时仍加载绑定版本；缺失版本明确失败", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-agent-skill-"));
    try {
      const folder = join(root, "remote", "review", "1.0.0");
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "skill.json"), JSON.stringify({ id: "review", version: "1.0.0", entry: "SKILL.md" }));
      writeFileSync(join(folder, "SKILL.md"), "---\nname: review\ndescription: review\n---\nAlways include evidence.");
      expect(resolveVersionSkillInstructions(command, { skillHubRoots: [root] }).join("\n")).toContain("Always include evidence.");
      expect(() => resolveVersionSkillInstructions({ ...command, skillBindings: [{ ...command.skillBindings![0]!, version: "2.0.0" }] }, { skillHubRoots: [root] })).toThrow("技能加载失败");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
