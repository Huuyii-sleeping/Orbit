import { describe, expect, it } from "vitest";
import { selectAgentRows } from "./agent-list";
import { defaultAgentProfileInput, type AgentProfile } from "../../../api/index";

const agents: AgentProfile[] = [
  { ...defaultAgentProfileInput, id: "research", name: "行业研究", description: "交叉检查资料", scenario: "研究", createdAt: 1, updatedAt: 10, skills: [{ skillId: "web-search", version: "1", sourceType: "builtin", registrySource: "local" }] },
  { ...defaultAgentProfileInput, skills: [], skillIds: [], id: "editor", name: "内容编辑", description: "检查文字", scenario: "写作", createdAt: 2, updatedAt: 20 },
];

describe("Agent 紧凑列表", () => {
  it("搜索覆盖名称、职责、场景和绑定技能，忽略大小写及两端空格", () => {
    expect(selectAgentRows(agents, " WEB-SEARCH ", "all", "updated").map((a) => a.id)).toEqual(["research"]);
    expect(selectAgentRows(agents, "写作", "all", "updated").map((a) => a.id)).toEqual(["editor"]);
    expect(selectAgentRows(agents, "不存在", "all", "updated")).toEqual([]);
  });
  it("按真实技能绑定筛选并按更新时间排序，保留原数组", () => {
    expect(selectAgentRows(agents, "", "unbound", "updated").map((a) => a.id)).toEqual(["editor"]);
    expect(selectAgentRows(agents, "", "bound", "updated").map((a) => a.id)).toEqual(["research"]);
    expect(selectAgentRows(agents, "", "all", "updated").map((a) => a.id)).toEqual(["editor", "research"]);
    expect(agents.map((a) => a.id)).toEqual(["research", "editor"]);
  });
});
