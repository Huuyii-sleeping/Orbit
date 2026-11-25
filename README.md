# Orbit

一体化 AI Agent 工作台：配置 Agent、管理技能、编排 SOP、测试运行和发布版本。

当前开发顺序、阶段状态与验收标准见 [开发路线](docs/development-roadmap.md)。

## 项目结构

| 目录 | 职责 |
| --- | --- |
| `apps/web-console` | React + Vite 界面：Agent、聊天、Skill Hub、SOP、设置 |
| `apps/bff` | NestJS 产品 API，管理配置与版本，代理运行请求 |
| `apps/agent-cli` | Agent 服务、Mastra Runtime，以及 CLI/TUI/MCP/Daemon 入口 |
| `apps/skill-registry` | 独立技能仓库，管理技能包、版本和下载 |
| `packages/workflow-core` | 工作流模型、节点注册、校验和编译 |
| `packages/runtime-contracts` | Agent、Workflow、Tool、Memory 运行接口 |
| `packages/service-auth` | BFF 与 Agent 服务之间的受信令牌和同源地址校验 |
| `skills` / `registries` | 产品内置技能与仓库种子数据 |
| `examples/python` / `examples/typescript` | 独立教学示例，不参与生产构建 |
| `docs/architecture.md` | 当前目录职责与依赖边界 |

调用链：

```text
Web → BFF → Agent Service → Runtime Ports → Mastra → 模型 / 工具 / Memory
```

Web 只访问 BFF 的 `/api/*`。产品层使用共享契约，Mastra 的内部类型和执行状态留在运行时适配层。生产运行时锁定为 `@mastra/core@1.52.1`。

对外 SaaS 的认证、租户隔离现状和部署要求见 [SaaS 身份说明](docs/saas-identity.md)。当前 SaaS 模式仅开放已隔离的身份和个人配置接口，其余业务接口会拒绝访问。

服务端按进程内模块组织，现有部署和端口保持不变：

| BFF 模块目录 | 职责与依赖 |
| --- | --- |
| `workspace/` | 个人资料和界面设置，只依赖本地存储 |
| `sessions/` | 会话、聊天和消息流，只依赖 Runtime 连接 |
| `runtime-connection/` | 共享上游连接、健康检查、审计、安全和事件代理 |
| `skills/` | 技能目录、安装和校验，对 Agent 导出目录服务 |
| `agents/` | Agent 配置、版本和试跑，复用技能与工作流运行服务 |
| `sops/`、`workflow-runs/` | SOP 定义与运行控制，共享产品 SQLite |

`AppModule` 只组装模块和共享资源；领域模块显式声明依赖，不使用全局业务 provider。Agent 服务的 `services/chat-service.ts` 负责聊天会话和执行生命周期，`service-api/index.ts` 保留宿主门面，`mastra/` 负责模型与执行框架适配。供应商协议转换集中在 `mastra/models/`，Agent、SOP 和子 Agent 共用模型解析。

依赖创建统一放在装配边界：

- BFF 的 `storage/` 创建本地存储和产品数据库；Agent 版本仓库单独提供，SOP 与运行控制复用仓库契约，不重新注册 SQLite 实现。
- Agent 的 `bootstrap/app-runtime.ts` 组装配置与基础服务，`bootstrap/mastra-service.ts` 连接 Mastra 和运行端口；启动配置不携带 OpenAI 客户端。
- `AgentHost` 只接收会话存储；HTTP 领域模块显式导入运行依赖，按聊天、工具、技能、会话和事件注入所需能力。
- 会话与远程客户端复用 `runtime-contracts` 的消息类型；SDK 协议类型留在需要它们的适配或工具代码中。

## 启动

需要 Node.js 22+、pnpm 10.18.3，以及可访问的模型服务。

```bash
pnpm install --frozen-lockfile
```

可在启动后的「设置 → 模型配置」配置模型，并在 Agent 中选择。也可在 `apps/agent-cli/.env` 配置系统默认模型：

```dotenv
MODEL_ID=your-model-id
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://your-model-endpoint/v1
```

分别在四个终端运行：

```bash
pnpm dev:skill-registry
pnpm --filter agent-cli dev:server
pnpm dev:bff
pnpm dev:web
```

| 服务 | 默认地址 |
| --- | --- |
| Web | http://127.0.0.1:5173 |
| BFF | http://127.0.0.1:3182 |
| Agent Service | http://127.0.0.1:3181 |
| Skill Registry | http://127.0.0.1:3190 |

终端 Agent 使用 `pnpm dev:agent`；Ink TUI 也可使用 `pnpm --filter agent-cli dev:tui-ink`。技能仓库可用 `pnpm docker:skill-registry` 启动。

