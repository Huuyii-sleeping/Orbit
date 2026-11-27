/** BFF 和 Runtime 共用已验证身份的异步上下文，浏览器参数不得建立此上下文。 */
export { runWithServiceTenant as runWithTenant, requireServiceTenant as requireTenantContext } from "@orbit/service-auth";
export type { ServiceTenantIdentity as TenantContext } from "@orbit/service-auth";
