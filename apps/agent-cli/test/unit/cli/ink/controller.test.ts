import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";
import type { AgentAppRuntimeDeps } from "../../../../src/bootstrap/app-runtime.js";
import { createInkRuntimeController } from "../../../../src/cli/ink/controller.js";
import type { TerminalTuiServiceLike } from "../../../../src/entrypoints/tui.js";

const PROMPT_SOURCE = {
  core: "test-core",
  tools: [],
  skills: [],
  rules: [],
};

function createService(
  history: ChatCompletionMessageParam[],
  assistant = "chat reply",
): TerminalTuiServiceLike {
  const sessions = [
    {
      id: "s01",
      busy: false,
      history,
    },
  ];

  return {
    bridgeManifest: () => ({ endpoints: { events: "/events" } }),
    createSession: vi.fn(() => sessions[0]),
    listSessions: vi.fn(() => sessions),
    toolsMetadata: vi.fn(async () => []),
    chat: vi.fn(async (input) => {
      history.push({ role: "user", content: String(input.message) });
      history.push({ role: "assistant", content: assistant });
      return { ok: true, session: { id: "s01" }, assistant };
    }),
  };
}

describe("cli/ink/controller", () => {
  it("定时任务等待远程创建会话时仍独占执行，避免与用户输入或另一 tick 重叠", async () => {
    const service = createService([]);
    vi.mocked(service.listSessions).mockReturnValue([]);
    let releaseSession!: (session: { id: string }) => void;
    const pendingSession = new Promise<{ id: string }>((resolve) => {
      releaseSession = resolve;
    });
    vi.mocked(service.createSession).mockReturnValue(pendingSession);
    const controller = createInkRuntimeController({
      service,
      startupIssue: null,
      runtimeCoordinationService: {
        runAutonomyTick: vi.fn(async () => ({})),
        tickScheduler: vi.fn(async () => undefined),
        peekScheduledPromptCount: vi.fn(async () => 1),
      },
    });
    const scheduled = controller.runScheduledTick();
    await vi.waitFor(() => expect(service.createSession).toHaveBeenCalledOnce());
    const user = await controller.submit("hello during session creation");
    const duplicateTick = controller.runScheduledTick();
    releaseSession({ id: "s01" });
    await scheduled;
    expect(user.messages[0]?.text).toContain("already running");
    expect(await duplicateTick).toEqual([]);
    expect(service.chat).toHaveBeenCalledTimes(1);
    expect(service.chat).toHaveBeenCalledWith(
      expect.objectContaining({ include_scheduled_notifications: true }),
    );
    await controller.submit("after scheduled task");
    expect(service.chat).toHaveBeenCalledTimes(2);
  });

  it.each(["scheduler", "session"])("%s 抛出异常时显示定时错误并允许继续输入", async (failure) => {
    const service = createService([]);
    vi.mocked(service.listSessions).mockReturnValue([]);
    vi.mocked(service.createSession).mockRejectedValueOnce(new Error("session unavailable"));
    const controller = createInkRuntimeController({
      service,
      startupIssue: null,
      runtimeCoordinationService: {
        runAutonomyTick: vi.fn(async () => ({})),
        tickScheduler: vi.fn(async () => {
          if (failure === "scheduler") throw new Error("scheduler unavailable");
        }),
        peekScheduledPromptCount: vi.fn(async () => 1),
      },
    });
    const messages = await controller.runScheduledTick();
    expect(messages.map((message) => message.text).join("\n")).toContain(`${failure} unavailable`);
    await controller.submit("retry");
    expect(service.chat).toHaveBeenCalledOnce();
  });

  it("/model 成功后下一轮使用新服务，失败时保留旧模型和会话", async () => {
    const original = createService([]);
    const replacement = createService([], "replacement reply");
    let service = original;
    const setModel = vi.fn(async (model: string) => {
      if (model === "broken") return false;
      service = replacement;
      return true;
    });
    const controller = createInkRuntimeController({
      get service() {
        return service;
      },
      startupIssue: null,
      setModel,
    });
    await controller.submit("hello");
    const switched = await controller.submit("/model replacement");
    expect(setModel).toHaveBeenCalledWith("replacement");
    expect(switched.messages.map((item) => item.text).join("\n")).toContain("replacement");
    await controller.submit("after switch");
    expect(replacement.chat).toHaveBeenCalledWith({ session_id: "s01", message: "after switch" });
    await controller.submit("/model broken");
    const status = await controller.submit("/model");
    expect(status.messages.map((item) => item.text).join("\n")).toContain("replacement");
    expect(original.chat).toHaveBeenCalledTimes(1);
  });

  it("runs due scheduled prompts through the Ink runtime controller", async () => {
    const history: ChatCompletionMessageParam[] = [];
    const service = createService(history, "喝水提醒到了");
    const app = {
      model: "test-model",
      promptSource: PROMPT_SOURCE,
      runtimeCoordinationService: {
        runAutonomyTick: vi.fn(async () => ({})),
        tickScheduler: vi.fn(async () => undefined),
        peekScheduledPromptCount: vi.fn(async () => 1),
      },
    } as unknown as AgentAppRuntimeDeps;

    const controller = createInkRuntimeController({ service, app, startupIssue: null });
    const messages = await controller.runScheduledTick();

    expect(app.runtimeCoordinationService.tickScheduler).toHaveBeenCalledTimes(1);
    expect(service.chat).toHaveBeenCalledWith({
      session_id: "s01",
      message: "Handle any scheduled prompts that are due now.",
      include_scheduled_notifications: true,
    });
    expect(history).toEqual([
      { role: "user", content: "Handle any scheduled prompts that are due now." },
      { role: "assistant", content: "喝水提醒到了" },
    ]);
    expect(messages.map((message) => message.text).join("\n")).toContain("scheduled due");
    expect(messages.map((message) => message.text).join("\n")).toContain("喝水提醒到了");
  });

  it("drives due scheduled prompts through daemon-backed services", async () => {
    const history: ChatCompletionMessageParam[] = [];
    const service = createService(history);
    const coordination = {
      runAutonomyTick: vi.fn(async () => ({})),
      tickScheduler: vi.fn(async () => undefined),
      peekScheduledPromptCount: vi.fn(async () => 1),
    };
    service.chat = vi.fn(async (input) => {
      history.push({ role: "user", content: String(input.message) });
      history.push({ role: "assistant", content: "daemon 喝水提醒到了" });
      return {
        ok: true,
        session: { id: input.session_id ?? "s01" },
        assistant: "daemon 喝水提醒到了",
      };
    });

    const controller = createInkRuntimeController({
      service,
      app: null,
      startupIssue: null,
      runtimeCoordinationService: coordination,
    });
    const messages = await controller.runScheduledTick();

    expect(coordination.tickScheduler).toHaveBeenCalledTimes(1);
    expect(service.chat).toHaveBeenCalledWith({
      session_id: "s01",
      message: "Handle any scheduled prompts that are due now.",
      include_scheduled_notifications: true,
    });
    expect(messages.map((message) => message.text).join("\n")).toContain("scheduled due");
    expect(messages.map((message) => message.text).join("\n")).toContain("daemon 喝水提醒到了");
  });
});
