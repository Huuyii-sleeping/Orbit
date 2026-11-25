/** 将已知运行错误解释为可操作提示；原始错误由试跑面板另外保留。 */
export function agentRunErrorMessage(message: string) {
  if (/AllocationQuota\.FreeTierOnly|Free quota exhausted/i.test(message)) {
    return "当前模型的免费额度已用尽，且账户仅允许使用免费额度。请更换模型连接；继续使用此服务需到服务商控制台检查额度和计费设置。";
  }
  if (/incorrect api key|invalid[_ -]api[_ -]key|authentication fail|invalid authentication|unauthorized/i.test(message))
    return "模型服务未通过身份验证。请检查模型配置的 API Key、API 地址及密钥权限，保存后选择最新配置再试跑。";
  if (/insufficient[_ ]quota|insufficient balance|credit balance|余额不足|额度.*(?:不足|耗尽)/i.test(message))
    return "当前模型账户余额或额度不足。请在对应模型服务商检查计费与限额，或更换模型连接后重试。";
  if (/rate.?limit|too many requests/i.test(message))
    return "模型请求过于频繁。请稍后重试，或检查服务商的并发和速率限制；这不一定表示余额不足。";
  if (/timed? ?out|timeout|节点执行超过|超时/i.test(message))
    return "本次 Agent 执行超时。请检查模型服务连接，缩小任务后重试，或更换响应更快的模型。";
  if (/输出不符合发布版本 schema|WORKFLOW_AGENT_OUTPUT_SCHEMA_INVALID/i.test(message))
    return "Agent 已返回结果，但结果不符合配置的输出格式。请检查高级输出配置与职责要求，再重新试跑；详情中保留了字段校验信息。";
  if (/Agent 工具不可用/i.test(message))
    return "配置的工具当前不可用。请刷新能力列表，检查工具安装与授权后保存并重新试跑。";
  return message;
}
