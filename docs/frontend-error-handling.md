# 前端错误处理

前端通过 `apps/web-console/src/lib/errors/error-factory.ts` 生成可展示错误，不直接展示服务器返回的 `message`、HTML、堆栈或原始异常字符串。

## 处理链路

1. `api/client.ts` 统一捕获网络错误，读取 HTTP/JSON 响应，保留状态码、业务错误码和元数据。
2. `error-factory.ts` 优先匹配已知业务错误码，再匹配 HTTP 状态和浏览器异常；未知异常使用统一中文提示。
3. 页面捕获错误时调用 `getErrorMessage(error)`。不要用 `error.message` 或 `String(error)` 展示未知异常。
4. `AppErrorBoundary` 处理渲染错误、未处理的 Promise 拒绝和全局脚本异常。不会阻止浏览器记录原始错误。

## 类型和文案

工厂返回 `AppError`，包含 `kind`、`title`、`message`、`retryable`、`context` 和原始 `cause`。`retryable` 只表示是否适合重试，不会自动重发请求，避免重复执行保存、发布等操作。

`ApiRequestError` 继承 `AppError`，兼容原有 `status`、`code`、`metadata` 字段。工作流保存冲突仍通过 `metadata.current` 获取远端草稿，转换展示文案不会破坏冲突合并。

| 场景 | 展示示例 |
| --- | --- |
| 网络连接失败 | 无法连接服务，请检查网络连接后重试。 |
| Agent 上游未连接 | Agent 运行服务尚未连接，请启动服务后重试。 |
| HTTP 500，包含 HTML 或内部异常 | 服务暂时出现问题，请稍后重试。 |
| 草稿版本冲突 | 这份工作流已被更新，请加载最新版本或合并修改后再保存。 |
| 超时、权限、登录失效、限流 | 对应分类的原因和下一步操作建议 |
| 返回损坏 JSON | 收到的数据格式不正确，请刷新页面后重试。 |

新增业务错误时，在 `error-catalog.ts` 中维护错误码、分类和中文文案。不要依据任意服务端消息是否为中文来决定透传。

## 本地输入与流式响应

前端自行校验的字段错误可以显式抛出 `UserInputError`，保留具体的字段提示。不得用它包装服务端错误。JSON 等输入解析异常用 `getErrorMessage(error, { source: "input" })` 转换。

流式 HTTP 的非成功响应使用相同的响应解析逻辑；读取中断和 `message.error` 事件也进入工厂。工作流运行错误与 Agent 技能预检的主提示使用工厂文案，业务数据和事件日志保留各自领域含义。

## 页面错误展示

Agent、对话、工作流列表及应用级错误统一使用 `components/feedback/ErrorNotice.tsx`。提示继承页面内容宽度，图标、文案和右侧重试操作使用主题错误色，窄屏允许换行。技能和设置页的全局错误也通过此组件展示；字段校验和工作流冲突操作保留领域布局。

样式集中维护在 `styles/error-notice.css`，不再复用旧版 `agent-error-banner`、普通卡片或状态标签承载页面错误。重试仅绑定既有刷新回调，不自动重复执行保存、发布等操作。

## 验证

- `pnpm --filter agent-web-console test`
- `pnpm build`
- `git diff --check`

新增测试位于 `apps/web-console/test/unit/`，覆盖错误工厂、JSON 请求、流式对话、Agent 技能预检和应用错误边界。

## 本次接入文件

下表中的源码路径均相对于 `apps/web-console/src/`。

| 文件 | 改动 |
| --- | --- |
| `lib/errors/error-factory.ts` | 统一错误对象、分类、可信本地校验错误和展示入口。 |
| `lib/errors/error-catalog.ts` | 通用错误文案及业务码映射。 |
| `api/client.ts` | 网络、HTTP、非 JSON 错误页和损坏响应归一化，保留冲突元数据。 |
| `api/chat.ts` | 流式请求使用公共请求层，识别断流、错误响应和错误内容类型。 |
| `api/agents.ts` | 区分技能预检业务失败与服务异常，转译逐项错误。 |
| `api/workflows.ts` | 工作流数据异常和浏览器能力异常进入工厂。 |
| `app/AppErrorBoundary.tsx` | 渲染错误及未处理异步异常的展示边界。 |
| `main.tsx` | 在应用挂载处接入错误边界。 |
| `styles/error-notice.css` | 全局异常提示与页面错误状态样式。 |
| `app/App.tsx` | 启动异常使用统一文案，避免与 Agent 页重复展示同一提示。 |
| `components/workspace/views/ChatView.tsx` | 展示统一文案，删除冗余错误前缀。 |
| `components/workspace/views/SopBuilderView.tsx` | 草稿加载、保存、发布和导入等异常进入工厂。 |
| `features/agents/hooks/use-agents.ts` | Agent 加载、保存、删除和预检异常接入。 |
| `features/chat/hooks/use-chat.ts` | 会话、发送和流式错误事件接入。 |
| `features/settings/hooks/use-profile.ts` | 资料保存异常接入。 |
| `features/skills/hooks/use-skills.ts` | 技能生命周期操作异常接入。 |
| `features/sop/editor/use-sop-editor.ts` | JSON 导入错误按本地输入分类。 |
| `features/sop/editor/use-sop-workflow-references.ts` | 工作流版本目录加载异常接入。 |
| `features/sop/editor/use-sop-agent-references.ts` | Agent 版本目录加载异常接入。 |
| `features/sop/nodes/human-approval/HumanApprovalInspector.tsx` | 审批 schema 输入异常转换。 |
| `features/sop/nodes/shared/TypedValueOrVariableInput.tsx` | 字面量解析异常转换。 |
| `features/sop/runs/components/SopRunPanel.tsx` | 本地运行输入校验保留字段提示，服务端运行错误转译。 |
| `features/sop/runs/components/SopRunInterruptCard.tsx` | 审批决定输入校验和提交异常转换。 |
| `features/sop/runs/use-sop-run.ts` | 启动、取消、恢复和快照加载异常接入。 |
| `api.test.ts` | 更新 API 错误契约断言，验证中文提示和原始 cause 同时保留。 |

新增回归测试严格镜像源码，位于 `test/unit/api/{client,chat,agents}.test.ts`、`test/unit/lib/errors/error-factory.test.ts` 和 `test/unit/app/AppErrorBoundary.test.tsx`。覆盖 HTTP 分类、网络异常、HTML 错误页、未知错误隐藏、预检失败、断流、成功状态中的错误内容类型和错误边界。
