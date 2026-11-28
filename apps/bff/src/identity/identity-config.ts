import { dirname, join } from "node:path";

/** SaaS 身份参数；通过环境变量配置，不能使用任何浏览器提交的值。 */
export interface IdentityOptions {
  /** 测试和嵌入调用可显式指定配置；生产仍强制 SaaS 与 HTTPS。 */
  identity?: { mode: "local" } | {
    mode: "saas";
    baseURL: string;
    issuerBaseURL: string;
    jwksURL: string;
    clientID: string;
    clientSecret: string;
    sessionSecret: string;
    sessionStorePath?: string;
    /** 受限 Workflow 入口显式启用；默认关闭，部署方须先完成 IdP 验收。 */
    workflowAccess?: "disabled" | "restricted";
  };
  filePath?: string;
}

/** 经校验的身份配置。 */
export type IdentityConfig = { mode: "local" } | {
  mode: "saas";
  baseURL: string;
  issuerBaseURL: string;
  jwksURL: string;
  clientID: string;
  clientSecret: string;
  sessionSecret: string;
  sessionStorePath: string;
  workflowAccess: "disabled" | "restricted";
};

/** 在创建数据库和目录前解析配置；配置错误不包含原值，避免泄漏秘密。 */
export function resolveIdentityConfig(options: IdentityOptions = {}, env: NodeJS.ProcessEnv = process.env): IdentityConfig {
  const production = env.NODE_ENV === "production";
  const mode = options.identity?.mode ?? env.BFF_MODE ?? (production ? "saas" : "local");
  if (mode !== "saas" && mode !== "local") throw new Error("BFF_MODE must be local or saas");
  if (mode === "local") {
    if (production) throw new Error("BFF_MODE local is forbidden in production");
    return { mode };
  }
  const explicit = options.identity?.mode === "saas" ? options.identity : undefined;
  const baseURL = checkedURL(explicit?.baseURL ?? env.OIDC_BASE_URL, "OIDC_BASE_URL", production, true);
  const issuerBaseURL = checkedURL(explicit?.issuerBaseURL ?? env.OIDC_ISSUER_URL, "OIDC_ISSUER_URL", production, false);
  const jwksURL = checkedURL(explicit?.jwksURL ?? env.OIDC_JWKS_URL, "OIDC_JWKS_URL", production, false);
  if (new URL(jwksURL).origin !== new URL(issuerBaseURL).origin) throw new Error("OIDC_JWKS_URL must share the issuer origin");
  const clientID = explicit?.clientID ?? env.OIDC_CLIENT_ID;
  const clientSecret = explicit?.clientSecret ?? env.OIDC_CLIENT_SECRET;
  const sessionSecret = explicit?.sessionSecret ?? env.BFF_SESSION_SECRET;
  if (!clientID?.trim() || clientID.length > 512) throw new Error("OIDC_CLIENT_ID is required and must be at most 512 characters");
  if (!clientSecret?.trim()) throw new Error("OIDC_CLIENT_SECRET is required");
  if (!sessionSecret || !/^[a-fA-F0-9]{64}$/.test(sessionSecret)) throw new Error("BFF_SESSION_SECRET must be 32 random bytes encoded as 64 hex characters");
  const workflowAccess = explicit?.workflowAccess ?? env.BFF_SAAS_WORKFLOW_ACCESS ?? "disabled";
  if (workflowAccess !== "disabled" && workflowAccess !== "restricted") throw new Error("BFF_SAAS_WORKFLOW_ACCESS must be disabled or restricted");
  return {
    mode, baseURL, issuerBaseURL, jwksURL, clientID, clientSecret, sessionSecret, workflowAccess,
    sessionStorePath: explicit?.sessionStorePath ?? env.BFF_SESSION_STORE_PATH ?? join(options.filePath ? dirname(options.filePath) : join(process.cwd(), ".data"), ".sessions", "bff-sessions.sqlite"),
  };
}

function checkedURL(raw: string | undefined, key: string, production: boolean, originOnly: boolean) {
  try {
    if (!raw) throw new Error();
    const url = new URL(raw);
    const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && !production)) throw new Error();
    if (url.username || url.password || url.search || url.hash) throw new Error();
    if (originOnly && url.pathname !== "/") throw new Error();
    return originOnly ? url.origin : url.href.replace(/\/$/, "");
  } catch {
    throw new Error(`${key} must be a valid ${originOnly ? "origin" : "issuer URL"} using HTTPS (non-production loopback HTTP is allowed)`);
  }
}
