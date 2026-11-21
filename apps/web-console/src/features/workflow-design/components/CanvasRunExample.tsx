import { Check, ChevronRight, CircleCheck, X } from "lucide-react";

const exampleSteps = [
  { name: "开始", duration: "2 ms", detail: "topic = 本周 AI 行业动态" },
  {
    name: "资料研究",
    duration: "12.4 s",
    detail: "收集 6 个来源，生成研究摘要",
  },
  { name: "来源是否充分", duration: "3 ms", detail: "6 ≥ 3，进入「充分」分支" },
  {
    name: "生成简报",
    duration: "2.1 s",
    detail: "输出 Markdown 简报与引用链接",
  },
  { name: "结束", duration: "1 ms", detail: "返回 document" },
];

/** 用明确标注的静态记录展示运行面板，不调用模型或生产执行接口。 */
export function CanvasRunExample({ onClose }: { onClose: () => void }) {
  return (
    <section className="wc-run-panel" aria-label="运行记录示例">
      <div className="wc-run-header">
        <strong>
          <CircleCheck size={13} />
          运行记录
        </strong>
        <span>示例记录 · 未调用模型</span>
        <button className="wc-icon" aria-label="关闭运行记录" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="wc-run-summary">
        <span>
          <span className="wc-status-dot" />
          已完成
        </span>
        <code>14.5 s</code>
        <span>5 个节点</span>
        <span className="wc-run-id">研究简报 / 示例输入</span>
      </div>
      <div className="wc-run-steps">
        {exampleSteps.map((step, index) => (
          <div className="wc-run-step" key={step.name}>
            <span className="wc-run-step-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <Check size={12} />
            <strong>{step.name}</strong>
            <small>{step.duration}</small>
            <p>{step.detail}</p>
            {index < exampleSteps.length - 1 && (
              <ChevronRight className="wc-run-step-arrow" size={13} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
