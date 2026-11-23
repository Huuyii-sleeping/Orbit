import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultAgentProfileInput } from "../../../api/agents";
import { AgentEditor } from "./AgentEditor";

vi.mock("./AgentWorkbench", () => ({
  AgentWorkbench: () => <div>运行工作区</div>,
}));

describe("Agent 配置层级", () => {
  it("配置、试跑、版本分开呈现，新草稿默认只打开配置", () => {
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <AgentEditor
        draft={defaultAgentProfileInput}
        activeAgent={null}
        isNewDraft
        error={null}
        saving={false}
        installedSkills={[]}
        skillPreflight={null}
        skillPreflightLoading={false}
        onDraftChange={noop}
        onResolveAgentSkills={noop}
        onSaveAgent={noop}
        onDiscardDraft={noop}
        onDeleteAgent={noop}
        onRefresh={noop}
        onBack={noop}
        onTestStatus={noop}
      />,
    );
    expect(html).toContain('aria-label="Agent 工作区"');
    expect(html).toContain('aria-controls="agent-panel-config"');
    expect(html).toContain('id="agent-panel-test"');
    expect(html).toContain('id="agent-panel-versions"');
    for (const title of ["基本信息", "职责", "模型", "能力", "展示设置"])
      expect(html).toContain(title);
    expect(html).not.toContain(">试跑与版本</button>");
    expect(html).toMatch(/id="agent-panel-test"[^>]*hidden/);
  });
});
