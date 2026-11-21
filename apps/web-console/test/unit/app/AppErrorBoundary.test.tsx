import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppErrorBoundary } from "../../../src/app/AppErrorBoundary";

describe("应用错误边界", () => {
  it("渲染异常转换为可读页面，原始堆栈不进入 DOM", () => {
    const cause = new TypeError("Cannot read properties of undefined: secret");
    const boundary = new AppErrorBoundary({ children: <main>正常页面</main> });
    boundary.state = AppErrorBoundary.getDerivedStateFromError(cause);
    const markup = renderToStaticMarkup(boundary.render());
    expect(markup).toContain("页面暂时无法显示，请刷新页面后重试。");
    expect(markup).toContain("刷新页面");
    expect(markup).not.toMatch(/secret|Cannot read|正常页面/);
    expect(boundary.state.error?.cause).toBe(cause);
  });

  it("未处理的异步异常保留当前页面且可以关闭，并在卸载时移除监听", () => {
    const listeners = new Map<string, (event: Event) => void>();
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: Event) => void) =>
        listeners.set(type, listener),
      removeEventListener,
    });
    try {
      const boundary = new AppErrorBoundary({
        children: <main>正常页面</main>,
      });
      boundary.setState = vi.fn();
      boundary.componentDidMount();
      const event = Object.assign(new Event("unhandledrejection"), {
        reason: new Error("private"),
      });
      listeners.get("unhandledrejection")!(event);
      expect(boundary.setState).toHaveBeenCalledWith({
        error: expect.objectContaining({ kind: "unknown" }),
      });
      expect(boundary.state.fatal).toBe(false);
      expect(renderToStaticMarkup(boundary.render())).toContain("正常页面");
      boundary.componentWillUnmount();
      expect(removeEventListener).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
