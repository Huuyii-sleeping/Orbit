import { describe, expect, it } from "vitest";
import { resolveIdentityConfig } from "../../../src/identity/identity-config.js";

const env = {
  BFF_MODE: "saas", OIDC_BASE_URL: "https://orbit.example.com", OIDC_ISSUER_URL: "https://id.example.com/realms/orbit", OIDC_JWKS_URL: "https://id.example.com/realms/orbit/protocol/openid-connect/certs",
  OIDC_CLIENT_ID: "orbit-web", OIDC_CLIENT_SECRET: "provider-client-secret", BFF_SESSION_SECRET: "a1".repeat(32),
};

describe("identity configuration", () => {
  it("defaults to local only outside production and requires production identity", () => {
    expect(resolveIdentityConfig({}, {})).toEqual({ mode: "local" });
    expect(() => resolveIdentityConfig({}, { NODE_ENV: "production" })).toThrow(/OIDC_BASE_URL/);
    expect(() => resolveIdentityConfig({}, { NODE_ENV: "production", BFF_MODE: "local" })).toThrow(/local/);
    expect(() => resolveIdentityConfig({}, { BFF_MODE: "saaa" })).toThrow(/BFF_MODE/);
  });

  it("requires strong dedicated secret and HTTPS without leaking invalid values", () => {
    expect(resolveIdentityConfig({}, { ...env, NODE_ENV: "production" })).toMatchObject({ mode: "saas", baseURL: env.OIDC_BASE_URL });
    for (const [key, value] of Object.entries({
      OIDC_BASE_URL: "https://secret-user:secret-pass@app.example.com/",
      OIDC_ISSUER_URL: "http://remote.example.com/realms/orbit",
      BFF_SESSION_SECRET: "weak-secret-private",
    })) {
      try { resolveIdentityConfig({}, { ...env, [key]: value }); throw new Error("expected failure"); }
      catch (error) { expect(String(error)).toContain(key); expect(String(error)).not.toContain(value); }
    }
  });

  it("permits HTTP only for non-production loopback and rejects URL suffix tricks", () => {
    expect(resolveIdentityConfig({}, { ...env, OIDC_BASE_URL: "http://127.0.0.1:3182", OIDC_ISSUER_URL: "http://localhost:8080/realm", OIDC_JWKS_URL: "http://localhost:8080/jwks" })).toMatchObject({ mode: "saas" });
    for (const value of ["https://orbit.example.com/path", "https://orbit.example.com/?x=y", "https://orbit.example.com/#fragment", "http://localhost.evil.test"]) {
      expect(() => resolveIdentityConfig({}, { ...env, OIDC_BASE_URL: value })).toThrow(/OIDC_BASE_URL/);
    }
    expect(() => resolveIdentityConfig({}, { ...env, NODE_ENV: "production", OIDC_BASE_URL: "http://127.0.0.1:3182" })).toThrow();
    expect(() => resolveIdentityConfig({}, { ...env, OIDC_JWKS_URL: "https://other.example.com/jwks" })).toThrow(/OIDC_JWKS_URL/);
  });

  it("Workflow 业务入口默认关闭，仅接受明确的受限开放配置", () => {
    expect(resolveIdentityConfig({}, env)).toMatchObject({ workflowAccess: "disabled" });
    expect(resolveIdentityConfig({}, { ...env, BFF_SAAS_WORKFLOW_ACCESS: "restricted" })).toMatchObject({ workflowAccess: "restricted" });
    expect(() => resolveIdentityConfig({}, { ...env, BFF_SAAS_WORKFLOW_ACCESS: "all" })).toThrow("BFF_SAAS_WORKFLOW_ACCESS");
    expect(resolveIdentityConfig({ identity: {
      mode: "saas", baseURL: env.OIDC_BASE_URL, issuerBaseURL: env.OIDC_ISSUER_URL, jwksURL: env.OIDC_JWKS_URL,
      clientID: env.OIDC_CLIENT_ID, clientSecret: env.OIDC_CLIENT_SECRET, sessionSecret: env.BFF_SESSION_SECRET, workflowAccess: "disabled",
    } }, { ...env, BFF_SAAS_WORKFLOW_ACCESS: "restricted" })).toMatchObject({ workflowAccess: "disabled" });
  });
});
