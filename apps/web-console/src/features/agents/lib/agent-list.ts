import type { AgentProfile } from "../../../api";

/** 按技能绑定过滤 Agent；状态只表达接口实际提供的草稿信息。 */
export type AgentListFilter = "all" | "bound" | "unbound";
/** Agent 列表支持的稳定排序。 */
export type AgentListSort = "updated" | "name";

/** 搜索并排序 Agent，不改变领域状态中的原始顺序。 */
export function selectAgentRows(agents: AgentProfile[], query: string, filter: AgentListFilter, sort: AgentListSort) {
  const keyword = query.trim().toLocaleLowerCase();
  return agents.filter((agent) => {
    if (filter === "bound" && !agent.skills.length) return false;
    if (filter === "unbound" && agent.skills.length) return false;
    return !keyword || [agent.name, agent.description, agent.scenario, ...agent.skills.map((skill) => skill.skillId)]
      .join(" ").toLocaleLowerCase().includes(keyword);
  }).sort((a, b) => sort === "name"
    ? a.name.localeCompare(b.name, "zh-CN")
    : (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id));
}
