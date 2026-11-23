/** 工具展示名只描述用途，权限仍按 Runtime 返回的真实工具 ID 逐项保存。 */
export const agentToolLabels: Record<string, string> = {
  read_file: "读取文件", write_file: "写入文件", edit_file: "编辑文件",
  bash: "执行命令", background_run: "后台执行命令", check_background: "查看后台任务",
  memory_add: "写入记忆", memory_list: "查看记忆", memory_search: "搜索记忆",
  memory_doctor: "检查记忆状态", memory_explain: "查看记忆匹配",
  list_skills: "查看技能", load_skill: "加载技能", todo: "管理待办",
};

/** 普通能力与内部管理工具分开展示，不自动扩大工具授权。 */
export function agentToolGroup(id: string) {
  if (["read_file", "write_file", "edit_file"].includes(id)) return "文件";
  if (["bash", "background_run", "check_background"].includes(id)) return "命令";
  if (id.startsWith("memory_")) return "记忆";
  if (["list_skills", "load_skill", "todo"].includes(id)) return "技能与任务";
  return "高级工具";
}
