/** 前端统一错误分类。 */
export type AppErrorKind =
  | "network"
  | "timeout"
  | "canceled"
  | "authentication"
  | "permission"
  | "not-found"
  | "conflict"
  | "validation"
  | "rate-limit"
  | "unavailable"
  | "server"
  | "invalid-response"
  | "storage"
  | "unsupported"
  | "unknown";

/** 仅由前端维护的展示文案；不得用服务端消息填充。 */
export interface ErrorDescription {
  kind: AppErrorKind;
  title: string;
  message: string;
  retryable: boolean;
}

/** 各类错误的默认提示和操作建议。 */
export const errorDescriptions: Record<AppErrorKind, ErrorDescription> = {
  network: {
    kind: "network",
    title: "连接失败",
    message: "无法连接服务，请检查网络连接后重试。",
    retryable: true,
  },
  timeout: {
    kind: "timeout",
    title: "等待超时",
    message: "服务响应时间过长，请稍后重试。",
    retryable: true,
  },
  canceled: {
    kind: "canceled",
    title: "操作已取消",
    message: "操作已取消，可以重新发起。",
    retryable: false,
  },
  authentication: {
    kind: "authentication",
    title: "需要登录",
    message: "登录状态已失效，请重新登录后再试。",
    retryable: false,
  },
  permission: {
    kind: "permission",
    title: "没有操作权限",
    message: "当前账户没有权限执行此操作，请联系管理员。",
    retryable: false,
  },
  "not-found": {
    kind: "not-found",
    title: "内容不存在",
    message: "要访问的内容不存在或已被删除，请刷新列表。",
    retryable: false,
  },
  conflict: {
    kind: "conflict",
    title: "内容已更新",
    message: "内容已发生变化，请刷新后再操作。",
    retryable: false,
  },
  validation: {
    kind: "validation",
    title: "请检查输入",
    message: "提交的内容不符合要求，请检查填写内容后重试。",
    retryable: false,
  },
  "rate-limit": {
    kind: "rate-limit",
    title: "操作过于频繁",
    message: "请求过于频繁，请稍等片刻再试。",
    retryable: true,
  },
  unavailable: {
    kind: "unavailable",
    title: "服务暂不可用",
    message: "服务暂时无法连接，请稍后重试。",
    retryable: true,
  },
  server: {
    kind: "server",
    title: "服务异常",
    message: "服务暂时出现问题，请稍后重试。",
    retryable: true,
  },
  "invalid-response": {
    kind: "invalid-response",
    title: "响应异常",
    message: "收到的数据格式不正确，请刷新页面后重试。",
    retryable: true,
  },
  storage: {
    kind: "storage",
    title: "保存失败",
    message: "无法保存数据，请检查可用存储空间后重试。",
    retryable: false,
  },
  unsupported: {
    kind: "unsupported",
    title: "浏览器不支持",
    message: "当前浏览器不支持此功能，请使用最新版浏览器。",
    retryable: false,
  },
  unknown: {
    kind: "unknown",
    title: "操作未完成",
    message: "操作未能完成，请重试；如果仍有问题，请联系维护人员。",
    retryable: true,
  },
};

/** 已知业务错误码，文案优先于 HTTP 通用分类。新增错误只在此维护映射。 */
export const domainErrors: Record<
  string,
  { kind: AppErrorKind; message: string }
> = {
  AGENT_UPSTREAM_UNAVAILABLE: {
    kind: "unavailable",
    message: "Agent 运行服务尚未连接，请启动服务后重试。",
  },
  AGENT_NOT_FOUND: {
    kind: "not-found",
    message: "这个 Agent 已不存在，请刷新列表后重新选择。",
  },
  AGENT_VERSION_NOT_FOUND: {
    kind: "not-found",
    message: "所选 Agent 版本不存在，请重新选择版本。",
  },
  AGENT_SKILL_BINDING_INVALID: {
    kind: "validation",
    message: "Agent 绑定的技能不可用，请检查技能安装状态与版本。",
  },
  AGENT_SKILL_PREFLIGHT_FAILED: {
    kind: "validation",
    message: "Agent 技能检查未通过，请检查绑定技能的安装状态与版本。",
  },
  AGENT_SKILL_LOAD_FAILED: {
    kind: "validation",
    message: "Agent 技能加载失败，请检查绑定技能的安装状态与版本。",
  },
  SKILL_PACKAGE_NOT_FOUND: {
    kind: "not-found",
    message: "所需技能包不存在，请重新安装技能。",
  },
  SKILL_NOT_INSTALLED: {
    kind: "validation",
    message: "所需技能尚未安装，请先安装后再试。",
  },
  VERSION_MISMATCH: {
    kind: "validation",
    message: "技能版本与绑定版本不一致，请重新选择已安装的版本。",
  },
  SOURCE_MISMATCH: {
    kind: "validation",
    message: "技能来源与绑定配置不一致，请重新绑定技能。",
  },
  REGISTRY_SOURCE_MISMATCH: {
    kind: "validation",
    message: "技能仓库与绑定配置不一致，请检查技能来源。",
  },
  SKILL_NOT_FOUND: {
    kind: "not-found",
    message: "这个技能已不存在，请刷新技能列表。",
  },
  SKILL_PACKAGE_INVALID: {
    kind: "validation",
    message: "技能包格式不符合要求，请检查技能文件后重新上传。",
  },
  SKILL_LIFECYCLE_BUSY: {
    kind: "conflict",
    message: "有技能操作正在进行，请等待完成后再试。",
  },
  SKILL_DOWNLOAD_FAILED: {
    kind: "unavailable",
    message: "技能下载失败，请检查网络与技能仓库连接后重试。",
  },
  SKILL_UPDATE_NOT_AVAILABLE: {
    kind: "not-found",
    message: "这个技能暂时没有可用更新，请刷新列表确认。",
  },
  SKILL_ROLLBACK_NOT_AVAILABLE: {
    kind: "not-found",
    message: "这个技能没有可回退的版本。",
  },
  REMOTE_REGISTRY_SYNC_FAILED: {
    kind: "unavailable",
    message: "技能仓库连接失败，请检查仓库地址与网络后重试。",
  },
  SOP_NOT_FOUND: {
    kind: "not-found",
    message: "这份工作流已不存在，请刷新工作流列表。",
  },
  AGENT_REVISION_CONFLICT: {
    kind: "conflict",
    message: "这个 Agent 已被其他窗口更新。当前修改仍保留，请先复制需要保留的内容，再刷新最新配置。",
  },
  AGENT_REVISION_INVALID: {
    kind: "validation",
    message: "Agent 修订号无效，请刷新配置后重试。",
  },
  SOP_REVISION_CONFLICT: {
    kind: "conflict",
    message: "这份工作流已被更新，请加载最新版本或合并修改后再保存。",
  },
  SOP_VALIDATION_FAILED: {
    kind: "validation",
    message: "工作流校验未通过，请检查节点配置、连线和必填项。",
  },
  SOP_STORAGE_FAILED: {
    kind: "storage",
    message: "工作流保存服务暂不可用，请保留当前编辑内容，稍后再试。",
  },
  CHAT_STREAM_FAILED: {
    kind: "unavailable",
    message: "回复传输中断，请稍后重新发送消息。",
  },
  INVALID_RESPONSE: {
    kind: "invalid-response",
    message: errorDescriptions["invalid-response"].message,
  },
  BROWSER_UNSUPPORTED: {
    kind: "unsupported",
    message: errorDescriptions.unsupported.message,
  },
};
