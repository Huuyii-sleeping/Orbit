/** 工作台保存的模型连接输入；apiKey 只在写入请求中传输。 */
export type ModelConnectionInput = {
  name: string;
  provider: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
};

/** 模型连接的公开摘要，绝不返回凭据。reference 用于 Agent 配置和版本快照。 */
export type ModelConnectionSummary = Omit<ModelConnectionInput, "apiKey"> & {
  id: string;
  reference: string;
  hasApiKey: boolean;
  createdAt: number;
  /** 删除仅隐藏可选配置，保留已有引用与恢复能力。 */
  deletedAt?: number;
  /** 旧修订仍可运行；编辑草稿可据此提示升级。 */
  previousReferences?: string[];
};

/** 模型选择目录，同时保留部署中已配置的模型别名。 */
export type ModelConnectionCatalog = {
  connections: ModelConnectionSummary[];
  deletedConnections?: ModelConnectionSummary[];
  configuredModels: string[];
  defaultModel: string;
};

/** 编辑时提交当前引用以检测冲突；空密钥保留原值，清除需显式指定。 */
export type ModelConnectionUpdate = ModelConnectionInput & {
  reference: string;
  clearApiKey?: boolean;
};

/** 删除或恢复必须携带最新修订引用，避免操作过期页面。 */
export type ModelConnectionLifecycleInput = { reference: string };
