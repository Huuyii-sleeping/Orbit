import { describe, expect, it } from "vitest";
import {
  AppError,
  createAppError,
  getErrorMessage,
  UserInputError,
} from "../../../../src/lib/errors/error-factory";

describe("前端 error factory", () => {
  it.each([
    [401, "authentication"],
    [403, "permission"],
    [404, "not-found"],
    [410, "not-found"],
    [409, "conflict"],
    [412, "conflict"],
    [408, "timeout"],
    [504, "timeout"],
    [429, "rate-limit"],
    [502, "unavailable"],
    [503, "unavailable"],
    [500, "server"],
    [400, "validation"],
    [422, "validation"],
  ])("HTTP %s 转为 %s，并隐藏服务端正文", (status, kind) => {
    const error = createAppError({
      status,
      message: "SQL error /private/path token=secret",
    });
    expect(error.kind).toBe(kind);
    expect(error.message).not.toMatch(/SQL|private|secret/);
    expect(error.title).toBeTruthy();
  });

  it("明确业务码优先于 HTTP，不把未知业务码误映射到原型属性", () => {
    expect(
      createAppError({ status: 500, code: "AGENT_UPSTREAM_UNAVAILABLE" }).kind,
    ).toBe("unavailable");
    expect(createAppError({ status: 500, code: "constructor" }).kind).toBe(
      "server",
    );
    expect(
      createAppError({
        status: 500,
        code: "NEW_SERVER_ERROR",
        message: "中文服务端内部异常",
      }).message,
    ).toBe("服务暂时出现问题，请稍后重试。");
  });

  it.each([
    [new DOMException("secret", "AbortError"), "canceled", false],
    [new DOMException("secret", "TimeoutError"), "timeout", true],
    [new DOMException("secret", "QuotaExceededError"), "storage", false],
    [new DOMException("secret", "NotAllowedError"), "permission", false],
    [new DOMException("secret", "SecurityError"), "permission", false],
    [new DOMException("secret", "NotSupportedError"), "unsupported", false],
    [new TypeError("Failed to fetch"), "network", true],
    [new TypeError("Cannot read properties of undefined"), "unknown", true],
  ])("分类浏览器异常 %s", (cause, kind, retryable) => {
    expect(createAppError(cause)).toMatchObject({ kind, retryable, cause });
  });

  it("只有显式本地输入错误展示自定义文案，普通异常和任意字符串不透传", () => {
    expect(getErrorMessage(new UserInputError("年龄必须是数字。"))).toBe(
      "年龄必须是数字。",
    );
    for (const error of [
      null,
      undefined,
      42,
      { message: "secret" },
      "原始错误",
      new Error("服务器中文错误"),
    ]) {
      expect(createAppError(error).kind).toBe("unknown");
      expect(getErrorMessage(error)).not.toMatch(
        /secret|原始错误|服务器中文错误|object Object/,
      );
    }
    expect(
      createAppError(new SyntaxError("Unexpected token"), { source: "input" })
        .kind,
    ).toBe("validation");
  });

  it("重复转换保持分类、cause、上下文不丢失", () => {
    const cause = new Error("private debug");
    const error = createAppError(cause, {
      source: "response",
      status: 503,
      metadata: { requestId: "r1" },
    });
    expect(error).toBeInstanceOf(AppError);
    expect(createAppError(error)).toBe(error);
    expect(error.context.metadata).toEqual({ requestId: "r1" });
    expect(error.cause).toBe(cause);
  });
});
