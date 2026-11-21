import type { ReactNode } from "react";
import "../../styles/error-notice.css";

/** 各页面共用的紧凑错误提示，继承内容宽度，操作与提示使用同一色阶。 */
export function ErrorNotice({
  message,
  onRetry,
  actionLabel = "重试",
  children,
}: {
  message: string;
  onRetry?: () => void;
  actionLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="error-notice" role="alert">
      <svg
        className="error-notice__icon"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7" />
        <path d="M10 6.2v4.6" />
        <circle cx="10" cy="13.5" r=".7" fill="currentColor" stroke="none" />
      </svg>
      <div className="error-notice__content">
        <p>{message}</p>
        {children}
      </div>
      {onRetry && (
        <button
          type="button"
          className="error-notice__action"
          onClick={onRetry}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            aria-hidden="true"
          >
            <path
              d="M13 6a5.2 5.2 0 1 0 .1 3.5M13 2.8V6H9.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
