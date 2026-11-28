import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { WORKFLOW_PAYLOAD_LIMITS } from "@orbit/workflow-core";
import type { Server } from "node:http";
import "reflect-metadata";
import type { Express } from "express";
import { AppModule, type AppModuleOptions } from "./app.module.js";
import { applyHeaderSetters, writeJson, markSaasResponse } from "./http/http-utils.js";
import { requestBodyError } from "./http/request-body-error.js";
import { resolveAgentServiceToken } from "@orbit/service-auth";
import { createTenantHttpLimits } from "@orbit/service-auth/http";
import { createIdentityHttp } from "./identity/identity-http.js";
import { resolveIdentityConfig, type IdentityOptions } from "./identity/identity-config.js";
import type { BrowserIdentityConfiguration } from "@orbit/runtime-contracts";

export type BffServerOptions = AppModuleOptions & IdentityOptions;

/** Create the Web BFF HTTP server backed by the Nest application. */
export async function createBffHttpServer(options: BffServerOptions): Promise<Server> {
  const identityConfig = resolveIdentityConfig(options);
  if (identityConfig.mode === "saas") resolveAgentServiceToken(options);
  const saas = identityConfig.mode === "saas" ? createIdentityHttp(identityConfig) : undefined;
  const traffic = saas ? createTenantHttpLimits() : undefined;
  try {
    const app = await NestFactory.create<NestExpressApplication>(AppModule.register({ ...options, requireTenantContext: !!saas }), { logger: ["error"] });
    // 公开最小能力，让 Web 在装配业务模块前决定登录与受限入口；不泄露 IdP 配置。
    const expressApp: Express = app.getHttpAdapter().getInstance();
    expressApp.get("/api/auth/config", (_req, res) => {
      if (saas) markSaasResponse(res);
      const config: BrowserIdentityConfiguration = { mode: identityConfig.mode,
        workflowAccess: identityConfig.mode === "saas" ? identityConfig.workflowAccess : "disabled" };
      writeJson(res, 200, { ok: true, ...config });
    });
    if (saas) {
      app.use(saas.headers);
      app.use(saas.oidc);
      app.use(saas.boundary);
      app.use(traffic!.middleware);
    } else {
      app.use((_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
        applyHeaderSetters(res);
        next();
      });
      app.enableCors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Last-Event-ID"],
      });
    }
    // 使用框架解析器限制实际流入的字节数，覆盖 chunked 请求；不接受压缩请求体。
    app.useBodyParser("json", { limit: WORKFLOW_PAYLOAD_LIMITS.commandBytes, inflate: false });
    app.use(requestBodyError);
    await app.init();
    if (saas) app.use(saas.errorHandler);
    const server = app.getHttpServer() as Server;
    server.once("close", () => {
      void app.close().catch((error: unknown) => console.error("BFF shutdown failed", error)).finally(() => { saas?.store.close(); traffic?.close(); });
    });
    return server;
  } catch (error) {
    saas?.store.close();
    traffic?.close();
    throw error;
  }
}
