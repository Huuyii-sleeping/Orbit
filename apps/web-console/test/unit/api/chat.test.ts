import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSessionMessageStream } from "../../../src/api/chat";
import { getErrorMessage } from "../../../src/lib/errors/error-factory";

afterEach(() => vi.unstubAllGlobals());

describe("流式对话错误", () => {
  it("非 JSON 错误页进入统一 HTTP 分类", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>private stack</html>", { status: 503 }),
      ),
    );
    await expect(
      sendSessionMessageStream("s", "hello", vi.fn()),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("成功状态返回 HTML 时不能静默当作流式成功", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>proxy login</html>", {
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );
    await expect(
      sendSessionMessageStream("s", "hello", vi.fn()),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("读取中途断流转成可理解的提示，保留原始异常", async () => {
    const cause = new Error("connection reset by peer");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(cause);
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    await expect(
      sendSessionMessageStream("s", "hello", vi.fn()),
    ).rejects.toMatchObject({
      kind: "unavailable",
      cause,
      message: "回复传输中断，请稍后重新发送消息。",
    });
  });

  it("message.error 事件由展示边界按业务码转译，不展示事件的原始正文", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            'event: message.error\ndata: {"code":"AGENT_UPSTREAM_UNAVAILABLE","message":"private stack"}\n\n',
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    const messages: string[] = [];
    await sendSessionMessageStream("s", "hello", (event) => {
      if (event.type === "message.error")
        messages.push(getErrorMessage(event.data));
    });
    expect(messages).toEqual(["Agent 运行服务尚未连接，请启动服务后重试。"]);
  });
});
