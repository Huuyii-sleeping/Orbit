import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentAppRuntime } from "../../../../src/bootstrap/app-runtime.js";
import { createEmbeddedAgent } from "../../../../src/bootstrap/embedded-agent.js";
import { createMastraAgentService } from "../../../../src/bootstrap/mastra-service.js";
import { createTerminalRuntime } from "../../../../src/cli/tui/runtime.js";
import { AgentHost } from "../../../../src/host/agent-host.js";
import { createService } from "../../../fixtures/terminal-service.js";

vi.mock("../../../../src/bootstrap/embedded-agent.js", () => ({ createEmbeddedAgent: vi.fn() }));
vi.mock("../../../../src/bootstrap/mastra-service.js", () => ({
  createMastraAgentService: vi.fn(),
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("cli/tui/runtime", () => {
  it("daemon 连接复用远程服务，不创建本地宿主或修改远端模型", async () => {
    const service = createService();
    const runtime = await createTerminalRuntime({
      resolveDaemonService: async () => ({ service, notice: "connected" }),
    });
    expect(runtime.service).toBe(service);
    expect(runtime.notice).toBe("connected");
    expect(await runtime.setModel("another-model")).toBe(false);
    expect(createEmbeddedAgent).not.toHaveBeenCalled();
    expect(createMastraAgentService).not.toHaveBeenCalled();
  });

  it("切换模型复用工具、规则和会话宿主，失败时保持最后一次成功配置", async () => {
    vi.stubEnv("MODEL_ID", "original");
    vi.stubEnv("OPENAI_API_KEY", "fixture-only");
    const app = createAgentAppRuntime({ model: "original" });
    const host = new AgentHost();
    const original = createService();
    const replacement = createService();
    vi.mocked(createEmbeddedAgent).mockResolvedValue({
      app,
      host,
      service: original,
      startupIssue: new Error("model missing"),
    } as Awaited<ReturnType<typeof createEmbeddedAgent>>);
    vi.mocked(createMastraAgentService)
      .mockResolvedValueOnce(replacement as Awaited<ReturnType<typeof createMastraAgentService>>)
      .mockRejectedValueOnce(new Error("cannot assemble model"));
    const runtime = await createTerminalRuntime({ host, app });
    expect(await runtime.setModel("replacement")).toBe(true);
    expect(createMastraAgentService).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "replacement",
        toolService: app.toolService,
        promptSource: app.promptSource,
      }),
      host,
    );
    expect(runtime.service).toBe(replacement);
    expect(runtime.app?.toolService).toBe(app.toolService);
    expect(runtime.startupIssue).toBeNull();
    await expect(runtime.setModel("unknown-qa-provider/model")).rejects.toThrow("未知模型供应商");
    expect(createMastraAgentService).toHaveBeenCalledTimes(1);
    expect(runtime.service).toBe(replacement);
    await expect(runtime.setModel("broken")).rejects.toThrow("cannot assemble model");
    expect(runtime.service).toBe(replacement);
    expect(runtime.model).toBe("replacement");
    expect(process.env.MODEL_ID).toBe("replacement");
    expect(createEmbeddedAgent).toHaveBeenCalledOnce();
  });
});
