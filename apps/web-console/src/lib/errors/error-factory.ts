import {
  domainErrors,
  errorDescriptions,
  type ErrorDescription,
} from "./error-catalog";
export type { AppErrorKind } from "./error-catalog";

/** 错误来源与诊断信息，供请求层和业务边界补充，不参与原始文案透传。 */
export interface ErrorContext {
  source?: "request" | "response" | "input" | "render";
  status?: number;
  code?: string;
  metadata?: Record<string, unknown>;
}

/** 统一可展示错误；message 为前端文案，cause 和 context 保留诊断信息。 */
export class AppError extends Error implements ErrorDescription {
  readonly kind;
  readonly title;
  readonly retryable;

  constructor(
    description: ErrorDescription,
    readonly context: ErrorContext = {},
    cause?: unknown,
  ) {
    super(description.message, { cause });
    this.name = "AppError";
    this.kind = description.kind;
    this.title = description.title;
    this.retryable = description.retryable;
  }
}

/** 前端主动校验产生的可信文案；只用于本地输入校验，不包装服务器消息。 */
export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

function fromStatus(status: number) {
  if (status === 401) return errorDescriptions.authentication;
  if (status === 403) return errorDescriptions.permission;
  if (status === 404 || status === 410) return errorDescriptions["not-found"];
  if (status === 409 || status === 412) return errorDescriptions.conflict;
  if (status === 408 || status === 504) return errorDescriptions.timeout;
  if (status === 429) return errorDescriptions["rate-limit"];
  if (status === 502 || status === 503) return errorDescriptions.unavailable;
  if (status >= 500) return errorDescriptions.server;
  if (status === 413)
    return {
      ...errorDescriptions.validation,
      message: "提交的内容过大，请缩小文件或内容后再试。",
    };
  if (status >= 400) return errorDescriptions.validation;
  return errorDescriptions.unknown;
}

/** 把任意异常转成可读错误；业务码优先，HTTP 次之，未知消息永不原样展示。 */
export function createAppError(
  error: unknown,
  context: ErrorContext = {},
): AppError {
  if (error instanceof AppError) return error;
  const record = error && typeof error === "object" ? error : {};
  const code =
    context.code ??
    ("code" in record && typeof record.code === "string"
      ? record.code
      : undefined);
  const status =
    context.status ??
    ("status" in record && typeof record.status === "number"
      ? record.status
      : undefined);
  const details = { ...context, code, status };
  const name =
    "name" in record && typeof record.name === "string" ? record.name : "";
  const raw =
    typeof error === "string"
      ? error
      : "message" in record && typeof record.message === "string"
        ? record.message
        : "";
  let description: ErrorDescription;
  // 显式取消和浏览器能力错误先于通用的请求失败处理。
  if (name === "AbortError") description = errorDescriptions.canceled;
  else if (name === "TimeoutError" || code === "ETIMEDOUT")
    description = errorDescriptions.timeout;
  else if (code && Object.hasOwn(domainErrors, code)) {
    const domain = domainErrors[code];
    description = {
      ...errorDescriptions[domain.kind],
      message: domain.message,
    };
  } else if (status !== undefined && status >= 400)
    description = fromStatus(status);
  else if (context.source === "response")
    description = errorDescriptions["invalid-response"];
  else if (error instanceof UserInputError)
    description = { ...errorDescriptions.validation, message: error.message };
  else if (context.source === "input")
    description = {
      ...errorDescriptions.validation,
      message: "输入格式不正确，请检查 JSON、字段类型和必填项。",
    };
  else if (name === "QuotaExceededError" || code === "SQLITE_FULL")
    description = errorDescriptions.storage;
  else if (name === "NotAllowedError" || name === "SecurityError")
    description = {
      ...errorDescriptions.permission,
      message: "浏览器阻止了此操作，请检查站点权限后重试。",
    };
  else if (name === "NotSupportedError")
    description = errorDescriptions.unsupported;
  else if (
    context.source === "request" ||
    /^(failed to fetch|fetch failed|networkerror|network request failed|load failed)\b/i.test(
      raw,
    )
  )
    description = errorDescriptions.network;
  else if (context.source === "render")
    description = {
      ...errorDescriptions.unknown,
      title: "页面加载异常",
      message: "页面暂时无法显示，请刷新页面后重试。",
    };
  else description = errorDescriptions.unknown;
  return new AppError(description, details, error);
}

/** 页面错误出口统一调用，禁止直接读取未知异常的 message。 */
export function getErrorMessage(error: unknown, context?: ErrorContext) {
  return createAppError(error, context).message;
}
