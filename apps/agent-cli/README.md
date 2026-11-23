# Agent Runtime

本目录提供 Orbit 的 Agent 服务和 CLI/TUI/MCP/Daemon 入口。配置与完整启动步骤见[项目 README](../../README.md)。

## 代码入口

- `src/main.ts`、`src/entrypoints/`：终端与后台服务入口。
- `src/bootstrap/`：配置、基础服务和 Mastra 运行端口的装配；入口显式传递配置，不通过宿主反向获取依赖。
- `src/nest/`：NestJS Host、内部 HTTP API 和 Runtime Port 装配。
- `src/service-api/`、`src/host/`：会话、远程客户端与宿主门面；HTTP 启动入口位于 `src/entrypoints/server.ts`。
- `src/services/chat-service.ts`：独立的聊天与会话业务，通过 Agent / Memory Port 执行；不负责模型供应商接入。
- `src/services/tool-call-service.ts`、`agent-skill-service.ts`：HTTP 与终端共用的工具调用和技能解析；宿主门面只转发请求。
- `src/mastra/`：共享 Mastra 实例，以及 Agent、Workflow、Memory、Tool 适配器；`models/` 薄封装 Mastra 内置模型 Gateway，不维护自定义协议 Adapter。
- `src/tools/`：公共工具协议与执行入口；MCP、安全、子 Agent、任务、定时调度、团队、工作目录和后台任务各自成目录。
- `src/skills/`：技能发现与加载。
- `src/config/`、`src/models/`：环境与模型连接配置、模型预算策略。
- `src/security/`、`src/lib/`：工作目录与数据安全、公共时间工具。
- `src/workflows/executors/`：工作流节点执行逻辑。
- `test/unit/`：按源码目录镜像组织单测；`test/smoke/`：跨模块和集成回归。

生产执行统一经过 `RuntimeGateway` 的四类 Port；不新增其他 Runtime，也不在适配器中维护第二套调度器或 snapshot 引擎。

`AgentHost` 仅管理会话存储与事件，不保存模型客户端或应用服务容器。Nest 各领域模块显式导入运行依赖，不依赖全局注入；模型 SDK 客户端不属于启动配置。

## 常用命令

在仓库根目录执行：

```bash
pnpm dev:agent
pnpm --filter agent-cli dev:server
pnpm --filter agent-cli dev:tui-ink
pnpm --filter agent-cli test
pnpm --filter agent-cli test:workflow
pnpm --filter agent-cli test:harness
pnpm --filter agent-cli test:models
```

MCP 传输与工具转换使用 `@mastra/mcp`，产品信任、审批与并发规则留在 `src/tools/mcp/`。

模型连接配置见 `src/config/model-config.ts`，运行策略见 `src/config/runtime-config.ts`。开发规则统一读取根目录 [AGENTS.md](../../AGENTS.md)。
