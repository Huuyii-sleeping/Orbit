/** 保留 A 版深色段落，以三条控制说明替代重复的日志和配置代码。 */
export function LandingDevelopers() {
  return (
    <section className="developers control-section section" id="developers" aria-labelledby="control-title">
      <div className="container developer-grid">
        <div className="developer-copy reveal">
          <div className="eyebrow">
            <span />
            YOU STAY IN CONTROL
          </div>
          <h2 id="control-title">
            交给助手，
            <br />
            也留在你的掌握里。
          </h2>
        </div>
        <dl className="control-points reveal">
          <div>
            <dt>
              <i className="status-dot done" />
              看得见过程
            </dt>
            <dd>查看工具调用、执行事件和结果，知道每一步发生了什么。</dd>
          </div>
          <div>
            <dt>
              <i className="status-dot waiting" />
              重要一步，等你确认
            </dt>
            <dd>在工作流中加入人工确认节点，需要你判断时，先停下来。</dd>
          </div>
          <div>
            <dt>
              <span className="control-version mono">v3</span>满意的做法，固定下来
            </dt>
            <dd>发布版本固定配置。继续修改草稿，也不会改变已发布的版本。</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
