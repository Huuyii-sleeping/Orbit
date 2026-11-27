import { Module, type DynamicModule } from "@nestjs/common";
import { OrganizationOperationsService } from "./organization-operations.service.js";

/** 组织业务授权显式依赖产品数据库，复用同一连接保存审计。 */
@Module({})
export class OrganizationAuthorizationModule {
  static register(database: DynamicModule): DynamicModule {
    return { module: OrganizationAuthorizationModule, imports: [database], providers: [OrganizationOperationsService], exports: [OrganizationOperationsService] };
  }
}
