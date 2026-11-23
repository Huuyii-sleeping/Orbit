import { readJsonBody, RegistryHttpError, writeJson, writeRequestError } from "./http/http-utils.js";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { DEFAULT_SKILL_REGISTRY_ADMIN_TOKEN } from "../config.js";
import { RegistryStore } from "../registry/registry-store.js";
import type { CreatePublisherInput, PublishSkillInput } from "../types.js";

export type SkillRegistryServerOptions = {
  dbPath: string;
  packageRoot: string;
  seedRegistryUrl?: string;
  adminToken?: string;
  /** 接收 JSON 的字节上限，默认 8 MiB。 */
  maxRequestBodyBytes?: number;
};

function baseUrl(req: IncomingMessage): string {
  const host = req.headers.host ?? "127.0.0.1:3190";
  return `http://${host}`;
}

function routePath(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://127.0.0.1");
}

function bearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function tokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdmin(req: IncomingMessage, res: ServerResponse, adminToken: string): boolean {
  const token = bearerToken(req);
  if (!token) {
    res.setHeader("WWW-Authenticate", "Bearer");
    writeJson(res, 401, { ok: false, error: { code: "ADMIN_AUTH_REQUIRED", message: "admin bearer token is required" } });
    return false;
  }
  if (!tokenEquals(token, adminToken)) {
    writeJson(res, 403, { ok: false, error: { code: "ADMIN_AUTH_FORBIDDEN", message: "admin bearer token is invalid" } });
    return false;
  }
  return true;
}

/** Create the standalone Skill Registry HTTP server. */
export function createSkillRegistryHttpServer(options: SkillRegistryServerOptions): Server {
  const store = new RegistryStore(options);
  const adminToken = options.adminToken || DEFAULT_SKILL_REGISTRY_ADMIN_TOKEN;
  const maxBytes = options.maxRequestBodyBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) { store.close(); throw new Error("invalid request body limit"); }
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = routePath(req);
    const method = req.method ?? "GET";

    if (method === "GET" && url.pathname === "/health") {
      writeJson(res, 200, store.health());
      return;
    }
    if (method === "GET" && url.pathname === "/skills") {
      writeJson(res, 200, store.listSkills(baseUrl(req)));
      return;
    }
    const versionsMatch = /^\/skills\/([^/]+)\/versions$/.exec(url.pathname);
    if (method === "GET" && versionsMatch) {
      writeJson(res, 200, { versions: store.listVersions(decodeURIComponent(versionsMatch[1] ?? ""), baseUrl(req)) });
      return;
    }
    const downloadMatch = /^\/skills\/([^/]+)\/download$/.exec(url.pathname);
    if ((method === "GET" || method === "POST") && downloadMatch) {
      const raw = store.downloadPackage(decodeURIComponent(downloadMatch[1] ?? ""), url.searchParams.get("version") ?? undefined);
      if (!raw) {
        writeJson(res, 404, { ok: false, error: { code: "SKILL_NOT_FOUND", message: "skill package was not found" } });
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(raw);
      return;
    }
    const skillMatch = /^\/skills\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && skillMatch) {
      const skill = store.getSkill(decodeURIComponent(skillMatch[1] ?? ""), baseUrl(req));
      if (!skill) {
        writeJson(res, 404, { ok: false, error: { code: "SKILL_NOT_FOUND", message: "skill was not found" } });
        return;
      }
      writeJson(res, 200, { skill });
      return;
    }
    if (url.pathname.startsWith("/admin/") && !requireAdmin(req, res, adminToken)) {
      return;
    }
    if (method === "GET" && url.pathname === "/admin/publishers") {
      writeJson(res, 200, { ok: true, publishers: store.listPublishers() });
      return;
    }
    if (method === "POST" && url.pathname === "/admin/publishers") {
      const result = store.createPublisher((await readJsonBody(req, maxBytes)) as CreatePublisherInput);
      if (!result.ok) {
        writeJson(res, 400, { ok: false, error: { code: "PUBLISHER_INVALID", message: "publisher is invalid", errors: result.errors } });
        return;
      }
      store.recordAuditEvent("publisher.upsert", "admin-token", result.publisher.id, {
        verified: result.publisher.verified,
      });
      writeJson(res, 201, { ok: true, publisher: result.publisher });
      return;
    }
    if (method === "POST" && url.pathname === "/admin/publish") {
      const result = store.publishPackage((await readJsonBody(req, maxBytes)) as PublishSkillInput, baseUrl(req));
      if (!result.ok) {
        writeJson(res, 400, { ok: false, error: { code: "SKILL_PACKAGE_INVALID", message: "skill package is invalid", errors: result.errors } });
        return;
      }
      if (!("skill" in result)) {
        writeJson(res, 500, { ok: false, error: { code: "PUBLISH_FAILED", message: "published skill was not returned" } });
        return;
      }
      store.recordAuditEvent("skill.publish", "admin-token", `${result.skill.id}@${result.skill.version}`, {
        source: result.skill.source,
        publisherId: result.skill.publisher.id,
      });
      writeJson(res, 201, { ok: true, skill: result.skill });
      return;
    }
    if (method === "GET" && url.pathname === "/admin/audit-events") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RegistryHttpError(400, "INVALID_LIMIT", "limit must be an integer between 1 and 500");
      writeJson(res, 200, { ok: true, events: store.listAuditEvents(limit) });
      return;
    }

    writeJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: url.pathname } });
  };
  const server = createServer((req, res) => { void handle(req, res).catch((error: unknown) => writeRequestError(res, error)); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.on("close", () => store.close());
  return server;
}
