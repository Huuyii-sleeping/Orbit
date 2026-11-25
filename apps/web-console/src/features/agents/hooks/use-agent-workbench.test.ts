import { afterEach, expect, it, vi } from "vitest";
import type { AgentTestRun } from "../../../api/index";
import { useAgentWorkbench } from "./use-agent-workbench";

const harness = vi.hoisted(() => ({
  values: [] as unknown[], refs: [] as any[], effects: [] as Array<() => unknown>, cursor: 0, refCursor: 0,
  api: { fetchAgentVersions: vi.fn(), fetchAgentTests: vi.fn(), fetchWorkflowRun: vi.fn(), createWorkflowRunEventStream: vi.fn(), cancelWorkflowRun: vi.fn() },
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.values)) harness.values[index] = initial;
    return [harness.values[index], (next: any) => { harness.values[index] = typeof next === "function" ? next(harness.values[index]) : next; }];
  },
  useRef: (initial: unknown) => harness.refs[harness.refCursor++] ??= { current: initial },
  useEffect: (effect: () => unknown) => { harness.effects.push(effect); },
}));
vi.mock("../../../api/index", () => harness.api);
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it("取消后晚到的 SSE 和取消前发出的查询不能将试跑恢复为运行中", async () => {
  vi.useFakeTimers();
  harness.values = []; harness.refs = [];
  const item = {
    configuration: { label: "v1" },
    run: { id: "qa-run", workflowId: "qa", status: "running", mode: "draft", createdAt: 1, inputs: {}, nodeRuns: {} },
  } as AgentTestRun;
  const cancelled = { ...item.run, status: "cancelled" as const, finishedAt: 20 };
  harness.api.fetchAgentVersions.mockResolvedValue([]);
  harness.api.fetchAgentTests.mockResolvedValue([item]);
  harness.api.cancelWorkflowRun.mockResolvedValue(cancelled);
  let resolveQuery!: (value: typeof item.run) => void;
  harness.api.fetchWorkflowRun.mockReturnValue(new Promise((resolve) => { resolveQuery = resolve; }));
  harness.api.createWorkflowRunEventStream.mockReturnValue({ close: vi.fn() });
  const onStatus = vi.fn();
  function render() {
    harness.cursor = 0; harness.refCursor = 0; harness.effects = [];
    return useAgentWorkbench("qa", onStatus);
  }
  render();
  harness.effects[0]!();
  await vi.waitFor(() => expect(harness.api.fetchAgentTests).toHaveBeenCalled());
  await Promise.resolve();
  render();
  const cleanup = harness.effects[1]!() as () => void;
  try {
    await render().cancel();
    onStatus.mockClear();
    const handlers = harness.api.createWorkflowRunEventStream.mock.calls[0]![0];
    handlers.onEvent({ type: "run.status", runId: item.run.id, id: 1, at: 5, status: "running" });
    resolveQuery(item.run);
    await Promise.resolve();
    const result = render();
    expect(result.current?.run.status).toBe("cancelled");
    expect(result.running).toBe(false);
    expect(onStatus).not.toHaveBeenCalledWith("running");
  } finally { cleanup(); }
});
