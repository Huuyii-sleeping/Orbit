# 仓库结构与依赖边界

启动命令、环境变量和产品能力见根 [README](../README.md)。开发约束只维护在 [AGENTS.md](../AGENTS.md)。本文件用于定位代码，不维护历史方案或重复操作步骤。

## 仓库入口

```text
orbit/
├── apps/
│   ├── web-console/       # 产品界面
│   ├── bff/               # 产品 API、配置、版本和运行投影
│   ├── agent-cli/         # Agent 执行服务与终端入口
│   └── skill-registry/    # 技能发布、查询和下载
├── packages/
│   ├── workflow-core/     # 工作流模型、校验和编译
│   └── runtime-contracts/ # 框架无关的运行接口
├── skills/                # 产品技能
├── registries/            # 技能仓库种子
├── scripts/               # 仓库与依赖边界检查
├── examples/              # 独立 Python / TypeScript 教学示例
├── docs/                  # 当前架构说明
└── archive/               # 隔离的旧 Runtime 源码，不参与构建
```

`examples/` 保留独立教学代码及原有配置，不属于 pnpm 生产工作区；应用不会引用其中的自研 Agent 循环。`ai-studio-redesign/` 是独立设计稿。`.env*`、各应用的本地数据目录和根 `runtime/` 属于环境与运行数据，不随源码整理迁移。

## 调用关系

```text
Web → BFF → Agent HTTP / RuntimeGateway → Mastra → 模型、工具、Memory
       └→ Skill Registry
```

Web 与 BFF 使用共享契约，不依赖 Mastra DSL 或 snapshot。`workflow-core` 不依赖应用或 UI/服务框架，`runtime-contracts` 定义 Agent、Workflow、Tool、Memory Port。`config/model-config.ts` 读取连接配置；`mastra/models/` 仅映射连接与模型引用，调用 Mastra 内置 `ModelsDevGateway` 和供应商注册表完成 SDK 选择及协议转换。框架适配集中在 Agent 的 `mastra/`；生产只有这一条执行路径。

## Web

| 路径 | 职责 |
| --- | --- |
| `src/main.tsx`、`app/` | React 挂载、导航和应用装配 |
| `src/pages/` | 各业务页面与设计预览入口 |
| `src/features/<domain>/` | Agent、聊天、技能、设置、SOP 的状态、交互和业务组件 |
| `src/components/` | 跨领域的布局和展示组件 |
| `src/api/` | HTTP、SSE、DTO 转换与公共导出 |
| `src/styles/` | 全局主题和样式；领域样式留在对应 feature |

纯逻辑测试与源码相邻，页面通过领域 hook 和 API 模块连接后端。

## BFF

`main.ts` / `server.ts` 启动服务，`AppModule` 组装模块。Controller 处理协议，Service 承载业务，Repository 负责持久化。

| 目录 | 职责 |
| --- | --- |
| `agents/` | Agent 草稿、发布版本、独立试跑 |
| `sessions/` | 会话、聊天和消息流 |
| `skills/` | 技能目录、安装、校验 |
| `sops/` | 工作流草稿、版本、发布规则 |
| `workflow-runs/` | 运行控制、SSE、恢复与运行投影 |
| `workspace/` | 个人资料、界面设置 |
| `runtime-connection/` | Agent 连接、代理与健康状态 |
| `storage/` | 共享本地存储和产品 SQLite 的创建、关闭 |
| `http/` | HTTP 公共适配工具 |
| `entrypoints/` | 数据库管理命令 |

领域模块显式声明依赖，数据库由装配边界创建一次。`test/unit/` 放模块测试，`test/smoke/` 放 HTTP 和跨模块验证。

## Agent

