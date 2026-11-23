/** 将已知模型额度错误解释为可操作提示；原始错误由试跑面板另外保留。 */
export function agentRunErrorMessage(message: string) {
  if (/AllocationQuota\.FreeTierOnly|Free quota exhausted/i.test(message)) {
    return "当前模型的免费额度已用尽，且账户仅允许使用免费额度。请更换模型连接；继续使用此服务需到服务商控制台检查额度和计费设置。";
  }
  return message;
}
