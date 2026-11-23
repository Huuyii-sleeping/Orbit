import { normalizeAgentRuntimeContext } from "../service-api/sessions.js";
import { resolveBoundSkills } from "../skills/loader.js";

/** 校验并加载 Agent 技能，不依赖聊天会话或模型连接。 */
export class AgentSkillService {
  resolveAgentSkills(input: unknown): Record<string, unknown> {
    const agent = normalizeAgentRuntimeContext(input);
    if (!agent) {
      return {
        ok: false,
        error: {
          code: "INVALID_AGENT_CONTEXT",
          message: "agent context is required",
        },
      };
    }
    const resolvedSkills = resolveBoundSkills(agent);
    if (!resolvedSkills.ok) {
      return {
        ok: false,
        error: {
          code: "AGENT_SKILL_LOAD_FAILED",
          message: "agent skill binding could not be loaded",
          details: resolvedSkills.issues,
        },
        agent,
      };
    }
    return {
      ok: true,
      agent,
      skills: resolvedSkills.skills.map((skill) => ({
        name: skill.name,
        sourceType: skill.sourceType,
        path: skill.path,
        contentLength: skill.contentLength,
      })),
    };
  }
}
