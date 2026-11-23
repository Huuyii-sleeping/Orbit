import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import "reflect-metadata";
import { AppModule, type AppModuleOptions } from "./app.module.js";
import { applyHeaderSetters } from "./http/http-utils.js";
import { resolveAgentServiceToken } from "@orbit/service-auth";
import { createIdentityHttp } from "./identity/identity-http.js";
import { resolveIdentityConfig, type IdentityOptions } from "./identity/identity-config.js";

export type BffServerOptions = AppModuleOptions & IdentityOptions;

/** Create the Web BFF HTTP server backed by the Nest application. */
export async function createBffHttpServer(options: BffServerOptions): Promise<Server> {
  const identityConfig = resolveIdentityConfig(options);
  if (identityConfig.mode === "saas") resolveAgentServiceToken(options);
  const saas = identityConfig.mode === "saas" ? createIdentityHttp(identityConfig) : undefined;
  try {
    const app = await NestFactory.create(AppModule.register({ ...options, requireTenantContext: !!saas }), { logger: ["error"] });
    if (saas) {
      app.use(saas.headers);
      app.use(saas.oidc);
      app.use(saas.boundary);
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
    await app.init();
    if (saas) app.use(saas.errorHandler);
    const server = app.getHttpServer() as Server;
    server.once("close", () => {
      void app.close().catch((error: unknown) => console.error("BFF shutdown failed", error)).finally(() => saas?.store.close());
    });
    return server;
  } catch (error) {
    saas?.store.close();
    throw error;
  }
}
