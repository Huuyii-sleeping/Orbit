import type { NextFunction, Request, Response } from "express";
import { errorPayload, writeJson } from "./http-utils.js";

/** 解析器拒绝属于客户端错误；返回固定消息，避免把原始 JSON 或预期超限写进异常日志。 */
export function requestBodyError(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  const type = error && typeof error === "object" && "type" in error ? error.type : undefined;
  const status = type === "entity.too.large" ? 413 : type === "encoding.unsupported" ? 415 : type === "entity.parse.failed" ? 400 : undefined;
  if (!status) { next(error); return; }
  writeJson(res, status, errorPayload(status === 413 ? "REQUEST_BODY_TOO_LARGE" : "INVALID_REQUEST_BODY", "Request body rejected"));
}
