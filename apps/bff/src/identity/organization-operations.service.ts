import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SopDatabase } from "../storage/sop-database.js";
import { requireTenantContext, type TenantContext } from "./tenant-context.js";
import { OrganizationAuthorizationError, requireOrganizationPermission, type OrganizationPermission } from "./organization-authorization.js";

/** 审计仅记录控制元数据，不接受运行输入、审批正文或凭据。 */
export interface OrganizationOperationDetail {
  interruptId?: string;
  idempotencyKeyHash?: string;
  decision?: "approve" | "reject";
  mutation?: "draft.create" | "draft.save" | "draft.delete" | "draft.import" | "draft.from-version" | "draft.from-template" | "template.save" | "template.delete";
}

type OperationResource = { type: "workflow" | "run" | "template"; id: string };

/** 业务层权限入口与持久化操作审计；本地模式由数据库装配显式决定。 */
@Injectable()
export class OrganizationOperationsService {
  constructor(@Inject(SopDatabase) private readonly storage: SopDatabase) {}

  /** SaaS 必须具备完整可信授权上下文；缺失上下文不能降级成本地访问。 */
  require(permission: OrganizationPermission): Readonly<TenantContext> | undefined {
    if (!this.storage.isTenantScoped) return undefined;
    requireOrganizationPermission(permission);
    return requireTenantContext();
  }

  /** 整库维护不属于任何组织管理员权限。 */
  requireLocalMaintenance(): void {
    if (this.storage.isTenantScoped) throw new OrganizationAuthorizationError();
  }

  /** 先持久化请求意图，再执行外部副作用；结果未知的请求保留为 requested。 */
  async perform<T>(permission: OrganizationPermission, resource: OperationResource,
    operation: (actor: Readonly<TenantContext> | undefined) => Promise<T>, detail: OrganizationOperationDetail = {}): Promise<T> {
    const actor = this.require(permission);
    if (!actor) return operation(undefined);
    const operationId = randomUUID();
    const append = (phase: "requested" | "succeeded" | "failed", errorCode?: string) => this.append(actor, permission, resource, operationId, phase, detail, errorCode);
    append("requested");
    let result: T;
    try { result = await operation(actor); }
    catch (error) {
      // 上游超时可能已经执行，failed 只表示本次请求没有确认成功，不宣称副作用已回滚。
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : "OPERATION_FAILED";
      append("failed", code);
      throw error;
    }
    append("succeeded");
    return result;
  }

  /** 本地 SQLite 业务写入与成功审计同事务；结果审计失败时回滚业务写入。 */
  mutate<T>(resource: OperationResource, mutation: NonNullable<OrganizationOperationDetail["mutation"]>, operation: () => T): T {
    const actor = this.require("workflow.edit");
    if (!actor) return operation();
    const operationId = randomUUID();
    const detail = { mutation };
    this.append(actor, "workflow.edit", resource, operationId, "requested", detail);
    try {
      return this.storage.database.transaction(() => {
        const result = operation();
        this.append(actor, "workflow.edit", resource, operationId, "succeeded", detail);
        return result;
      })();
    } catch (error) {
      this.append(actor, "workflow.edit", resource, operationId, "failed", detail, "MUTATION_FAILED");
      throw error;
    }
  }

  private append(actor: Readonly<TenantContext>, permission: OrganizationPermission, resource: OperationResource,
    operationId: string, phase: "requested" | "succeeded" | "failed", detail: OrganizationOperationDetail, errorCode?: string): void {
    this.storage.database.prepare(`insert into organization_audit_events
      (id, issuer, tenant_id, operation_id, subject, action, resource_type, resource_id, phase, detail_json, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), actor.issuer, actor.tenantId, operationId, actor.subject, permission,
        resource.type, resource.id, phase, JSON.stringify({ ...detail, ...(errorCode ? { errorCode } : {}) }), Date.now());
  }
}
