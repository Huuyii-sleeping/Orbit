import { browserOrganizationContext, type BrowserIdentitySession } from "@orbit/runtime-contracts";
import { AppError, createAppError } from "../lib/errors/error-factory";

/** BFF API 错误，展示前端文案，同时保留状态码、领域错误码和冲突元数据。 */
export class ApiRequestError extends AppError {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly metadata: Record<string, unknown>,
  ) {
    const error = createAppError(message, {
      source: "response",
      status,
      code,
      metadata,
    });
    super(error, error.context, message);
    this.name = "ApiRequestError";
  }
}

/** API 返回的普通 JSON 对象。 */
export type JsonObject = Record<string, unknown>;

/** 可关闭并订阅事件的 SSE 连接。 */
type EventSourceLike = {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
};

/** SSE 构造器，允许在测试中注入连接实现。 */
export type EventSourceConstructor = new (url: string) => EventSourceLike;

/** 将 JSON 对象以外的值归一化为空对象。 */
export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

/** 只保留字符串值。 */
export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 只保留有限数字。 */
export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 将接口值归一化为布尔值。 */
export function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : Boolean(value);
}

/** 去除首尾空白，空值使用字段默认值。 */
export function cleanText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const next = value.trim();
  return next ? next : fallback;
}

/** 截断可选文本，非字符串视为空值。 */
export function cleanOptionalText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/** Normalizes an accent color to a lowercase `#rrggbb` hex string, or "" (auto) when invalid. */
export function cleanColor(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const next = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(next) ? next : "";
}

/** 过滤、截断并去重字符串列表。 */
export function cleanStringList(
  value: unknown,
  limit: number,
  itemLimit: number,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, itemLimit))
        .filter(Boolean),
    ),
  ].slice(0, limit);
}

/** 无效数字使用字段默认值。 */
export function cleanNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 请求原始响应；网络异常统一保留 cause 并转换为可展示错误。 */
export async function fetchResponse(input: string, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw createAppError(error, { source: "request" });
  }
}

/** 读取 JSON 响应；非成功状态允许 HTML/纯文本错误页，但不会将正文展示给用户。 */
export async function readJsonResponse(response: Response) {
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    throw createAppError(error, { source: "request" });
  }
  let parsed: unknown = {};
  try {
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    if (response.ok)
      throw createAppError(error, {
        source: "response",
        status: response.status,
      });
    throw new ApiRequestError(raw, response.status, "API_REQUEST_FAILED", {});
  }
  const object = asObject(parsed);
  if (!response.ok || object.ok === false) {
    const error = asObject(object.error);
    const { code, message, ...metadata } = error;
    throw new ApiRequestError(
      asString(message) || raw || response.statusText,
      response.status,
      asString(code) || "API_REQUEST_FAILED",
      metadata,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createAppError(parsed, {
      source: "response",
      status: response.status,
    });
  }
  return object;
}

/** 可选的浏览器组织预期，只用于拒绝陈旧请求，不能代替服务端身份。 */
export type OrganizationRequestScope = Pick<BrowserIdentitySession, "issuer" | "user" | "tenantId">;

/** 请求 BFF JSON，保留状态码及领域错误信息，页面无需解析服务端错误。 */
export async function requestJson<T>(
  input: string,
  init?: RequestInit,
  scope?: OrganizationRequestScope,
): Promise<T> {
  if (scope) {
    const headers = new Headers(init?.headers);
    headers.set("X-Orbit-Organization-Context", browserOrganizationContext(scope));
    const timeout = AbortSignal.timeout(15_000);
    init = { ...init, headers, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout };
  }
  return (await readJsonResponse(await fetchResponse(input, init))) as T;
}

/** 构造带 JSON 请求体的 HTTP 参数。 */
export function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** 解析 SSE 数据，保留非 JSON 文本事件。 */
export function parseEventData(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
