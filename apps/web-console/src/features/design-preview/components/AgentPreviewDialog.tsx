import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, Check, X } from "lucide-react";
import { sampleAgents } from "../design-data";

/** 演示配置与测试操作的模态窗口，关闭后丢弃本次编辑。 */
export function AgentPreviewDialog({
  agent,
  onClose,
  onTest,
}: {
  agent: (typeof sampleAgents)[number] | "new";
  onClose: () => void;
  onTest: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(agent === "new" ? "" : agent.name);
  const [instructions, setInstructions] = useState(
    agent === "new" ? "" : agent.description,
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="preview-dialog"
      aria-label="Agent 配置预览"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(true);
        }}
      >
        <div className="dialog-heading">
          <span className="agent-card-icon">
            <Bot size={24} />
          </span>
          <button type="button" aria-label="关闭 Agent 配置" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <span className="hero-eyebrow">AGENT / 配置</span>
        <h2>{agent === "new" ? "新建 Agent" : name}</h2>
        <p className="dialog-subtitle">设置 Agent 名称、职责与工作指令。</p>
        <label>
          Agent 名称
          <input
            required
            maxLength={40}
            placeholder="例如：行业研究助手"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label>
          职责与指令
          <textarea
            required
            rows={4}
            placeholder="描述它的专长、工作方式和预期结果…"
            value={instructions}
            onChange={(event) => {
              setInstructions(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <p className="dialog-disclaimer">
          预览配置仅在当前窗口内有效，不会创建正式 Agent。
        </p>
        {saved && (
          <p className="dialog-saved" role="status">
            <Check size={15} />
            预览草稿已暂存，可以体验测试对话。
          </p>
        )}
        <div className="dialog-actions">
          <button type="submit" className="scene-secondary">
            暂存预览草稿
          </button>
          <button type="button" className="workspace-primary" onClick={onTest}>
            体验测试对话 <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
