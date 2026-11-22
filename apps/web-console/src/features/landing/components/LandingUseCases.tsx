import { useRef, useState, type KeyboardEvent } from "react";

const examples = [
  {
    label: "整理反馈",
    task: "把这周零散的反馈，整理成一份迭代纪要。",
    input: "登录后偶尔会回到首页。希望支持按标签筛选。导出的文件名能不能带日期？上次那个登录问题又遇到了。",
    title: "本周反馈纪要",
    output: [
      "待排查 · 登录后跳回首页，出现重复反馈。",
      "新需求 · 增加标签筛选，导出文件名附带日期。",
      "下一步 · 先复现登录问题，再评估两项改进。",
    ],
    filename: "feedback-notes.md",
  },
  {
    label: "阅读提炼",
    task: "从这段阅读笔记里，提炼观点和可以尝试的做法。",
    input: "文章提到：任务切换会带来额外的注意力成本。作者建议把同类工作集中处理，留出不被打断的时间，再定期回顾效果。",
    title: "阅读要点与行动",
    output: [
      "核心观点 · 频繁切换任务会消耗注意力。",
      "可试做法 · 集中处理同类工作，预留专注时间。",
      "回顾问题 · 一周后检查，这样安排是否更适合自己？",
    ],
    filename: "reading-notes.md",
  },
  {
    label: "内容初稿",
    task: "把这些素材，写成一段简洁的更新说明。",
    input: "这次更新：列表支持标签筛选；导出文件会带上日期；修复偶发的登录跳转问题。语气自然，面向使用产品的人。",
    title: "这次更新，让整理更顺手",
    output: [
      "列表可以按标签筛选了，找到需要的内容更方便。",
      "导出的文件名会附带日期，方便保存和查找。",
      "我们也修复了偶发的登录跳转问题。",
    ],
    filename: "update-draft.md",
  },
];

/** 三个文本任务共用一处成果预览，切换只展示示例，不调用模型。 */
export function LandingUseCases() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const example = examples[selected];

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % examples.length
        : event.key === "ArrowLeft"
          ? (index + examples.length - 1) % examples.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? examples.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }

  return (
    <section className="use-cases section container" id="use-cases" aria-labelledby="use-cases-title">
      <div className="section-heading reveal">
        <div>
          <div className="eyebrow">
            <span />
            MADE FOR YOUR EVERYDAY
          </div>
          <h2 id="use-cases-title">从一件小事开始。</h2>
        </div>
        <div className="section-intro">
          <p>
            把散落的文字，
            <br />
            变成下一步能用的内容。
          </p>
        </div>
      </div>
      <div className="example-tabs" role="tablist" aria-label="使用场景">
        {examples.map((item, index) => (
          <button
            key={item.label}
            id={`use-case-tab-${index}`}
            role="tab"
            aria-selected={selected === index}
            aria-controls="use-case-panel"
            tabIndex={selected === index ? 0 : -1}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => navigate(event, index)}
          >
            {item.label}
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
      <div
        className="example-panel"
        id="use-case-panel"
        role="tabpanel"
        aria-labelledby={`use-case-tab-${selected}`}
        tabIndex={0}
      >
        <div className="example-input">
          <span className="mono example-label">交给 Orbit</span>
          <h3>{example.task}</h3>
          <p>{example.input}</p>
          <span className="example-input-note">一段文字，一个明确的要求。</span>
        </div>
        <div className="example-result" aria-live="polite" aria-atomic="true">
          <div className="example-result-head">
            <span className="mono example-label">你得到</span>
            <span className="mono">示例内容</span>
          </div>
          <h3>{example.title}</h3>
          <ul>
            {example.output.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="example-file mono">
            <span aria-hidden="true">▤</span>
            {example.filename}
            <span>待你检查与修改</span>
          </div>
        </div>
      </div>
      <div className="example-foot">
        <p>在工作台创建助手，用自己的内容试跑。</p>
        <a className="text-link" href="/studio">
          创建我的助手 <span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  );
}
