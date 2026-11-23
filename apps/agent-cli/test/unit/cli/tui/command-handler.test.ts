import { describe, expect, it, vi } from "vitest";
import { CliComposerStore } from "../../../../src/cli/composer.js";
import { CliPaletteStore } from "../../../../src/cli/palette.js";
import { CliTranscriptBrowserStore } from "../../../../src/cli/transcript.js";
import { handleTerminalTuiCommand } from "../../../../src/cli/tui/command-handler.js";
import { createService } from "../../../fixtures/terminal-service.js";

describe("cli/tui/command-handler", () => {
  it("不支持压缩的旧服务明确失败，而不改写终端展示历史", async () => {
    const service = createService();
    const history = structuredClone(service.listSessions()[0]!.history);
    const result = await handleTerminalTuiCommand({
      line: "/compact 1",
      service,
      activeSessionId: "s01",
      model: "test-model",
      setModel: async () => false,
      composer: new CliComposerStore(),
    });
    expect(result.output).toContain("compact unavailable");
    expect(result.output).toContain("Mastra");
    expect(service.listSessions()[0]!.history).toEqual(history);
  });

  it("/compact 委托当前服务，未开始会话时不隐式选择其他会话", async () => {
    const service = {
      ...createService(),
      compactSession: vi.fn(async () => ({
        sourceThreadId: "s01",
        threadId: "new-thread",
        keptRecent: 2,
        oldMessageCount: 8,
        newMessageCount: 3,
        estimatedBefore: 900,
        estimatedAfter: 100,
        reducedBy: 800,
      })),
    };
    const input = {
      line: "/compact 2",
      service,
      activeSessionId: "s01",
      model: "test-model",
      setModel: async () => false,
      composer: new CliComposerStore(),
    };
    const result = await handleTerminalTuiCommand(input);
    expect(service.compactSession).toHaveBeenCalledWith("s01", 2);
    expect(result.output).toContain("new-thread");
    expect(result.output).toContain("原始历史保留");
    expect((await handleTerminalTuiCommand({ ...input, activeSessionId: null })).output).toContain(
      "创建会话",
    );
    expect(service.compactSession).toHaveBeenCalledOnce();
  });

  it.each(["hello", "!pwd"])("%s 执行异常可见且不终止终端，会话仍可继续使用", async (line) => {
    const service = createService();
    vi.mocked(service.chat).mockRejectedValueOnce(new Error("model connection lost"));
    vi.mocked(service.runToolByName!).mockRejectedValueOnce(new Error("shell connection lost"));
    const input = {
      service,
      activeSessionId: "s01",
      model: "test-model",
      setModel: async () => false,
      composer: new CliComposerStore(),
    };
    const result = await handleTerminalTuiCommand({ ...input, line });
    expect(result).toMatchObject({ activeSessionId: "s01", exit: false });
    expect(result.output).toContain("connection lost");
    expect((await handleTerminalTuiCommand({ ...input, line })).output).toContain(
      line === "hello" ? "reply:hello" : "ran:pwd",
    );
  });

  it("awaits async session creation for daemon-backed TUI services", async () => {
    const service = createService();
    const result = await handleTerminalTuiCommand({
      line: "/new",
      service: {
        ...service,
        createSession: vi.fn(async () => service.createSession()),
      },
      activeSessionId: "s01",
      model: "daemon-host",
      setModel: async () => false,
      composer: new CliComposerStore(),
    });

    expect(result.activeSessionId).toBe("s02");
    expect(result.output).toContain("started fresh session s02");
  });

  it("handles session and tool commands", async () => {
    const service = createService();
    const created = await handleTerminalTuiCommand({
      line: "/new",
      service,
      activeSessionId: null,
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
    });
    const sessions = await handleTerminalTuiCommand({
      line: "/sessions",
      service,
      activeSessionId: created.activeSessionId,
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
    });
    const tools = await handleTerminalTuiCommand({
      line: "/tools",
      service,
      activeSessionId: created.activeSessionId,
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
    });

    expect(created).toMatchObject({ activeSessionId: "s02", output: "started fresh session s02" });
    expect(sessions.output).toContain("* [2]");
    expect(sessions.output).toContain("s02");
    expect(tools.output).toContain("Tools");
    expect(tools.output).toContain("read_file [base] Read");
  });

  it("supports sequential and selector-based session navigation in the TUI", async () => {
    const service = createService();
    const composer = new CliComposerStore();
    const second = await handleTerminalTuiCommand({
      line: "/new",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });
    const third = await handleTerminalTuiCommand({
      line: "/new",
      service,
      activeSessionId: second.activeSessionId,
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });
    const useLatest = await handleTerminalTuiCommand({
      line: "/use latest",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });
    const next = await handleTerminalTuiCommand({
      line: "/next",
      service,
      activeSessionId: "s02",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });
    const prev = await handleTerminalTuiCommand({
      line: "/prev",
      service,
      activeSessionId: "s02",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });
    const usePrefix = await handleTerminalTuiCommand({
      line: "/use s03",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });

    expect(third.activeSessionId).toBe("s03");
    expect(useLatest).toMatchObject({ activeSessionId: "s03" });
    expect(next).toMatchObject({ activeSessionId: "s03" });
    expect(prev).toMatchObject({ activeSessionId: "s01" });
    expect(usePrefix).toMatchObject({ activeSessionId: "s03" });
    expect(useLatest.output).toContain("[3/3]");
  });

  it("supports transcript browse commands in the TUI", async () => {
    const service = createService();
    const transcriptBrowser = new CliTranscriptBrowserStore(2);

    const history = await handleTerminalTuiCommand({
      line: "/history",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
      transcriptBrowser,
    });
    const prev = await handleTerminalTuiCommand({
      line: "/history prev",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
      transcriptBrowser,
    });
    const search = await handleTerminalTuiCommand({
      line: "/search hook",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
      transcriptBrowser,
    });
    const peek = await handleTerminalTuiCommand({
      line: "/peek 4",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
      transcriptBrowser,
    });
    const peekPrev = await handleTerminalTuiCommand({
      line: "/peek prev",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
      transcriptBrowser,
    });

    expect(history.output).toContain("window");
    expect(prev.output).toContain("#02");
    expect(search.output).toContain("query     hook");
    expect(peek.output).toContain("entry     #04 assistant");
    expect(peekPrev.output).toContain("entry     #03 user");
  });

  it("supports workflow commands in the TUI", async () => {
    const service = createService();
    const result = await handleTerminalTuiCommand({
      line: "/workflow draw",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      workflow: "agent",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
    });

    expect(result.workflow).toBe("draw");
    expect(result.output).toContain("workflow set to draw");
  });

  it("supports palette commands in the TUI", async () => {
    const service = createService();
    const paletteStore = new CliPaletteStore();

    const palette = await handleTerminalTuiCommand({
      line: "/palette s01",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
      paletteStore,
    });
    const open = await handleTerminalTuiCommand({
      line: "/palette open 1",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
      paletteStore,
    });

    expect(palette.output).toContain("Palette");
    expect(palette.output).toContain("/use 1");
    expect(open.output).toContain("palette [1] -> /use 1");
    expect(open.output).toContain("using session [1/1] s01");
  });

  it("supports approval commands in the TUI", async () => {
    const service = createService();
    const approvals = await handleTerminalTuiCommand({
      line: "/approvals",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
    });
    const approve = await handleTerminalTuiCommand({
      line: "/approve apr_1",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
    });

    expect(approvals.output).toContain("Approvals");
    expect(approve.output).toContain("approved apr_1");
  });

  it("routes plain input through chat using the active session", async () => {
    const service = createService();
    const result = await handleTerminalTuiCommand({
      line: "hello",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
    });

    expect(service.chat).toHaveBeenCalledWith({ session_id: "s01", message: "hello" });
    expect(result).toMatchObject({ activeSessionId: "s01", exit: false });
    expect(result.output).toContain("Assistant");
    expect(result.output).toContain("reply:hello");
  });

  it("supports direct shell shortcuts in the TUI", async () => {
    const service = createService();
    const result = await handleTerminalTuiCommand({
      line: "!pwd",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer: new CliComposerStore(),
    });

    expect(result.output).toContain("Shell");
    expect(result.output).toContain("ran:pwd");
  });

  it("supports composer flow in the TUI", async () => {
    const service = createService();
    const composer = new CliComposerStore();
    const start = await handleTerminalTuiCommand({
      line: "/compose",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });
    const append = await handleTerminalTuiCommand({
      line: "first line",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });
    const send = await handleTerminalTuiCommand({
      line: "/send",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });

    expect(start.output).toContain("composer started");
    expect(append.output).toContain("draft updated");
    expect(service.chat).toHaveBeenCalledWith({ session_id: "s01", message: "first line" });
    expect(send.output).toContain("submitting draft");
    expect(send.output).toContain("reply:first line");
  });

  it("preserves blank lines and supports /pop in the TUI composer", async () => {
    const service = createService();
    const composer = new CliComposerStore();
    await handleTerminalTuiCommand({
      line: "/compose",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });
    await handleTerminalTuiCommand({
      line: "first line",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });
    await handleTerminalTuiCommand({
      line: "",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });
    const preview = await handleTerminalTuiCommand({
      line: "/preview",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });
    const pop = await handleTerminalTuiCommand({
      line: "/pop",
      service,
      activeSessionId: "s01",
      model: "gpt-test",
      setModel: vi.fn(async () => true),
      composer,
    });

    expect(preview.output).toContain("01| first line");
    expect(preview.output).toContain("02|");
    expect(pop.output).toContain("removed 1 line(s)");
  });
});
