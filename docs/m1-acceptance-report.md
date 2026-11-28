# M1 完整验收记录

日期：2026-11-28（续验）。分支：`codex/server-hardening-phase2`。本页记录本地独立验收环境的实测结果，不代表用户生产环境已部署或整个工作台已对外开放。

## 验收结论

M1 的后端/API 与受限 SaaS 页面闭环均已在独立环境通过。按用户确定的首批目标（约 10 个组织、峰值 10 个并行运行）完成本机混合负载验收。真实目标部署和长期运行、存储故障验收尚未完成，业务开关继续默认 `disabled`。

## 实际启动了什么

- 固定 digest 的 Keycloak 26.4.7 Docker 容器，独立 realm、真实 Organizations、三名测试用户和仅管理员维护的组织角色声明。
- HTTPS 入口代理和一天有效的临时证书；Node/API 与 Keycloak 通过测试专属 CA 校验证书。浏览器仅在本轮独立上下文中忽略自签证书错误，生产不得采用此设置。
- `NODE_ENV=production` 下的真实 BFF、SQLite 会话和产品数据库。
- 本机 Chrome 157.0.8103.79 与 Playwright 1.62.1，实际加载构建后的 Web，使用真实 IdP 密码表单。
- 独立 Agent 子进程与 Mastra，使用本轮临时目录，不读取用户运行数据，不调用收费模型。

普通测试另有真实 HTTP/数据库与单元回归。Keycloak live 使用实际授权码/PKCE、签名 ID Token、服务端 Cookie 和 Keycloak 发出的后通道注销通知；没有注入固定用户身份取代登录。

## 对照 M1 逐项验收

| 范围 | 覆盖和结果 |
| --- | --- |
| M1-A 身份与角色 | 签名角色映射、非法声明拒绝、组织选择、默认无权限、角色组合、新登录降权；通过 |
| M1-B 业务权限 | 编辑、发布、运行、取消、审批分别授权；禁止伪造发布者/发起人和自审批；通过 |
| M1-B 租户范围 | 同 ID 草稿在两个组织独立，跨组织查询、保存、版本、运行、SSE 与控制拒绝；跨 issuer 回归通过 |
| M1-B 审计 | 可信操作人、动作和阶段；正文脱敏、幂等键哈希、审计故障回滚和拒绝执行；通过 |
| M1-C 输入与执行规模 | JSON/chunked/压缩输入、定义与静态展开、嵌套、输入及审批数据预算；通过 |
| M1-C 输出与持久化 | 节点/流式/frame、journal、产品与原生快照预算，超限失败和重启回放；通过 |
| M1-C 配额 | 真实登录后并发发起 8 个等待审批运行，5 个接受、3 个 429；另一个组织仍可独立运行 |
| M1-C SSE | 同组织 8 条接受、第 9 条 429；主动断线后可补位；读频率与连接分别计数 |
| M1-C 请求频率 | 分 10 批、每批并发 30 次真实 HTTPS 查询；只出现 200/429；本组织读取额度用尽后取消请求和另一组织查询仍可用 |
| M1-C 未隔离能力 | 容器和依赖中隐藏的代码/模型/网络/工具能力递归拒绝；通过 |
| M1-D 恢复 | BFF/Agent 正常重启与 Cookie 持久化；额外用 SIGKILL 终止 Agent，停机查询明确 502，原端口重启后 waiting 和配额保留 |
| M1-D 审批幂等 | 异常退出恢复后，同一决定的 4 个并发 HTTP 请求均成功；相反决定冲突，终态不会重新执行 |
| M1-D 连接撤权 | 组织切换、本地注销、真实后通道注销关闭活动 SSE；过期时钟推进后旧 Cookie 与活动 SSE 失效；运行继续等待 |
| M1-D 成员变化 | Keycloak 角色降权后注销旧会话，新登录无审批权；移除组织成员后注销，旧 Cookie 失效、重新登录拒绝 |
| 页面端到端 | Alice 创建和修订、第二页签保存旧 revision 返回 409、Bob 发布、同意/拒绝、取消及按 ID 打开运行；通过 |
| 页面隔离 | 组织切换清空视图和内存、多页签同步、无 SaaS 草稿持久缓存、禁止自审批和未授权按钮、Mallory 无跨组织运行；通过 |
| 页面失败路径 | 本地注销和真实 IdP 注销卸载业务；公开模式接口 503 停在错误页，重试后恢复；没有回退全功能本地工作台 |
| 小规模混合负载 | 10 个真实组织同时持有 10 个 waiting 运行和 10 条 SSE，一分钟 600 次快照查询全部 200；跨组织 404、取消后连接释放和再次启动通过 |
| 页面契约 | 实测前端实际使用的 autosave 路径，修复后成功；发布者无编辑权 403、其他组织保存 404 |

