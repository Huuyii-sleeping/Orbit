import { useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  Code2,
  FileText,
  Globe,
  Paperclip,
  Play,
  Search,
  Workflow,
  X,
} from "lucide-react";
import { sampleSkills, type PreviewView } from "../design-data";

const steps = [
  {
    title: "收集行业动态",
    tool: "网页搜索",
    description: "搜索本周 AI 行业动态，收集产品发布、技术进展和行业观察。",
    output: "12 条行业动态 · 6 个信息来源",
  },
  {
    title: "分析关键信息",
    tool: "行业研究助手",
    description: "对收集的信息去重、归类，提炼值得关注的趋势和关键信号。",
    output: "3 个关键趋势 · 5 条重点事件",
  },
  {
    title: "生成周报草稿",
    tool: "内容编辑",
    description: "根据重点事件与趋势，撰写结构清晰的行业简报并保留来源引用。",
    output: "行业简报草稿 · Markdown",
  },
  {
    title: "确认并发布",
    tool: "人工确认",
    description: "检查内容与来源，确认后将简报保存到团队知识库。",
    output: "等待确认 · 不会在预览中实际发布",
  },
];

/** 对话、SOP、技能场景的本地交互示例。 */
export function PreviewScenes({
  view,
  query,
  onQueryChange,
}: {
  view: Exclude<PreviewView, "agents">;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [installed, setInstalled] = useState<string[]>([
    "web-search",
    "data-analysis",
  ]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [attachmentHint, setAttachmentHint] = useState(false);

  if (view === "chat")
    return (
      <section className="scene-chat">
        <div className="scene-heading">
          <span className="hero-eyebrow">测试环境</span>
          <h1>测试对话</h1>
          <p>行业研究助手 · 网页检索、数据分析已就绪</p>
        </div>
        <div className="chat-preview-thread" aria-live="polite">
          <div className="chat-assistant">
            <span className="chat-avatar">研</span>
            <div>
              <strong>行业研究助手</strong>
              <p>
                你正在测试「行业研究助手」。
                <br />
                输入任务，检查回复内容和工具调用。
              </p>
            </div>
          </div>
          {messages.map((message, index) => (
            <div key={index} className="chat-exchange">
              <div className="chat-user">{message}</div>
              <div className="chat-assistant">
                <span className="chat-avatar">研</span>
                <div>
                  <strong>
                    行业研究助手 <small>· 演示回复</small>
                  </strong>
                  <p>
                    可以围绕「{message}
                    」先梳理背景、比较关键观点，再整理成带来源的研究摘要。
                  </p>
                  <div className="chat-tool">
                    <Search size={14} />
                    网页检索 → 数据分析 → 研究摘要
                  </div>
                  <p className="scene-muted">
                    这是本地交互演示。真实模型对话请前往正式工作台。
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
        {messages.length === 0 && (
          <div className="chat-suggestions">
            {[
              "整理本周 AI 行业动态",
              "对比三个开源 Agent 框架",
              "帮我规划一个研究任务",
            ].map((text) => (
              <button key={text} type="button" onClick={() => setDraft(text)}>
                {text}
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
        )}
        <form
          className="chat-preview-composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) {
              setMessages([...messages, draft.trim()]);
              setDraft("");
            }
          }}
        >
          <textarea
            rows={2}
            aria-label="预览消息"
            placeholder="输入测试消息…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div>
            <button
              type="button"
              aria-label="了解附件预览"
              onClick={() => setAttachmentHint(!attachmentHint)}
            >
              <Paperclip size={18} />
            </button>
            <span>
              {attachmentHint
                ? "文件上传请使用正式工作台，预览不上传文件。"
                : "行业研究助手 · 演示模式"}
            </span>
            <button
              className="chat-send"
              aria-label="发送预览消息"
              type="submit"
              disabled={!draft.trim()}
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
      </section>
    );

  if (view === "workflow")
    return (
      <section className="scene-sop">
        <div className="scene-heading scene-heading-row">
          <div>
            <span className="hero-eyebrow">SOP / 草稿</span>
            <h1>每周行业简报</h1>
            <p>一套流程，从信息收集到内容交付。</p>
          </div>
          <button
            className="workspace-primary"
            type="button"
            onClick={() => {
              setRunning(!running);
              setStep(0);
            }}
          >
            {running ? <Check size={16} /> : <Play size={16} />}
            {running ? "结束演示" : "演示运行"}
          </button>
        </div>
        <div className="sop-preview-layout">
          <div className="sop-preview-canvas">
            <span className="canvas-label">
              <Workflow size={14} />
              每周行业简报 <span>草稿</span>
            </span>
            <div className="sop-trigger">
              每周一 09:00 <span>定时开始</span>
            </div>
            {steps.map((item, index) => (
              <div key={item.title} className="sop-step-wrap">
                <div className="sop-connector">
                  <ChevronRight size={12} />
                </div>
                <button
                  type="button"
                  className={`sop-preview-node ${step === index ? "active" : ""} ${running && index < step ? "complete" : ""}`}
                  aria-pressed={step === index}
                  onClick={() => setStep(index)}
                >
                  <span className="step-number">
                    {running && index < step ? <Check size={16} /> : index + 1}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.tool}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              </div>
            ))}
            <span className="sop-end">完成</span>
          </div>
          <aside className="sop-step-detail">
            <span className="hero-eyebrow">
              步骤 {step + 1} / {steps.length}
            </span>
            <h2>{steps[step].title}</h2>
            <span className="scene-tag">{steps[step].tool}</span>
            <h3>这一步做什么</h3>
            <p>{steps[step].description}</p>
            <h3>预期输出</h3>
            <div className="sop-output">
              <FileText size={19} />
              <span>{steps[step].output}</span>
            </div>
            {running && (
              <p className="sop-run-status" role="status">
                演示运行中 · 当前停在步骤 {step + 1}
              </p>
            )}
            <button
              type="button"
              className="scene-secondary"
              onClick={() => setStep((step + 1) % steps.length)}
            >
              {step === steps.length - 1 ? "回到第一步" : "查看下一步"}
              <ArrowRight size={14} />
            </button>
            <p className="scene-muted">
              流程与运行均为示例，不会调用工具或发布内容。
            </p>
          </aside>
        </div>
      </section>
    );

  const skill = sampleSkills.find((item) => item.id === selectedSkill);
  return (
    <section className="scene-skills">
      <div className="scene-heading">
        <span className="hero-eyebrow">工作空间 / SKILLS</span>
        <h1>技能中心</h1>
        <p>管理可绑定到 Agent 的技能。</p>
      </div>
      <label className="preview-search skill-search">
        <Search size={17} />
        <input
          aria-label="搜索技能"
          placeholder="搜索网页、文档、代码等技能"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <div className="skills-preview-grid">
        {sampleSkills
          .filter((item) => `${item.name}${item.description}`.includes(query))
          .map((item) => {
            const Icon = {
              search: Globe,
              chart: ChartNoAxesCombined,
              write: FileText,
              code: Code2,
            }[item.icon];
            return (
              <article
                key={item.id}
                className={`skill-preview-card tone-${item.tone}`}
              >
                <span className="agent-card-icon">
                  <Icon size={23} />
                </span>
                <span className="skill-source">Orbit 官方</span>
                <h2>{item.name}</h2>
                <p>{item.description}</p>
                <div>
                  <button
                    type="button"
                    className="skill-detail-button"
                    onClick={() => setSelectedSkill(item.id)}
                  >
                    查看详情 <ArrowRight size={14} />
                  </button>
                  <button
                    type="button"
                    className={`skill-install ${installed.includes(item.id) ? "installed" : ""}`}
                    onClick={() =>
                      setInstalled(
                        installed.includes(item.id)
                          ? installed.filter((id) => id !== item.id)
                          : [...installed, item.id],
                      )
                    }
                  >
                    {installed.includes(item.id) ? (
                      <>
                        <Check size={13} />
                        已添加
                      </>
                    ) : (
                      "添加技能"
                    )}
                  </button>
                </div>
              </article>
            );
          })}
      </div>
      {!sampleSkills.some((item) =>
        `${item.name}${item.description}`.includes(query),
      ) && (
        <div className="preview-empty">
          <h3>没有匹配的技能</h3>
          <button type="button" onClick={() => onQueryChange("")}>
            清除搜索
          </button>
        </div>
      )}
      {skill && (
        <div
          className="skill-preview-detail"
          role="region"
          aria-label="技能详情"
        >
          <button
            className="skill-close"
            type="button"
            aria-label="关闭技能详情"
            onClick={() => setSelectedSkill(null)}
          >
            <X size={18} />
          </button>
          <span className="hero-eyebrow">技能详情 · 官方技能</span>
          <h2>{skill.name}</h2>
          <p>{skill.description}</p>
          <p>
            可在 Agent
            配置中绑定此技能，作为工作流步骤使用。预览中的添加操作仅保存在当前页面。
          </p>
        </div>
      )}
      <p className="scene-muted" role="status">
        已在预览中添加 {installed.length} 项技能 · 操作不影响正式安装状态
      </p>
    </section>
  );
}