交互式 CLI/TUI 可以在未配置模型时启动，通过 `/model <模型引用>` 激活；`--print` 单次执行仍要求先配置模型。终端自然语言请求经 `AgentService → RuntimeGateway → Mastra` 执行，斜杠命令和界面渲染留在 CLI 层。`/model` 切换复用现有工具和会话宿主，装配失败时保留原配置；连接 daemon 时由 daemon 管理模型。

`/model` 在切换前校验本地模型引用、凭据与工具能力，不调用上游；模型是否存在、密钥权限与额度仍以实际提问结果为准。`/compact [最近消息数]` 使用当前模型总结旧上下文，再通过 Mastra Memory 创建保留最近完整回合的新线程；会消耗一次模型请求。摘要持续参与后续推理，原始线程和终端历史保留，重启后继续使用新的线程。摘要、存储或配置持久化失败时保留原线程，不需要压缩时不调用模型。daemon 模式在服务端完成同样操作。

## 配置与数据

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `AGENT_HTTP_PORT` | `3181` |
| `AGENT_HTTP_HOST` | 默认 `127.0.0.1`；对外监听必须配置服务令牌 |
| `AGENT_SERVICE_TOKEN` | BFF 与 Agent 服务共用的内部 Bearer 令牌；生产必填，不传给浏览器 |
| `BFF_PORT` | `3182` |
| `AGENT_SERVICE_BASE_URL` | `http://127.0.0.1:3181` |
| `SKILL_REGISTRY_PORT` | `3190` |
| `SKILL_REGISTRY_SERVICE_URL` | `http://127.0.0.1:3190` |
| `SKILL_REGISTRY_ADMIN_TOKEN` | Registry 管理凭据；生产部署必须覆盖本地开发默认值 |
| `VITE_BFF_URL` | Vite `/api` 代理目标，默认 `http://127.0.0.1:3182` |
| `SKILLHUB_DATA_ROOT` | BFF 技能目录，默认 `<cwd>/.data/skills` |
| `SOP_DATA_ROOT` | 产品 SQLite 目录，默认 `<cwd>/.data/sops` |
| `BFF_MODE` | 开发默认 `local`，生产强制 `saas`；OIDC 参数见 SaaS 身份说明 |
| `SKILL_REGISTRY_DATA_ROOT` | Registry 数据目录，默认 `<cwd>/runtime/skill-registry` |

Mastra 的 Memory 和 snapshot 使用 LibSQL，数据位于 `<cwd>/.runtime/mastra/v1/`。BFF 产品配置与 Runtime 执行状态分开存储；Skill Hub 安装目录必须与 Agent 读取目录一致。路径以服务进程工作目录为基准，切换启动方式时应显式配置共享目录。

模型、安全、保留期和隐私选项见 `apps/agent-cli/src/config/runtime-config.ts`。运行数据、`.env` 和凭据不提交到 Git。

## 多模型接入

Agent 详情分为「配置」「试跑」「版本」三个页签；切换页签保留未保存的草稿和测试输入。配置按基本信息、职责、模型、能力和高级配置分区，场景、颜色和标签收在展示设置中。

工作台可在「设置 → 模型配置」或 Agent 的「添加模型」弹窗中选择接口格式，填写模型 ID、API 地址和 API Key。支持 OpenAI 兼容、Anthropic Messages、Google Gemini，内部仍使用 Mastra 内置供应商解析；旧供应商配置继续兼容。OpenAI 兼容格式需要 API 地址，原生格式可使用默认地址，连接名称留空时使用模型 ID。保存后立即可供 Agent 选择，无需重启；保存连接本身不会调用模型。可在设置中编辑模型、地址与密钥；密钥留空保留原值，也可显式清除。编辑生成新修订，在 Agent 中切换至最新配置后保存并试跑；既有发布版本仍引用原修订。模型配置支持删除和恢复：删除仅将其从可选目录移除，保留凭据及已有 Agent、发布版本的引用；在「已删除配置」中恢复后可重新选择。

密钥使用本机密钥文件加密保存于 Agent 服务工作目录的 `.runtime/model-connections/`，目录不纳入 Git；备份或迁移时需要同时保留连接文件和密钥文件。公开目录、Agent 草稿和版本仅包含连接引用，不包含 API Key。本机加密不能防止拥有该目录读取权限的用户解密。

新建 Agent 的名称和职责必填，其余说明可以留空。可用能力默认不授权，内部管理工具收在高级工具中；输出默认使用内置文本契约，自定义 JSON Schema 在高级输出配置中编辑。操作标签只作展示，不执行工具或 SOP。

独立试跑和 SOP Agent 节点使用对应草稿或固定版本的职责、输出约束及绑定技能，不继承 CLI 默认的编码助手身份和能力提示。未提供显式 system 指令的宿主对话继续使用默认提示词。

模型接入直接使用 Mastra 内置 `ModelsDevGateway` 和供应商注册表。Orbit 仅处理连接配置、模型别名与产品能力约束，不维护供应商 SDK 工厂或协议 Adapter。普通 Agent、SOP LLM 节点和子 Agent 使用同一个解析入口。

