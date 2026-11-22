const questions = [
  {
    title: "第一次使用，需要准备什么？",
    answer:
      "准备一段想处理的文字和一个明确的要求。在工作台新建 Agent，填写职责、选择模型并保存后试跑。当前独立试跑使用 JSON 输入，可以在 task 字段填入任务和素材；编排复杂流程时，需要理解节点与输入输出。",
  },
  {
    title: "模型怎么连接，费用怎么算？",
    answer:
      "当前需要使用部署中已配置的模型，或在「设置 → 模型连接」添加自己的连接。模型调用费用取决于所选服务商和用量。页面内的样例与运行演示不调用模型，不产生模型调用费用。",
  },
  {
    title: "我的内容和 API Key 保存在哪里？",
    answer:
      "当前自部署方式下，配置与运行记录保存在部署环境中；模型密钥由 Agent 服务加密保存，不写入 Agent 草稿或发布版本。实际运行时，任务内容会发送到你选择的模型服务，调用工具时也可能传给对应服务。",
  },
  {
    title: "助手能做什么，由谁决定？",
    answer:
      "由你配置职责、选择技能并授权工具。新建 Agent 默认不授权工具；试跑时可以查看执行过程或取消运行。工作流中的人工确认节点会暂停本次运行，等你确认后继续。",
  },
];

/** 将首次使用的条件集中在原生折叠项，默认保持页面简洁。 */
export function LandingQuestions() {
  return (
    <section className="landing-questions section container" id="questions" aria-labelledby="questions-title">
      <div className="questions-intro">
        <div className="eyebrow">
          <span />
          BEFORE YOU START
        </div>
        <h2 id="questions-title">
          开始前，
          <br />
          你可能想知道。
        </h2>
      </div>
      <div className="question-list">
        {questions.map((question) => (
          <details className="landing-question" key={question.title}>
            <summary>
              {question.title}
              <span aria-hidden="true">＋</span>
            </summary>
            <p>{question.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
