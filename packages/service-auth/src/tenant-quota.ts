/** 当前单进程部署的组织资源上限，由服务端决定，不能由请求扩大。 */
export const TENANT_WORKFLOW_QUOTAS = Object.freeze({
  unfinishedRuns: 5,
  globalUnfinishedRuns: 50,
});

/** 配额拒绝是可重试请求错误，不代表已经接受的运行失败。 */
export class TenantQuotaError extends Error {
  readonly statusCode = 429;
  readonly retryAfterSeconds = 60;
  constructor(readonly code: "WORKFLOW_CONCURRENCY_LIMIT" | "WORKFLOW_CAPACITY_LIMIT") {
    super("Workflow capacity is exhausted; finish or cancel existing runs before retrying.");
    this.name = "TenantQuotaError";
  }
}
