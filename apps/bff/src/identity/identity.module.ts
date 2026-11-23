import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller.js";

/** SaaS 会话和租户选择接口模块。 */
@Module({ controllers: [IdentityController] })
export class IdentityModule {}
