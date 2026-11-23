import type { IncomingMessage, ServerResponse } from "node:http";
import { SkillVersionConflictError } from "../registry/package-writer.js";

/** 可向调用方公开的请求边界错误。 */
export class RegistryHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** 输出 Registry JSON 响应。 */
export function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

/** 限制接收大小，超限后丢弃后续字节而不继续积累内存。 */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  if (Number(req.headers["content-length"] ?? 0) > maxBytes) {
    req.resume();
    throw new RegistryHttpError(413, "BODY_TOO_LARGE", "request body exceeds the size limit");
  }
  const raw = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk: Buffer) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > maxBytes) {
        exceeded = true;
        chunks.length = 0;
        reject(new RegistryHttpError(413, "BODY_TOO_LARGE", "request body exceeds the size limit"));
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
    req.on("aborted", () => reject(new RegistryHttpError(400, "REQUEST_ABORTED", "request was interrupted")));
  });
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new RegistryHttpError(400, "INVALID_JSON", "request body must be valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RegistryHttpError(400, "INVALID_BODY", "request body must be an object");
  }
  return value as Record<string, unknown>;
}

/** 将路由异常转为 HTTP 响应，内部异常只写服务端日志。 */
export function writeRequestError(res: ServerResponse, error: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  const status = error instanceof RegistryHttpError ? error.status : error instanceof URIError ? 400 : error instanceof SkillVersionConflictError ? 409 : 500;
  const code = error instanceof RegistryHttpError || error instanceof SkillVersionConflictError ? error.code : status === 400 ? "INVALID_URL" : "INTERNAL_ERROR";
  const message = error instanceof RegistryHttpError || error instanceof SkillVersionConflictError ? error.message : status === 400 ? "malformed URL encoding" : "internal server error";
  if (status === 500) console.error("Registry request failed", error);
  writeJson(res, status, { ok: false, error: { code, message } });
}