标准供应商可直接填写 Mastra 的模型引用，如 `openai/gpt-4.1`、`anthropic/claude-sonnet-4-5`、`google/gemini-2.5-flash`、`deepseek/deepseek-chat`。供应商、地址及默认密钥环境变量由当前 Mastra 版本的注册表提供，实际模型可用性由供应商账户决定。

旧部署的裸模型 ID（如 `qwen-plus`）继续读取 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL`（兼容 `OPENAI_BASEURL`），仅作为默认 Chat 兼容连接。配置多连接或自定义地址时，参考 [models.example.json](apps/agent-cli/models.example.json)：

```dotenv
MODEL_CONFIG_FILE=/absolute/path/to/models.local.json
MODEL_PROVIDER=qwen
MODEL_ID=writer
DASHSCOPE_API_KEY=your-key
ANTHROPIC_API_KEY=your-other-key
```

配置文件的 `providers` 定义连接：`provider` 填 Mastra 供应商 ID，`baseUrl` 和 `apiKeyEnv` 可覆盖其默认连接。通用 Chat 兼容端点填写 `provider: "openai-compatible"` 并提供 `baseUrl`；省略 `apiKeyEnv` 可连接无认证本地服务。原生协议自定义地址同样由 Mastra Gateway 解析，不通过会强制变为 Chat 协议的模型对象 `url` 字段接入。

`models` 定义模型别名及 `supportsTools`、`supportsTemperature` 约束；`providerOptions` 按框架原样下发，具体可用字段以 Mastra 内置 SDK 为准。OpenAI 的 Chat Completions 和 Responses 接口选择由供应商注册信息决定，不作为两个项目 Adapter 暴露。旧版试验配置中的 `protocol`、`includeUsage` 已移除，请改为示例中的供应商配置。修改配置后重启 Agent 服务。

流式用量统计由框架与上游共同决定：通用兼容 Gateway 不主动请求 `stream_options`，部分服务可能不返回 token 用量。未返回的用量不表示零消耗。协议接入也不保证模型支持工具或原生 JSON Schema；工作流仍在输出后校验发布版本 schema，不自动修复格式。显式 Agent 模型与全局 `MODEL_CODING` 策略冲突时会报错。

```bash
# 无云端调用：Mastra 原生供应商工厂对接本地协议端点
pnpm --filter agent-cli test:models
# 显式云端调用，会消耗供应商额度；使用内存测试数据
pnpm --filter agent-cli test:models:live writer reviewer
```

MCP 客户端与服务端统一使用 `@mastra/mcp`，握手、工具 schema 转换和标准 stdio 传输交给框架。Orbit 保留信任名单、工具白名单、并发限制、鉴权状态、审批与脱敏。MCP 操作统一使用连接的 `requestTimeoutMs`，不再执行旧客户端独立的 `startupTimeoutMs` 计时逻辑。stdio 使用标准逐行 JSON，已移除历史 Content-Length 私有帧；业务错误通过标准 MCP `isError` 返回。

## 产品边界

- Agent 草稿可编辑，发布版本不可变；生产 SOP 和 Agent 节点绑定固定版本。
- Workflow 用于构成 Agent 能力；Human Approval 是单次 run 的暂停与恢复，不建立全局审批系统。
- Mastra snapshot 是执行状态的权威来源；BFF 仅保存必要的运行投影。
- 当前开放 Iteration、Loop、Subworkflow、Agent、Human Approval 和重启恢复。
- `parallelMerge` 暂时关闭：当前 Mastra 版本无法满足活动 sibling 的 fail-fast 取消语义，含该能力的草稿不能发布或生产运行。
- Runtime 只有 Mastra，不能通过自建 fallback 引入第二套执行引擎。

主要 BFF API：`/api/agents`、`/api/agent-versions`、`/api/sessions`、`/api/skills`、`/api/sops`、`/api/workflow-runs`。运行控制支持查询、SSE 事件、取消和按 run 恢复。

## 开发与验证

直接阅读相关源码和测试，明确目标后实施小步修改；不要求生成 proposal、design、tasks 或归档流程。项目规则统一维护在 [AGENTS.md](AGENTS.md)。仓库不保留历史 PRD 和 OpenSpec 流程文件。当前目录与依赖边界见 [架构说明](docs/architecture.md)。

```bash
pnpm build
pnpm test
pnpm check:workflow-boundaries
pnpm check:structure
```

修改单个功能时先运行相关包测试，例如 `pnpm --filter agent-web-console test`。Agent 发布检查见 [RELEASE_CHECKLIST.md](apps/agent-cli/RELEASE_CHECKLIST.md)。

完成后汇报改动和验证结果，用户验收后才提交；不自动 push。