| 目录 | 职责 |
| --- | --- |
| `entrypoints/`、`cli/` | HTTP、Daemon、MCP、CLI、TUI 启动与交互 |
| `bootstrap/` | 配置、基础服务与 Mastra 端口装配 |
| `nest/` | HTTP Controller、领域模块和运行端口注入 |
| `host/`、`service-api/` | 会话宿主、门面与远程客户端 |
| `services/` | 多入口复用的聊天、工具、技能和治理服务 |
| `mastra/` | Agent、Workflow、Memory、Tool 适配与状态存储 |
| `tools/` | 公共协议和执行分发；复杂工具按能力分目录 |
| `workflows/` | 节点执行器与编译上下文 |
| `config/`、`models/` | 环境与连接配置、模型预算策略 |
| `skills/`、`prompt/`、`hooks/` | 技能加载、提示词组装和扩展钩子 |
| `security/`、`audit/`、`observability/`、`governance/` | 权限、数据保护、审计和观测 |
| `delivery/`、`terminal-ui/`、`lib/` | 交付验证、终端展示和公共工具 |

`tools/mcp/`、`security/`、`subagent/`、`tasks/`、`scheduler/`、`team/`、`worktree/`、`background/` 分别管理对应能力。单测在 `test/unit/` 镜像源码目录，集成验证在 `test/smoke/`。

终端代码按以下边界组织，入口及原公共导出路径保留：

| 路径 | 职责 |
| --- | --- |
| `bootstrap/embedded-agent.ts` | CLI、headless 和 TUI 共用的本地宿主初始化与 Mastra 装配 |
| `cli/commands/` | 草稿、审批、会话、运行设置和导航命令；`commands.ts` 负责分发 |
| `cli/ui/` | 主题与排版、帮助、能力目录、运行状态和会话面板；`ui.ts` 负责公共导出 |
| `cli/tui/` | readline 交互、面板、快捷键与面板状态、命令适配，以及两种 TUI 共用的宿主和模型切换 |
| `cli/ink/controller.ts` | Ink 的会话、输入与定时任务控制，不承担组件渲染 |
| `terminal-ui/` | Ink/React 展示组件 |

本地模型切换只替换 Mastra 服务装配，复用工具服务和会话宿主；成功后才更新当前模型及环境。终端不维护独立模型客户端或另一套 Agent 执行循环。

## Skill Registry 与共享包

Registry 的 `main.ts` 负责装配，`http/` 处理协议，`registry/` 维护目录与持久化，`packages/` 处理技能包与校验。

`workflow-core/src/` 按 `contracts`、`registry`、`graph`、`ports`、`variables`、`validation`、`compiler`、`serialization`、`migration` 组织；`runtime-contracts/src/` 按四类运行能力定义接口。共享包保持独立，不反向引用应用实现。

## 结构验证

- `pnpm check:structure` 检查生产源码是否被 Git 忽略，以及相对模块是否存在。
- `pnpm check:workflow-boundaries` 检查共享工作流模型的依赖方向与重复契约。
- `pnpm build` 和 `pnpm test` 验证构建与功能回归。

## 框架能力与产品规则

| 能力 | 执行归属 | Orbit 保留内容 |
| --- | --- | --- |
| 多供应商模型、消息与流式协议 | Mastra 内置供应商 Gateway | 连接配置、别名、能力限制和预算 |
| Agent 推理与工具循环、子 Agent 推理 | Mastra Agent | Agent 版本映射、允许工具、子任务状态与预算 |
| MCP 客户端 / 服务端、stdio 握手及工具转换 | `@mastra/mcp` 与其标准 SDK transport | 信任名单、审批、脱敏、并发和错误分类 |
| 对话历史 | Mastra Memory + LibSQLStore | 产品会话元数据与所有权 |
| SOP 调度、暂停与恢复 | Mastra Workflow / snapshot | 发布校验、IR 编译、节点事件与产品运行投影 |
| 工具上下文的默认观测行为 | Mastra `noopObserve` | 治理审计和事件映射 |

已移除无生产调用的直接 OpenAI 客户端、消息修补器、备用 LLM executor 和旧 Agent recovery 状态机。没有启用第二套重试或恢复引擎。

文件、Bash、任务板、审批和定时工具具有工作目录权限、持久化数据或产品协议，不能用同名框架工具直接等价替换。手动上下文 compact 仍是 TUI 功能，Mastra Memory 的历史窗口不能等价替代它；当前继续保留，不将其宣称为框架自动摘要。Workflow 节点级重试含幂等约束、默认输出和错误路由语义，继续在 IR 适配处保留。
