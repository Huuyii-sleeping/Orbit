import type { ServerResponse } from "node:http";

export type JsonObject = Record<string, unknown>;
const saasResponses = new WeakSet<object>();

/** 标记 SaaS 响应，避免共享写入函数重新添加通配符 CORS。 */
export function markSaasResponse(res: object): void { saasResponses.add(res); }

/** Apply common Web-facing response headers for BFF endpoints. */
export function applyCommonHeaders(res: ServerResponse): void {
  applyHeaderSetters(res);
}

export function applyHeaderSetters(res: { setHeader(name: string, value: string): void }): void {
  if (!saasResponses.has(res)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Last-Event-ID");
  }
  res.setHeader("Cache-Control", "no-store");
}

/** Write a JSON response with the BFF common headers. */
export function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  applyCommonHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

/** 保留上游状态码和响应体，供各领域薄 controller 复用。 */
export function writeProxyResult(res: ServerResponse, result: { status: number; body: unknown }): void {
  writeJson(res, result.status, result.body);
}

export function errorPayload(code: string, message: string, metadata: JsonObject = {}): JsonObject {
  return {
    ok: false,
    error: {
      code,
      message,
      ...metadata,
    },
  };
}
