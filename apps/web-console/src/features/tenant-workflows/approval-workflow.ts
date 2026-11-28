import { builtinNodeRegistry, stableSerialize, WORKFLOW_SCHEMA_VERSION, type WorkflowDraft } from "@orbit/workflow-core";
import { ORGANIZATION_WORKFLOW_APPROVAL_POLICY } from "@orbit/runtime-contracts";

/** M1 的可直接运行纯数据模板：准备文本 → 组织内独立审批 → 完成。 */
export function createOrganizationApprovalWorkflow(name: string, text: string): WorkflowDraft {
  if (!name.trim() || !text.trim()) throw new Error("填写工作流名称和待审批内容。");
  const start = builtinNodeRegistry.get("start")!;
  const content = builtinNodeRegistry.get("variable")!;
  const approval = builtinNodeRegistry.get("human-approval")!;
  const end = builtinNodeRegistry.get("end")!;
  const startConfig = start.createDefaultConfig();
  const contentConfig = { assignments: [{ key: "text", value: { kind: "literal" as const, value: text } }] };
  const approvalConfig = { ...approval.createDefaultConfig(), policyId: ORGANIZATION_WORKFLOW_APPROVAL_POLICY,
    displayFields: [{ id: "content", label: "待审批内容", value: { kind: "variable" as const, ref: { scope: "node-output" as const, nodeId: "content", portId: "text" } } }],
    decisionSchema: { type: "object" as const, properties: { comment: { type: "string" as const, title: "审批意见", maxLength: 2000 } }, required: ["comment"], additionalProperties: false },
  };
  const endConfig = end.createDefaultConfig();
  const now = Date.now();
  return { schemaVersion: WORKFLOW_SCHEMA_VERSION, id: crypto.randomUUID(), name: name.trim(), summary: "准备内容后由组织中另一位有权限的成员审批。",
    revision: 0, createdAt: now, updatedAt: now,
    nodes: [
      { kind: "builtin", id: "start", type: "start", version: start.version, label: "开始", position: { x: 0, y: 0 }, config: startConfig, ports: start.createPorts(startConfig) },
      { kind: "builtin", id: "content", type: "variable", version: content.version, label: "准备内容", position: { x: 0, y: 100 }, config: contentConfig, ports: content.createPorts(contentConfig) },
      { kind: "builtin", id: "approval", type: "human-approval", version: approval.version, label: "组织审批", position: { x: 0, y: 200 }, config: approvalConfig, ports: approval.createPorts(approvalConfig) },
      { kind: "builtin", id: "end", type: "end", version: end.version, label: "完成", position: { x: 0, y: 300 }, config: endConfig, ports: end.createPorts(endConfig) },
    ], edges: [
      { id: "start-content", source: { nodeId: "start", portId: "out" }, target: { nodeId: "content", portId: "in" } },
      { id: "content-approval", source: { nodeId: "content", portId: "text" }, target: { nodeId: "approval", portId: "in" } },
      { id: "approved-end", source: { nodeId: "approval", portId: "approved" }, target: { nodeId: "end", portId: "in" } },
      { id: "rejected-end", source: { nodeId: "approval", portId: "rejected" }, target: { nodeId: "end", portId: "in" } },
    ] };
}

/** 只识别本页的标准审批结构；其他草稿保持只读，防止误覆盖。 */
export function organizationApprovalText(draft: WorkflowDraft): string | undefined {
  const content = draft.nodes.find((node) => node.id === "content");
  if (content?.kind !== "builtin" || content.type !== "variable" || !Array.isArray(content.config.assignments) || content.config.assignments.length !== 1) return;
  const value = content.config.assignments[0]?.value;
  if (value?.kind !== "literal" || typeof value.value !== "string" || !value.value.trim() || !draft.name.trim()) return;
  // 只编辑本页创建的标准模板，避免覆盖画布或 API 创建的其他流程。
  const canonical = createOrganizationApprovalWorkflow(draft.name, value.value);
  const structure = (workflow: WorkflowDraft) => stableSerialize([workflow.nodes.map(({ position, ...node }) => node).sort((a, b) => a.id.localeCompare(b.id)), [...workflow.edges].sort((a, b) => a.id.localeCompare(b.id))]);
  return structure(draft) === structure(canonical) ? value.value : undefined;
}
