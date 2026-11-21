import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAgentSkills } from "../../../src/api/agents";

afterEach(() => vi.unstubAllGlobals());

describe("技能预检异常", () => {
  it("500 错误不能被归一化成预检成功", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              statusCode: 500,
              message: "Internal Server Error",
            }),
            { status: 500 },
          ),
      ),
    );
    await expect(
      resolveAgentSkills({ id: "a", name: "a", skills: [] }),
    ).rejects.toMatchObject({ kind: "server" });
  });

  it("预检业务失败保留逐项技能诊断，转为中文提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "AGENT_SKILL_LOAD_FAILED",
                message: "private error",
                details: [
                  {
                    skillId: "missing",
                    code: "SKILL_PACKAGE_NOT_FOUND",
                    message: "private path",
                  },
                ],
              },
            }),
            { status: 400 },
          ),
      ),
    );
    await expect(
      resolveAgentSkills({ id: "a", name: "a", skills: [] }),
    ).resolves.toMatchObject({
      ok: false,
      message: "Agent 技能加载失败，请检查绑定技能的安装状态与版本。",
      issues: [
        {
          skillId: "missing",
          code: "SKILL_PACKAGE_NOT_FOUND",
          message: "所需技能包不存在，请重新安装技能。",
        },
      ],
    });
  });
});
