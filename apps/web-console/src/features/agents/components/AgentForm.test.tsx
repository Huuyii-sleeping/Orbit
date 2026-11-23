import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultAgentProfileInput, normalizeAgentProfile } from "../../../api/agents";
import { AgentActionLabels } from "./AgentActionLabels";
import { AgentOutputFields } from "./AgentOutputFields";
import { AgentIdentityFields } from "./AgentIdentityFields";
import { normalizeAgentConfiguration } from "@orbit/workflow-core";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
}));
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });

describe("Agent 表单交互", () => {
  it("新草稿为空，示例只通过 placeholder 展示，可选空值读取后仍为空", () => {
    expect(defaultAgentProfileInput).toMatchObject({ name: "", description: "", scenario: "", systemPrompt: "", actions: [], skills: [] });
    const html = renderToStaticMarkup(<AgentIdentityFields draft={defaultAgentProfileInput} isNewDraft onDraftChange={vi.fn()} />);
    expect(html).toContain('placeholder="例如：代码审查助手"');
    expect(html).toContain('value=""');
    expect(normalizeAgentProfile({ ...defaultAgentProfileInput, id: "a" })).toMatchObject({ description: "", scenario: "" });
  });

  it("标签回车添加时去空格，并阻止重复，删除单个标签保留其他标签", () => {
    const onChange = vi.fn();
    const render = () => { hooks.cursor = 0; return AgentActionLabels({ value: ["分析"], onChange }); };
    render().props.children[3].props.children[0].props.onChange({ target: { value: " 整理 " } });
    render().props.children[3].props.children[0].props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: false }, preventDefault: vi.fn() });
    expect(onChange).toHaveBeenLastCalledWith(["分析", "整理"]);
    onChange.mockClear();
    render().props.children[3].props.children[0].props.onChange({ target: { value: "分析" } });
    render().props.children[3].props.children[1].props.onClick();
    expect(onChange).not.toHaveBeenCalled();
    render().props.children[2].props.children[0].props.children[1].props.onClick();
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("自定义输出默认收起且保留，非法 schema 标记无效，恢复默认需显式操作", () => {
    const configuration = normalizeAgentConfiguration({ outputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } });
    const onChange = vi.fn(); const onValidityChange = vi.fn();
    const element = AgentOutputFields({ configuration, onChange, onValidityChange });
    expect(element.props.children[2].props.open).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
    const textarea = element.props.children[2].props.children[1].props.children[1];
    textarea.props.onChange({ target: { value: "[]" } });
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
    element.props.children[2].props.children[3].props.onClick();
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(onChange.mock.lastCall?.[0].outputSchema.required).toEqual(["text"]);
  });
});
