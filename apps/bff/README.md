# BFF

Orbit 产品 API：管理 Agent、技能、SOP、运行记录和工作区配置，并代理 Agent 执行请求。

在仓库根目录执行：

```bash
pnpm dev:bff
pnpm test:bff
pnpm build:bff
```

默认监听 `3182`。环境变量、数据目录和完整启动步骤见根 [README](../../README.md)，模块职责见[架构说明](../../docs/architecture.md#bff)。

`src/app.module.ts` 装配领域模块，`storage/` 统一创建本地存储与产品数据库；业务规则归各领域 Service，持久化归 Repository。`entrypoints/sops-admin.ts` 提供数据库健康检查、备份和恢复，分别使用 `pnpm --filter agent-bff sops:health`、`sops:backup`、`sops:restore`。

测试分为 `test/unit/` 的模块测试和 `test/smoke/` 的 API、跨模块验证；测试使用独立临时数据目录。

生产 SaaS 的 OIDC、组织 claim、共享会话库、同源请求和接口开放范围见 [身份部署说明](../../docs/saas-identity.md)。BFF 使用 `@orbit/service-auth` 调用 Agent，浏览器不会接触内部令牌。
