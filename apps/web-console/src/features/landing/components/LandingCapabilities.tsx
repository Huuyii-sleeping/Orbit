/** A 版落地页的产品能力场景。 */
export function LandingCapabilities() {
  return (
    <section id="capabilities" className="capabilities container section" aria-labelledby="capabilities-title">
      <article className="feature-row reveal">
        <div className="feature-copy">
          <span className="section-index mono">{"MAKE IT YOURS"}</span>
          <h2 id="capabilities-title">
            {"把你的做法，"}
            <br />
            {"留给下一次。"}
          </h2>
          <p>{"告诉助手你希望它怎么做，连接需要的技能。试跑满意后保存配置，让下一次同类任务有个熟悉的起点。"}</p>
          <a className="text-link" href="#demo">
            {"看看它如何运行 "}
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 10h13m-5-5 5 5-5 5" />
            </svg>
          </a>
          <div className="feature-foot mono">{"定义职责 · 连接技能 · 试跑与复用"}</div>
        </div>
        <div className="detail-panel">
          <div className="panel-heading">
            <span>{"研发纪要助手"}</span>
            <span className="chip">{"AGENT / 01"}</span>
          </div>
          <div className="config-tabs" role="tablist" aria-label="Agent 配置示意">
            <button role="tab" aria-selected="true" data-config="0">
              {"提示词"}
            </button>
            <button role="tab" aria-selected="false" data-config="1">
              {"模型"}
            </button>
            <button role="tab" aria-selected="false" data-config="2">
              {"工具"}
            </button>
            <button role="tab" aria-selected="false" data-config="3">
              {"技能"}
            </button>
            <button role="tab" aria-selected="false" data-config="4">
              {"输出格式"}
            </button>
          </div>
          <div className="config-body">
            <div className="config-content" data-config-panel>
              <span className="mono muted">{"SYSTEM PROMPT"}</span>
              <p>
                {"你是研发纪要助手。"}
                <br />
                {"收集本周 Agent 的运行反馈，按主题整理，"}
                <br />
                {"并输出可用于下一轮迭代的结构化纪要。"}
              </p>
            </div>
            <div className="config-settings">
              <div>
                <span>{"模型"}</span>
                <code>{"openai/gpt-4.1"}</code>
              </div>
              <div>
                <span>{"工具权限"}</span>
                <code>{"按白名单开放"}</code>
              </div>
              <div>
                <span>{"输出格式"}</span>
                <code>{"JSON Schema"}</code>
              </div>
            </div>
            <div className="panel-note mono">
              <i className="status-dot done" />
              {" 配置保存在草稿，发布时固定版本"}
            </div>
          </div>
        </div>
      </article>
      <div className="getting-started" aria-labelledby="getting-started-title">
        <h3 id="getting-started-title">第一次使用</h3>
        <ol>
          <li>
            <span className="mono">01</span>
            <div>
              <h4>告诉它要做什么</h4>
              <p>新建助手，写下职责与要求。</p>
            </div>
          </li>
          <li>
            <span className="mono">02</span>
            <div>
              <h4>选好模型，放入素材</h4>
              <p>选择已配置的连接，填写任务输入。</p>
            </div>
          </li>
          <li>
            <span className="mono">03</span>
            <div>
              <h4>检查结果，下次继续</h4>
              <p>调整到满意，再保存或发布版本。</p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}
