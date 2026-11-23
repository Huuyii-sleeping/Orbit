import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentView } from "./AgentView";
import { AgentEditor } from "../features/agents/components/AgentEditor";
import { AgentList } from "../features/agents/components/AgentList";
import { defaultAgentProfileInput, type AgentProfile } from "../api/index";
import type { AgentViewProps } from "../features/agents/components/agent-view-types";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));

// 保留页面状态，模拟父级在保存完成后把新建草稿替换为已保存配置。
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value;
    }];
  },
}));

const saved: AgentProfile = {
  ...defaultAgentProfileInput,
  id: "created-agent",
  name: "新建 Agent",
  createdAt: 1,
  updatedAt: 1,
};

function props(): AgentViewProps {
  return {
    active: true, agents: [], activeAgentId: null, activeAgent: null,
    draft: defaultAgentProfileInput, isNewDraft: true, error: null, saving: false,
    installedSkills: [], skillPreflight: null, skillPreflightLoading: false,
    onSelectAgent: vi.fn(), onDraftChange: vi.fn(), onResolveAgentSkills: vi.fn(),
    onSaveAgent: vi.fn().mockResolvedValue(saved), onDiscardDraft: vi.fn(),
    onDeleteAgent: vi.fn(), onNewAgent: vi.fn(), onRefresh: vi.fn(),
    query: "", onClearQuery: vi.fn(), sessions: [],
  };
}

function render(input: AgentViewProps) {
  hooks.cursor = 0;
  return AgentView(input);
}

beforeEach(() => { hooks.values = []; });

describe("Agent 列表与编辑器衔接", () => {
  it("创建成功后留在新 Agent 的编辑和试跑区，返回操作仍能回到列表", async () => {
    const input = props();
    const editor = render(input).props.children;
    expect(editor.type).toBe(AgentEditor);
    await editor.props.onSaveAgent();

    const persisted = { ...input, agents: [saved], activeAgent: saved, activeAgentId: saved.id, isNewDraft: false };
    const result = render(persisted);
    expect(result.props.children?.type).toBe(AgentEditor);
    result.props.children.props.onBack();
    expect(render(persisted).type).toBe(AgentList);
  });

  it("创建失败时保留输入和编辑器，不跳到其他 Agent", async () => {
    const input = { ...props(), onSaveAgent: vi.fn().mockResolvedValue(null) };
    await render(input).props.children.props.onSaveAgent();
    expect(render({ ...input, error: "保存失败" }).props.children.type).toBe(AgentEditor);
  });
});
