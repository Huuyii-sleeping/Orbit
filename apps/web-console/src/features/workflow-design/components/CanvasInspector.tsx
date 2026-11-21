import { useState } from "react";
import {
  ArrowDownLeft,
  ChevronDown,
  Copy,
  HelpCircle,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  previewNodeKinds,
  type CanvasNode,
  type CanvasNodeData,
} from "../canvas-design-data";

/** 属性面板直接编辑预览节点；输入输出标签展示示例契约。 */
export function CanvasInspector({
  node,
  onChange,
  onDelete,
  onClose,
}: {
  node: CanvasNode | undefined;
  onChange: (patch: Partial<CanvasNodeData>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"config" | "ports">("config");
  const meta = node && previewNodeKinds[node.data.kind];
  return (
    <aside className="wc-inspector" aria-label="节点属性">
      <div className="wc-panel-tabs">
        <button
          aria-pressed={tab === "config"}
          onClick={() => setTab("config")}
        >
          配置
        </button>
        <button aria-pressed={tab === "ports"} onClick={() => setTab("ports")}>
          输入输出
        </button>
        <button className="wc-icon" aria-label="关闭属性面板" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {!node || !meta ? (
        <div className="wc-inspector-empty">
          <SlidersHorizontal size={24} />
          <strong>选择一个节点</strong>
          <p>点击画布上的节点，查看和修改属性。</p>
          <dl>
            <dt>选择</dt>
            <dd>V</dd>
            <dt>平移</dt>
            <dd>H / 空格</dd>
            <dt>多选</dt>
            <dd>Shift</dd>
          </dl>
        </div>
      ) : (
        <>
          <div className="wc-inspector-identity">
            <span className="wc-node-icon" data-tone={meta.tone}>
              <meta.icon size={18} />
            </span>
            <div>
              <strong>{node.data.label}</strong>
              <small>{meta.label}节点</small>
            </div>
            <HelpCircle size={13} />
          </div>
          {tab === "config" ? (
            <>
              <section className="wc-inspector-section">
                <label className="wc-field">
                  节点名称
                  <input
                    aria-label="节点名称"
                    value={node.data.label}
                    onChange={(event) =>
                      onChange({ label: event.target.value })
                    }
                  />
                </label>
                <label className="wc-field">
                  说明
                  <input
                    aria-label="节点说明"
                    value={node.data.description}
                    onChange={(event) =>
                      onChange({ description: event.target.value })
                    }
                  />
                </label>
              </section>
              {node.data.kind === "research" && (
                <section className="wc-inspector-section">
                  <div className="wc-section-title">
                    Agent 配置
                    <ChevronDown size={12} />
                  </div>
                  <div className="wc-agent-binding">
                    <span className="wc-avatar">研</span>
                    <span>
                      <strong>研究助手</strong>
                      <small>已绑定 · 示例配置</small>
                    </span>
                  </div>
                  <label className="wc-field">
                    模型
                    <select
                      aria-label="节点模型"
                      value={node.data.model}
                      onChange={(event) =>
                        onChange({ model: event.target.value })
                      }
                    >
                      <option>跟随 Agent 配置</option>
                      <option>通用模型</option>
                      <option>推理模型</option>
                    </select>
                  </label>
                  <div className="wc-field">
                    技能
                    <span className="wc-skill-binding">
                      网页检索<span>只读</span>
                    </span>
                  </div>
                </section>
              )}
              {!["start", "end"].includes(node.data.kind) && (
                <section className="wc-inspector-section">
                  <div className="wc-section-title">
                    {node.data.kind === "condition" ? "分支条件" : "任务指令"}
                    <span>支持变量</span>
                  </div>
                  <textarea
                    className="wc-prompt"
                    aria-label="节点指令"
                    rows={6}
                    value={node.data.prompt}
                    onChange={(event) =>
                      onChange({ prompt: event.target.value })
                    }
                  />
                  <span className="wc-input-reference">
                    <ArrowDownLeft size={11} />
                    输入来自上游节点
                  </span>
                </section>
              )}
              <section className="wc-inspector-section">
                <div className="wc-section-title">
                  输出<span>1 个字段</span>
                </div>
                <div className="wc-output-field">
                  <code>{meta.output}</code>
                  <small>
                    {node.data.kind === "research" ? "object" : "string"}
                  </small>
                </div>
                <p className="wc-field-note">供下游节点引用</p>
              </section>
            </>
          ) : (
            <div className="wc-inspector-section">
              <div className="wc-section-title">
                输入 <span>示例结构</span>
              </div>
              <pre className="wc-code">
                {JSON.stringify(
                  { topic: "本周 AI 行业动态", language: "zh-CN" },
                  null,
                  2,
                )}
              </pre>
              <div className="wc-section-title">输出</div>
              <pre className="wc-code">
                {JSON.stringify(
                  {
                    [meta.output]:
                      node.data.kind === "research"
                        ? { summary: "研究结果", sources: [] }
                        : "由节点执行生成",
                  },
                  null,
                  2,
                )}
              </pre>
              <p className="wc-field-note">此处用于预览输入输出的呈现方式。</p>
            </div>
          )}
          <div className="wc-inspector-footer">
            <span>
              <Copy size={11} />
              <code>{node.id}</code>
            </span>
            <button
              aria-label="删除选中节点"
              title="删除选中节点"
              onClick={onDelete}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