上述查询突发和额度测试证明固定边界在该本地场景成立，不是持续压测，不据此承诺生产吞吐量、P95/P99 或多副本容量。

会话到期测试只推进 BFF 业务时钟，保留真实 HTTP、Cookie、SQLite 和 SSE；未实际等待五分钟，也没有改变 Keycloak 系统时间。存储故障、审计故障和终态持久化竞态使用可控故障注入，不能当作物理掉电/磁盘满演练。

## 本轮发现并修复的问题

### 1. 发布预检与草稿保存之间存在修订竞态

发布前先比较 `expectedRevision`，然后异步计算 hash。期间发生保存时，原实现仍会把旧内容发布为新版本。回归先证明旧实现错误地成功；修复后，在 SQLite 发布事务内再次比较修订，不一致返回 `409 SOP_REVISION_CONFLICT`，不创建版本，审计记录失败。

涉及 [SopsService](../apps/bff/src/sops/sops.service.ts)、[发布仓储](../apps/bff/src/sops/sqlite-sops.repository.ts) 和 [失败回归](../apps/bff/test/unit/sops/sops-authorization.test.ts)。

### 2. 审批终态持久化期间过早清除 active

原 `executeResume` 返回尚未完成的异步终态处理时，`finally` 已删除 active。此时同一决定重试会看到旧 waiting 记录，但原生状态已完成，返回错误 409。真实 HTTPS 并发复现后，增加延迟终态写入的确定性回归。

修复为等待终态处理结束再清除 active，让相同决定共享同一 completion；执行失败路径同样等待。涉及 [Runtime Adapter](../apps/agent-cli/src/mastra/adapters/workflow-runtime-adapter.ts) 和 [持久化窗口回归](../apps/agent-cli/test/unit/mastra/adapters/workflow-runtime-adapter.test.ts)。

### 3. 受限入口缺少前端实际调用的 autosave

前端保存会调用 `POST /api/sops/:id/autosave`，此前受限白名单只允许 PUT。真实 Keycloak 登录后复现 403；现在仅为 `restricted` 增加该精确路径，沿用 `saveDraft` 的权限、修订与审计，不放开其他 SOP 前缀。

涉及 [身份边界](../apps/bff/src/identity/identity-http.ts) 和 [真实 HTTPS 回归](../apps/bff/test/live/keycloak-workflow.test.ts)。

## 2026-11-28 补齐的页面与接口保障

- 公开最小部署能力，SaaS 先认证再装配受限页面；不加载尚未隔离的 Agent、聊天和技能模块。新增共享浏览器身份/运行摘要契约。
- 登录固定返回同源 `/studio`，外部 `returnTo` 不生效。修复原前端取消请求未发送 JSON、被 SaaS 边界拒绝的问题。
- 组织切换/注销先卸载、关闭 SSE，再读新会话；新页面只使用内存，不读写原工作台草稿缓存。
- 浏览器请求携带身份和组织预期，Cookie 已变化的旧请求返回 409；它不是授权凭据，服务端仍独立检查可信会话与业务权限。
- 运行列表有界且只返回摘要，不复制完整输入/输出；旧审批在投影中优先展示，并支持直接按运行 ID 查询。详情从 Runtime 读取。
- 为 SaaS 页面建立独立滚动容器，避免继承工作台的外层禁滚；真实鼠标滚轮和窄屏布局有浏览器回归。
- 页面表单与 revision 绑定，刷新后重新装配当前修订，避免表单仍是旧内容却使用新 revision 保存；真实多页签冲突回归通过。
- 审批复用已有 schema 表单与稳定幂等键；写入不自动重试。SSE 故障停止重连并允许手动恢复，回放事件合并查询，旧异步响应不能覆盖新快照。
- 容量回归发现测试管理员令牌一分钟后到期、导致 realm 清理 401；仅修复隔离测试管理员的主动续期，同时让单项清理失败不阻止其余资源清理。复验已正常回收测试资源。

## 本轮主要代码入口

| 文件 | 用途 |
| --- | --- |
| `apps/web-console/src/features/identity/IdentityWorkspace.tsx` | 模式识别、会话门禁、组织选择、跨页签清理与原工作台隔离装配 |
| `apps/web-console/src/pages/TenantWorkflowPage.tsx`、`features/tenant-workflows/` | 有权限的草稿/发布/运行/审批页面、内存状态与 SSE 生命周期 |
| `apps/bff/src/identity/identity-http.ts`、`server.ts` | 固定登录回跳、陈旧上下文拒绝、公开最小能力接口 |
| `apps/bff/src/workflow-runs/` | 当前组织的有界摘要索引与可信发起人详情 |
| `packages/runtime-contracts/src/identity.ts` | 浏览器身份、运行摘要和固定审批策略共享契约 |
| `apps/bff/test/live/`、`scripts/run-keycloak-smoke.mjs` | 可重复的真实 IdP、浏览器和小规模容量验收及测试资源清理 |

