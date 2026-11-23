# 发布检查

在仓库根目录执行：

```bash
pnpm build
pnpm test
pnpm check:workflow-boundaries
pnpm check:structure
pnpm --filter agent-cli lint
```

涉及运行链路时，再执行相应 smoke，例如：

```bash
pnpm --filter agent-cli test:workflow
pnpm --filter agent-cli test:service-api
pnpm --filter agent-cli test:daemon
```

`pnpm release:check` 保留完整 Agent 专项检查；此命令会清理 Agent 工作目录中的运行数据，只在独立验证环境使用。

验证后仅清理本次生成的产物，检查 Git diff，等待用户验收。不依赖额外的规划 CLI 或开发技能。
