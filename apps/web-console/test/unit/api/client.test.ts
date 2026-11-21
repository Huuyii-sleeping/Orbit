import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, requestJson } from "../../../src/api/client";

afterEach(() => vi.unstubAllGlobals());

describe("请求错误收口", () => {
  it("上游异常显示中文，同时保留业务错误码和原始异常供诊断", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "AGENT_UPSTREAM_UNAVAILABLE",
                message: "fetch failed",
                host: "private-host",
              },
            }),
            { status: 502 },
          ),
      ),
    );
    await expect(requestJson("/api/sessions")).rejects.toMatchObject({
      kind: "unavailable",
      code: "AGENT_UPSTREAM_UNAVAILABLE",
      status: 502,
      message: "Agent 运行服务尚未连接，请启动服务后重试。",
      metadata: { host: "private-host" },
    });
    await expect(requestJson("/api/sessions")).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });

  it("HTML 错误页按 HTTP 状态分类，不泄漏页面或误报 JSON 解析错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>secret stack</html>", { status: 500 }),
        ),
    );
    await expect(requestJson("/api/agents")).rejects.toMatchObject({
      kind: "server",
      status: 500,
      message: "服务暂时出现问题，请稍后重试。",
    });
  });

  it("网络拒绝保留原始 cause，转换为可读提示", async () => {
    const cause = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause));
    await expect(requestJson("/api/agents")).rejects.toMatchObject({
      kind: "network",
      cause,
      message: "无法连接服务，请检查网络连接后重试。",
    });
  });

  it("成功状态中的损坏 JSON 明确报告响应异常", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>proxy</html>")),
    );
    await expect(requestJson("/api/agents")).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("HTTP 200 中的业务失败同样转译，保留冲突元数据", async () => {
    const current = { revision: 5 };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "SOP_REVISION_CONFLICT",
                message: "internal details",
                current,
              },
            }),
          ),
        ),
    );
    await expect(requestJson("/api/sops/a")).rejects.toMatchObject({
      kind: "conflict",
      metadata: { current },
      message: "这份工作流已被更新，请加载最新版本或合并修改后再保存。",
    });
  });

  it("无内容响应保留成功语义", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(requestJson("/api/agents/a")).resolves.toEqual({});
  });
});
