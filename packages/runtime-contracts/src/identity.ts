import type { WorkflowRunSnapshot } from "@orbit/workflow-core";

/** 浏览器只读取公开部署能力，不接收 OIDC 或内部服务凭据。 */
export interface BrowserIdentityConfiguration {
  mode: "local" | "saas";
  workflowAccess: "disabled" | "restricted";
}

/** BFF 从可信会话派生的身份快照；权限只用于界面呈现，服务端每次重新授权。 */
export interface BrowserIdentitySession {
  issuer: string;
  user: { subject: string };
  tenantId: string;
  organizations: ReadonlyArray<{ id: string; alias: string }>;
  roles: readonly string[];
  permissions: readonly string[];
}

/** 当前组织可读的运行投影，发起人来自 BFF 持久化记录。 */
export type BrowserWorkflowRun = WorkflowRunSnapshot & { initiatedBy: string | null };
/** 列表只暴露小型索引，不携带输入、输出或完整节点快照。 */
export type BrowserWorkflowRunSummary = Pick<BrowserWorkflowRun, "id" | "workflowId" | "mode" | "status" | "createdAt" | "initiatedBy">;

/** 当前受限 SaaS 支持的固定审批策略；不能作为授权凭证。 */
export const ORGANIZATION_WORKFLOW_APPROVAL_POLICY = "organization.workflow.approve";

/** 浏览器发出的身份/组织预期；服务端仍从签名会话独立授权。 */
export function browserOrganizationContext(session: Pick<BrowserIdentitySession, "issuer" | "user" | "tenantId">): string {
  return encodeURIComponent(JSON.stringify([session.issuer, session.user.subject, session.tenantId]));
}