## 小规模负载实测

| 指标 | 最后一次通过结果 |
| --- | --- |
| 组织 / 未完成运行 / SSE | 10 / 10 / 10 |
| 查询 | 60 批，每批并发 10 次；共 600 次，均成功 |
| 持续查询时长 | 60.01 秒 |
| 查询 P95 / P99 / 最大耗时 | 70.37 / 75.54 / 80.61 ms |
| 负载后行为 | 所有跨组织查询 404；10 次取消成功、10 条终态 SSE 关闭；各组织均可再次启动并取消 |

这是本机开发环境观测，本次复验与常规测试同时启动，不能作为生产 SLA；测试的是纯数据与等待审批节点，10 个 waiting 运行计入并发额度，不代表 10 个高 CPU 或模型任务持续执行。仍需在目标服务器重复测试并观察长期资源走势。

## 验证命令

```bash
pnpm build
pnpm --workspace-concurrency=1 -r test --maxWorkers=2 --minWorkers=1
pnpm test:identity:keycloak
pnpm test:identity:browser
pnpm test:identity:capacity
pnpm check:structure
pnpm check:workflow-boundaries
git diff --check
```

全仓通过 1,041 项常规测试；普通全仓另有 3 项 live 跳过，不计入通过数量。独立浏览器命令执行 API + 页面共 2 项通过；独立容量命令执行 API + 容量共 2 项通过，API live 为重复复验，因此独立 live 用例共 3 项。浏览器工具准备见 [完整入口说明](workflow-authenticated-entrypoint.md)。

## 仍未通过的整体验收条件

1. **用户目标环境未验收。** 未连接现有公网域名、用户 Keycloak、生产代理或实际数据；部署地址、证书、后通道网络可达性、角色管理及成员移除流程需要目标环境验证。
2. **生产容量和长期运行未验收。** 当前仍为单 BFF/单 Agent、独占本地运行目录和进程内 HTTP 限流。已通过一分钟小规模混合负载；未完成目标环境容量、长时间稳定性、数据库满/物理掉电、备份恢复演练与多副本验证。既有 Mastra/LibSQL checkpoint 警告需继续跟踪。

测试完成后清理了本轮容器、临时 realm、数据库、证书与日志。生产业务开关保持默认关闭；后续按 [Server 路线](server-development-roadmap.md) 完成整体验收。

## 2026-11-28 用户授权后的正式复验

本次按用户“直接进行验收”的要求重新执行，没有复用上轮测试结果。结论：**当前单 BFF、单 Agent 的 M1 受限能力通过本地功能与小规模负载验收；生产开放仍等待目标环境验收。**

| 检查 | 本次结果 |
| --- | --- |
| `pnpm build` | 通过 |
| `pnpm --workspace-concurrency=1 -r test --maxWorkers=2 --minWorkers=1` | 1,041 项通过，3 项 live 按设计跳过 |
| `pnpm exec node scripts/run-keycloak-smoke.mjs --browser --capacity` | 真实 Keycloak API、浏览器、10 组织混合负载共 3 项通过 |
| `pnpm check:structure`、`pnpm check:workflow-boundaries`、`git diff --check` | 通过 |

浏览器使用文档所述宿主 Playwright 1.62.1 和本机 Chrome，并通过 `ORBIT_PLAYWRIGHT_MODULE`、`ORBIT_BROWSER_EXECUTABLE` 显式传入路径。API 回归同时覆盖 Agent SIGKILL 恢复、并发审批、配额/限流及撤权断线；常规测试还覆盖 SQLite 备份恢复与损坏备份拒绝，但这些不等于整套服务的生产备份恢复演练。

代码复核未发现本次验收范围内的新阻断问题，本次只更新验收证据，未修改业务实现。常规 Runtime 测试仍输出既有 Mastra/LibSQL WAL checkpoint 的 `SQLITE_BUSY` 警告，测试均通过；未将此问题标为已修复。没有连接或修改用户生产环境，没有开启生产业务开关，没有提交或推送。

已确认测试 runner 删除本次容器、临时 realm、证书与数据库；验收临时日志在记录结论后清理。后续部署检查继续按上文“仍未通过的整体验收条件”执行。
