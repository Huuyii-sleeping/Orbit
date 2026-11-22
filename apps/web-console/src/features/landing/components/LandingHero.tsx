import type { CSSProperties } from "react";

/** A 版落地页的首屏产品画布。 */
export function LandingHero() {
  return (
    <section className="hero hero-canvas container">
      <div className="hero-copy">
        <div className="eyebrow">
          <span />
          <span className="decode">{"AGENT · SKILLS · WORKFLOWS"}</span>
        </div>
        <h1>
          {"把想法，编排成"}
          <br />
          {"能执行的 Agent。"}
        </h1>
        <p className="hero-description">
          {"整理反馈、提炼阅读要点、写出内容初稿。"}
          <br />
          {"把重复的步骤，交给你自己的 AI 助手。"}
        </p>
        <div className="actions">
          <a className="button primary magnet" href="#use-cases">
            {"先看一个示例"}
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 10h13m-5-5 5 5-5 5" />
            </svg>
          </a>
          <a className="button secondary" href="/studio">
            {"进入工作台"}
          </a>
        </div>
        <div className="hero-legend mono">
          {"给出任务 "}
          <span>{"→"}</span>
          {" 助手整理 "}
          <span>{"→"}</span>
          {" 检查结果 "}
          <span>{"→"}</span>
          {" 保存做法"}
        </div>
        <span className="hero-side-note mono">{"YOUR IDEAS. A CLEAR PATH TO EXECUTION."}</span>
      </div>
      <div className="hero-visual">
        <div className="app-window ">
          <div className="window-bar">
            <span className="window-name">
              <span className="tiny-logo">{"◎"}</span>
              {" feedback-notes "}
              <span className="muted">{"/"}</span>
              {" 工作流"}
            </span>
            <span className="version-chips">
              <span className="chip">{"draft"}</span>
              <span className="chip selected">{"v3 released"}</span>
            </span>
          </div>
          <div className="window-content">
            <aside className="mini-nav" aria-label="示意界面导航">
              <span>{"AG"}</span>
              <span>{"SK"}</span>
              <span className="selected">{"WF"}</span>
              <span>{"RN"}</span>
              <span>{"RS"}</span>
              <b>{"?"}</b>
            </aside>
            <div className="flow-area">
              <div className="canvas-tools mono">
                <span>{"⌖"}</span>
                <span>{"＋"}</span>
                <span>{"−"}</span>
                <span>{"100%"}</span>
              </div>
              <div className="canvas-label mono">
                {"ITERATION NOTES "}
                <span>{"5 NODES"}</span>
              </div>
              <svg className="connections" viewBox="0 0 500 440" aria-hidden="true">
                <path className="finished" d="M210 105 C248 105 230 207 268 207" />
                <path className="finished" d="M444 207 C490 207 490 265 300 265 S20 265 62 330" />
                <path className="current" d="M238 330 C275 330 255 347 295 347" />
                <path className="future" d="M471 347 C500 347 500 390 260 390 S0 390 37 437" />
                <circle r="3" fill="var(--accent)">
                  <animateMotion dur="3s" repeatCount="indefinite" path="M238 330 C275 330 255 347 295 347" />
                </circle>
              </svg>
              <button
                className="flow-node done"
                data-node="N-01"
                style={{ "--x": "34px", "--y": "65px" } as CSSProperties}
                type="button"
                aria-label="输入任务：topic · Agent 运行反馈"
              >
                <span className="port in" />
                <span className="node-top mono">
                  {"N-01"}
                  <i className="status-dot done" />
                </span>
                <span className="node-title">
                  <span className="node-symbol" aria-hidden="true">
                    {"↳"}
                  </span>
                  {"输入任务"}
                </span>
                <span className="node-sub">{"topic · Agent 运行反馈"}</span>
                <span className="port out" />
              </button>
              <button
                className="flow-node done"
                data-node="N-02"
                style={{ "--x": "268px", "--y": "167px" } as CSSProperties}
                type="button"
                aria-label="收集资料：extract-entities · v4"
              >
                <span className="port in" />
                <span className="node-top mono">
                  {"N-02"}
                  <i className="status-dot done" />
                </span>
                <span className="node-title">
                  <span className="node-symbol" aria-hidden="true">
                    {"⌕"}
                  </span>
                  {"收集资料"}
                </span>
                <span className="node-sub">{"extract-entities · v4"}</span>
                <span className="port out" />
              </button>
              <button
                className="flow-node active"
                data-node="N-03"
                style={{ "--x": "62px", "--y": "290px" } as CSSProperties}
                type="button"
                aria-label="整理内容：summarize-thread · v2"
              >
                <span className="port in" />
                <span className="node-top mono">
                  {"N-03"}
                  <i className="status-dot active" />
                </span>
                <span className="node-title">
                  <span className="node-symbol" aria-hidden="true">
                    {"≡"}
                  </span>
                  {"整理内容"}
                </span>
                <span className="node-sub">{"summarize-thread · v2"}</span>
                <span className="port out" />
              </button>
              <button
                className="flow-node waiting"
                data-node="N-04"
                style={{ "--x": "295px", "--y": "307px" } as CSSProperties}
                type="button"
                aria-label="人工确认：等待本次运行确认"
              >
                <span className="port in" />
                <span className="node-top mono">
                  {"N-04"}
                  <i className="status-dot waiting" />
                </span>
                <span className="node-title">
                  <span className="node-symbol" aria-hidden="true">
                    {"Ⅱ"}
                  </span>
                  {"人工确认"}
                </span>
                <span className="node-sub">{"等待本次运行确认"}</span>
                <span className="port out" />
              </button>
              <button
                className="flow-node pending"
                data-node="N-05"
                style={{ "--x": "37px", "--y": "397px" } as CSSProperties}
                type="button"
                aria-label="输出结果：iteration-notes.md"
              >
                <span className="port in" />
                <span className="node-top mono">
                  {"N-05"}
                  <i className="status-dot pending" />
                </span>
                <span className="node-title">
                  <span className="node-symbol" aria-hidden="true">
                    {"↗"}
                  </span>
                  {"输出结果"}
                </span>
                <span className="node-sub">{"iteration-notes.md"}</span>
                <span className="port out" />
              </button>
              <div className="canvas-bottom mono">
                <span>
                  <i className="status-dot active" />
                  {" 运行中"}
                </span>
                <span>{"RUN / 008"}</span>
              </div>
            </div>
            <aside className="runtime-pane">
              <div className="pane-label mono">
                <i className="status-dot active" />
                {" RUNTIME EVENTS"}
              </div>
              <div className="mock-events">
                <div className="mock-event" data-event="N-01">
                  <time>{"00:00"}</time>
                  <span>
                    {"run.started"}
                    <b>{"feedback-notes"}</b>
                  </span>
                </div>
                <div className="mock-event" data-event="N-02">
                  <time>{"00:01"}</time>
                  <span>
                    {"tool.call"}
                    <b>{"web.search"}</b>
                  </span>
                </div>
                <div className="mock-event" data-event="N-02">
                  <time>{"00:02"}</time>
                  <span>
                    {"tool.return"}
                    <b>{"12 items"}</b>
                  </span>
                </div>
                <div className="mock-event" data-event="N-02">
                  <time>{"00:03"}</time>
                  <span>
                    {"skill.run"}
                    <b>{"extract-entities v4"}</b>
                  </span>
                </div>
                <div className="mock-event" data-event="N-03">
                  <time>{"00:04"}</time>
                  <span>
                    {"skill.run"}
                    <b>{"summarize-thread v2"}</b>
                  </span>
                </div>
                <div className="mock-event" data-event="N-03">
                  <time>{"00:06"}</time>
                  <span>
                    {"artifact.write"}
                    <b>{"draft-1"}</b>
                  </span>
                </div>
              </div>
              <div className="output-preview">
                <div className="pane-label mono">{"OUTPUT PREVIEW"}</div>
                <div className="file-label">{"▤ iteration-notes.md"}</div>
                <p>{"本周 Agent 运行反馈"}</p>
                <span className="mono">{"缺陷 5 · 需求 4 · 疑问 3"}</span>
                <div className="preview-lines">
                  <i />
                  <i />
                  <i />
                </div>
                <span className="output-status mono">{"● draft-1 · 已生成"}</span>
              </div>
            </aside>
          </div>
          <div className="window-footer mono">
            <span>{"已保存草稿"}</span>
            <span>{"Agent + Skills + Workflows"}</span>
          </div>
        </div>
        <p className="mock-caption mono">
          {"界面示意 · INTERFACE MOCKUP "}
          <span>{"每一步，都有迹可循。"}</span>
        </p>
      </div>
    </section>
  );
}
