import { auth } from "express-openid-connect";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { NextFunction, Request, Response } from "express";
import { errorPayload, markSaasResponse, writeJson } from "../http/http-utils.js";
import type { IdentityConfig } from "./identity-config.js";
import { verifiedIdentityFromClaims, type VerifiedIdentity } from "./organization-claims.js";
import { SqliteSessionStore } from "./sqlite-session-store.js";
import { runWithOrganizationAuthorization } from "./organization-authorization.js";

type AuthenticatedRequest = Request & { orbit_session: { orbitIdentity?: VerifiedIdentity } };

const allowed = new Set([
  "GET /api/auth/session", "GET /api/auth/tenants", "POST /api/auth/tenant", "POST /api/auth/logout",
  "GET /api/profile", "PUT /api/profile", "GET /api/settings", "PATCH /api/settings",
]);
const changes = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** OIDC SDK 只处理协议与会话；此处执行 Orbit 自身的同源和租户授权边界。 */
export function createIdentityHttp(config: Extract<IdentityConfig, { mode: "saas" }>) {
  const store = new SqliteSessionStore(config.sessionStorePath);
  const jwks = createRemoteJWKSet(new URL(config.jwksURL), { timeoutDuration: 5_000, cooldownDuration: 30_000 });
  const oidc = auth({
    issuerBaseURL: config.issuerBaseURL,
    baseURL: config.baseURL,
    clientID: config.clientID,
    clientSecret: config.clientSecret,
    secret: config.sessionSecret,
    authRequired: false,
    authorizationParams: { response_type: "code", scope: "openid profile email organization:*" },
    routes: { login: "/auth/login", logout: false, callback: "/auth/callback", backchannelLogout: "/auth/backchannel-logout" },
    session: {
      name: "orbit_session", store, rolling: false, absoluteDuration: 300,
      signSessionStoreCookie: true,
      cookie: { httpOnly: true, sameSite: "Lax", secure: config.baseURL.startsWith("https:") },
    },
    backchannelLogout: {
      onLogin: false, isLoggedOut: false,
      onLogoutToken: (decodedToken) => {
        const { iss, sid, sub } = decodedToken as { iss: string; sid?: string; sub?: string };
        store.revoke(iss, sid, sub);
      },
    },
    afterCallback: async (_req, _res, session) => {
      const { payload } = await jwtVerify(session.id_token, jwks, {
        issuer: config.issuerBaseURL, audience: config.clientID, algorithms: ["RS256", "PS256", "ES256"],
      });
      session.orbitIdentity = verifiedIdentityFromClaims(payload as Record<string, unknown>);
      // 本应用不调用用户态上游 API，不需要长期保存 access/refresh token。
      session.access_token = "";
      session.refresh_token = "";
      return session;
    },
  });

  const boundary = (req: Request, res: Response, next: NextFunction) => {
    const url = new URL(req.originalUrl, config.baseURL);
    const route = `${req.method} ${url.pathname}`;
    if (route === "GET /api/healthz") {
      writeJson(res, 200, { ok: true });
      return;
    }
    const request = req as AuthenticatedRequest;
    const identity = request.orbit_session?.orbitIdentity;
    if (!req.oidc.isAuthenticated() || !identity || !identity.organizations.some((org) => org.id === identity.selectedTenantId)) {
      writeJson(res, 401, errorPayload("AUTH_REQUIRED", "Sign in is required"));
      return;
    }
    if (!allowed.has(route)) {
      writeJson(res, 403, errorPayload("SAAS_CAPABILITY_NOT_ISOLATED", "This capability is unavailable in shared SaaS mode"));
      return;
    }
    if (changes.has(req.method)) {
      if (req.headers.origin !== config.baseURL || req.headers["sec-fetch-site"] === "cross-site") {
        writeJson(res, 403, errorPayload("CROSS_ORIGIN_REQUEST", "Same-origin request is required"));
        return;
      }
      if (route !== "POST /api/auth/logout" && req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
        writeJson(res, 415, errorPayload("JSON_REQUIRED", "Content-Type application/json is required"));
        return;
      }
    }
    runWithOrganizationAuthorization(identity, next);
  };

  const headers = (_req: Request, res: Response, next: NextFunction) => {
    markSaasResponse(res);
    res.setHeader("Cache-Control", "no-store");
    next();
  };

  const errorHandler = (_error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const callback = req.path === "/auth/callback";
    writeJson(res, callback ? 401 : 500, errorPayload(callback ? "AUTH_CALLBACK_INVALID" : "INTERNAL_ERROR", callback ? "Authentication failed" : "Request failed"));
  };

  const safeOidc = (req: Request, res: Response, next: NextFunction) => oidc(req, res, (error?: unknown) => {
    if (error) {
      writeJson(res, 401, errorPayload("AUTH_CALLBACK_INVALID", "Authentication failed"));
      return;
    }
    next();
  });

  return { store, headers, oidc: safeOidc, boundary, errorHandler };
}
