import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  ChevronDown,
  Play,
  RotateCcw,
} from "lucide-react";
import { BrandMark } from "../../../components/BrandMark";
import type { CanvasDirection } from "../canvas-design-data";

/** 文档导航和示例文件操作，保持画布顶栏只有一层。 */
export function CanvasDocumentBar({
  direction,
  runOpen,
  onReset,
  onExport,
  onToggleRun,
  onShowRun,
}: {
  direction: CanvasDirection;
  runOpen: boolean;
  onReset: () => void;
  onExport: () => void;
  onToggleRun: () => void;
  onShowRun: () => void;
}) {
  return (
    <header className="wc-document-bar">
      <a className="wc-document-home" href="/studio" aria-label="返回工作台">
        <BrandMark size={20} />
      </a>
      <span className="wc-top-divider" />
      <a className="wc-document-back" href="/studio" title="返回工作台">
        <ArrowLeft size={13} />
      </a>
      <div className="wc-document-name">
        <span>
          个人空间 <span>/</span> 工作流
        </span>
        <strong>
          研究简报
          <ChevronDown size={12} />
          <small>草稿</small>
        </strong>
      </div>
      <span className="wc-document-save">
        <Check size={12} />
        示例画布
      </span>
      {direction === "console" && (
        <div className="wc-document-tabs">
          <span className="is-active">编辑器</span>
          <button onClick={() => onShowRun()}>运行记录</button>
        </div>
      )}
      <div className="wc-document-actions">
        <button
          className="wc-icon"
          title="恢复示例"
          aria-label="恢复示例"
          onClick={onReset}
        >
          <RotateCcw size={14} />
        </button>
        <button
          className="wc-icon"
          title="导出示例 JSON"
          aria-label="导出示例 JSON"
          onClick={onExport}
        >
          <ArrowDownToLine size={14} />
        </button>
        <span className="wc-top-divider" />
        <button
          className="wc-run-button"
          aria-expanded={runOpen}
          onClick={() => onToggleRun()}
        >
          <Play size={12} />
          运行示例
        </button>
      </div>
    </header>
  );
}
