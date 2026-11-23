import type { AgentExecutionContext } from "@orbit/runtime-contracts";
import {
  resolveBoundSkills,
  toPromptSkillBlocks,
  type SkillLoaderOptions,
} from "../../skills/loader.js";

/** 直接解析执行快照中的固定技能版本，不依赖聊天 session 是否存在。 */
export function resolveVersionSkillInstructions(
  command: AgentExecutionContext,
  options?: SkillLoaderOptions,
): string[] {
  const resolved = resolveBoundSkills(
    { id: command.agentId, name: command.agentId, skills: command.skillBindings ?? [] },
    options,
  );
  if (!resolved.ok)
    throw new Error(
      `Agent 技能加载失败：${resolved.issues.map((issue) => issue.message).join("；")}`,
    );
  return toPromptSkillBlocks(resolved.skills, { sessionId: command.sessionId });
}
