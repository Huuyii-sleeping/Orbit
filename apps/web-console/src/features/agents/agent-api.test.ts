import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultAgentProfileInput,
  fetchAgentTests,
  fetchAgentTools,
  normalizeAgentProfile,
  startAgentTest,
  updateAgentProfile,
} from "../../api/index";

afterEach(() => vi.unstubAllGlobals());

describe("Agent 工作台 API", () => {
  it("配置经过保存与读取后保持模型、工具和输出约束", async () => {
    const configuration = {
      modelId: "analysis-model",
      allowedToolIds: ["read_file"],
      outputSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    };
    const fetcher = vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body).configuration).toEqual(configuration);
      return new Response(
        JSON.stringify({
          ok: true,
          agent: { ...defaultAgentProfileInput, id: "agent", configuration },
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const saved = await updateAgentProfile("agent", {
      ...defaultAgentProfileInput,
      configuration,
    });
    expect(saved.configuration).toEqual(configuration);
    expect(defaultAgentProfileInput.skillIds).toEqual([]);
    expect(
      normalizeAgentProfile({ id: "old" }).configuration?.allowedToolIds,
    ).toEqual([]);
  });

  it("试跑保留固定版本，历史和工具目录使用领域接口", async () => {
    const fetcher = vi.fn(async (url, init) => {
      if (init) {
        expect(JSON.parse(init.body)).toEqual({
          inputs: { task: "test" },
          versionId: "v1",
        });
        return new Response(
          JSON.stringify({
            ok: true,
            data: { run: { id: "run" }, configuration: { versionId: "v1" } },
          }),
        );
      }
      return new Response(
        JSON.stringify(
          url.endsWith("catalog")
            ? { ok: true, tools: [{ name: "read_file", description: "Read" }] }
            : { ok: true, data: [] },
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await startAgentTest("agent", { task: "test" }, "v1")).toMatchObject(
      { configuration: { versionId: "v1" } },
    );
    expect(await fetchAgentTests("agent")).toEqual([]);
    expect(await fetchAgentTools()).toEqual([
      { name: "read_file", description: "Read" },
    ]);
  });
});
