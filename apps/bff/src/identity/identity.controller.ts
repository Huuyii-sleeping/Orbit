import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { errorPayload, writeJson } from "../http/http-utils.js";
import type { VerifiedIdentity } from "./organization-claims.js";
import { organizationAccess } from "./organization-authorization.js";

type AuthenticatedRequest = Request & { orbit_session?: { orbitIdentity?: VerifiedIdentity } };

/** 已验证会话的最小身份接口；所有方法都经过 SaaS 边界中间件。 */
@Controller("/api/auth")
export class IdentityController {
  @Get("session")
  session(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const identity = req.orbit_session?.orbitIdentity;
    if (!identity) throw new Error("Authenticated identity is required");
    writeJson(res, 200, { ok: true, user: { subject: identity.subject }, tenantId: identity.selectedTenantId,
      organizations: identity.organizations, ...organizationAccess(identity) });
  }

  @Get("tenants")
  tenants(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const identity = req.orbit_session?.orbitIdentity;
    if (!identity) throw new Error("Authenticated identity is required");
    writeJson(res, 200, { ok: true, organizations: identity.organizations });
  }

  @Post("tenant")
  selectTenant(@Req() req: AuthenticatedRequest, @Body() body: unknown, @Res() res: Response) {
    const id = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).tenantId : undefined;
    const identity = req.orbit_session?.orbitIdentity;
    if (!identity) throw new Error("Authenticated identity is required");
    if (typeof id !== "string" || !identity.organizations.some((organization) => organization.id === id)) {
      writeJson(res, 403, errorPayload("TENANT_FORBIDDEN", "Tenant membership is required"));
      return;
    }
    const selected = { ...identity, selectedTenantId: id, selectedAt: Date.now() };
    req.orbit_session!.orbitIdentity = selected;
    writeJson(res, 200, { ok: true, tenantId: id, ...organizationAccess(selected) });
  }

  @Post("logout")
  logout(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    req.orbit_session = undefined;
    writeJson(res, 200, { ok: true });
  }
}
