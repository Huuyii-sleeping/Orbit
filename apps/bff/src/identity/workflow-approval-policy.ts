import type { ApprovalPolicyResolver } from "@orbit/workflow-core";
import { ORGANIZATION_WORKFLOW_APPROVAL_POLICY } from "@orbit/runtime-contracts";

/** 组织内具备 workflow.approve 权限的非发起人审批；不是客户端可配置的成员选择器。 */
export { ORGANIZATION_WORKFLOW_APPROVAL_POLICY };

/** 发布和运行使用同一只读策略目录；实际审批仍执行组织权限、归属与自审批检查。 */
export const organizationWorkflowApprovalPolicies: ApprovalPolicyResolver = Object.freeze({
  hasPolicy: (policyId: string) => policyId === ORGANIZATION_WORKFLOW_APPROVAL_POLICY,
});
