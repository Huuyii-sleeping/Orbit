import { useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileJson,
  FlaskConical,
  Lock,
  Moon,
  MoreHorizontal,
  PackageCheck,
  Play,
  Sun,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { BrandMark } from "../../../../components/BrandMark";
import type { ThemeMode } from "../../../../theme";
import type { SopSaveState } from "../sop-editor-types";

/** 自由画布的单行文档栏，低频文件、布局和运行操作收进菜单。 */
export function SopToolbar(props: {
  name: string;
  summary: string;
  theme: ThemeMode;
  saveState: SopSaveState;
  saveMessage: string;
  debugMessage?: string;
  legacyBackup: string | null;
  onThemeToggle: () => void;
  onNameChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
  onBack: () => void;
  onValidate: () => void;
  onSave: () => void;
  onOpenLifecycle: () => void;
  onExportJson: () => void;
  onImportText: (text: string) => void;
  onLayout: (direction: "LR" | "TB") => Promise<void>;
  onTogglePin: () => void;
  canTestNode: boolean;
  onTestNode: () => void;
  onRunDraft: () => void;
  onRunProduction: () => void;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as globalThis.Node))
        menuRef.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") menuRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const status = {
    idle: "待保存",
    saving: "正在保存",
    saved: "已保存",
    error: "保存失败",
    conflict: "保存冲突",
  }[props.saveState];
  const downloadBackup = () => {
    const url = URL.createObjectURL(
      new Blob([props.legacyBackup!], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "workflow-v1-backup.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <header className="sop-document-bar">
      <button
        className="sop-float-icon"
        aria-label="返回工作流列表"
        title="返回工作流"
        onClick={props.onBack}
      >
        <ArrowLeft size={15} />
      </button>
      <span className="sop-document-brand">
        <BrandMark size={21} />
      </span>
      <div className="sop-document-identity">
        <small>工作流</small>
        <input
          aria-label="流程名称"
          value={props.name}
          onChange={(event) => props.onNameChange(event.target.value)}
        />
      </div>
      <span
        className={`sop-document-save ${props.saveState}`}
        role="status"
        title={props.saveMessage}
      >
        <Check size={12} />
        <span>{status}</span>
      </span>
      <div className="sop-document-spacer" />
      <button
        className="sop-float-icon"
        aria-label={props.theme === "light" ? "切换深色主题" : "切换浅色主题"}
        title="切换主题"
        onClick={props.onThemeToggle}
      >
        {props.theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
      </button>
      <details ref={menuRef} className="sop-document-menu">
        <summary
          className="sop-float-icon"
          aria-label="更多流程操作"
          title="更多操作"
        >
          <MoreHorizontal size={17} />
        </summary>
        <div
          className="sop-menu-content"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button"))
              menuRef.current?.removeAttribute("open");
          }}
        >
          <label className="sop-menu-description">
            <span>流程说明</span>
            <textarea
              aria-label="流程描述"
              rows={2}
              value={props.summary}
              placeholder="添加流程说明"
              onChange={(event) => props.onSummaryChange(event.target.value)}
            />
          </label>
          <button onClick={props.onValidate}>
            <TriangleAlert size={14} />
            检查流程
          </button>
          {props.debugMessage && (
            <p className="sop-menu-status" role="status">
              {props.debugMessage}
            </p>
          )}
          <hr />
          <button onClick={() => void props.onLayout("LR")}>
            <ArrowRight size={14} />
            横向布局
          </button>
          <button onClick={() => void props.onLayout("TB")}>
            <ArrowDown size={14} />
            纵向布局
          </button>
          <button onClick={props.onTogglePin}>
            <Lock size={14} />
            固定 / 取消固定选中节点
          </button>
          <hr />
          <button disabled={!props.canTestNode} onClick={props.onTestNode}>
            <FlaskConical size={14} />
            测试选中节点
          </button>
          <button onClick={props.onRunProduction}>
            <PackageCheck size={14} />
            运行发布版本
          </button>
          <hr />
          <button onClick={props.onExportJson}>
            <FileJson size={14} />
            查看 / 导出 JSON
          </button>
          <label className="sop-menu-upload">
            <Upload size={14} />
            导入 JSON
            <input
              aria-label="导入工作流 JSON"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void file.text().then(props.onImportText);
                event.target.value = "";
              }}
            />
          </label>
          {props.legacyBackup && (
            <button onClick={downloadBackup}>
              <Download size={14} />
              下载旧版备份
            </button>
          )}
        </div>
      </details>
      <button
        className="btn btn-ghost btn-sm sop-document-save-button"
        disabled={
          props.saveState === "saving" || props.saveState === "conflict"
        }
        onClick={props.onSave}
      >
        保存
      </button>
      <button
        className="btn btn-ghost btn-sm sop-document-publish"
        onClick={props.onOpenLifecycle}
      >
        发布
      </button>
      <button className="btn btn-primary btn-sm" onClick={props.onRunDraft}>
        <Play size={12} />
        运行<span className="sop-run-draft-label">草稿</span>
      </button>
    </header>
  );
}
