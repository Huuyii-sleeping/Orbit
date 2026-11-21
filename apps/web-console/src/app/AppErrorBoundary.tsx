import { Component, type ErrorInfo, type ReactNode } from "react";
import { createAppError, type AppError } from "../lib/errors/error-factory";
import { ErrorNotice } from "../components/feedback/ErrorNotice";

type ErrorState = { error: AppError | null; fatal: boolean };

/** 捕获渲染错误与未处理的异步异常；原始异常仍由浏览器控制台记录。 */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  ErrorState
> {
  state: ErrorState = { error: null, fatal: false };

  static getDerivedStateFromError(error: unknown): ErrorState {
    return { error: createAppError(error, { source: "render" }), fatal: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Orbit] 页面渲染异常", error, info.componentStack);
  }

  private onError = (event: ErrorEvent) => {
    if (event.error || event.message)
      this.setState({ error: createAppError(event.error ?? event.message) });
  };

  private onRejection = (event: PromiseRejectionEvent) => {
    this.setState({ error: createAppError(event.reason) });
  };

  componentDidMount() {
    window.addEventListener("error", this.onError);
    window.addEventListener("unhandledrejection", this.onRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.onError);
    window.removeEventListener("unhandledrejection", this.onRejection);
  }

  render() {
    const { error, fatal } = this.state;
    return (
      <>
        {fatal ? null : this.props.children}
        {error && (
          <div className={fatal ? "app-error-fallback" : "app-error-notice"}>
            <ErrorNotice
              message={error.message}
              actionLabel={fatal ? "刷新页面" : "关闭提示"}
              onRetry={
                fatal
                  ? () => window.location.reload()
                  : () => this.setState({ error: null })
              }
            />
          </div>
        )}
      </>
    );
  }
}
