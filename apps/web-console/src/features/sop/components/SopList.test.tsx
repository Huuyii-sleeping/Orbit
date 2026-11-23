import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SopList } from "./SopList";
import { appendSopNode, createSopDraft } from "../lib/sop-store";

const state = vi.hoisted(() => ({ filter: "all" }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: () => [state.filter, vi.fn()],
}));

const drafts = [
  appendSopNode(createSopDraft("Agent 流程"), "agent", { x: 0, y: 200 }),
  appendSopNode(createSopDraft("LLM 流程"), "llm", { x: 0, y: 200 }),
  createSopDraft("普通流程"),
];

function render() {
  return renderToStaticMarkup(<SopList drafts={drafts} query="" onEdit={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} />);
}

beforeEach(() => { state.filter = "all"; });

describe("工作流 AI 节点筛选", () => {
  it("统计 Agent 和 LLM 流程，并在卡片上显示 AI 节点数量", () => {
    const html = render();
    expect(html).toContain('含 AI 节点<span class="c">2</span>');
    expect(html.match(/class="chip">1 AI/g)).toHaveLength(2);
  });

  it("筛选时同时保留 Agent 和 LLM 流程", () => {
    state.filter = "ai";
    const html = render();
    expect(html).toContain("Agent 流程");
    expect(html).toContain("LLM 流程");
    expect(html).not.toContain("普通流程");
  });
});
