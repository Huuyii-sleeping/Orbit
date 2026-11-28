# SaaS 身份与租户隔离基础

当前增量建立共享服务、共享 SQLite 数据库的身份入口。生产 BFF 强制启用 SaaS 模式。认证使用 `express-openid-connect` 的 OIDC 授权码 + PKCE；回调中的 ID Token 还必须通过 `jose` 对 IdP JWKS 的签名、issuer 和 audience 校验。Orbit 不保存密码，也不向浏览器提供服务间令牌。

M1-A/M1-B 已实现受信组织角色、会话权限查询，以及 SOP / Workflow service 的操作授权、可信发起人和控制审计。声明、权限矩阵、撤权时限与审计语义见 [组织角色与操作权限](organization-authorization.md)。M1-C 已补充 [Workflow 输入与运行资源边界](workflow-resource-boundaries.md)，并完成当前单进程部署下的 [组织运行配额、请求限流和 SSE 连接治理](organization-resource-quotas.md)，草稿/模板写入也有事务审计。M1-D 已验证完整入口和活动 SSE 撤权，并使用真实 Keycloak 26.4.7、HTTPS 代理及生产模式 BFF 完成独立集成验收，见 [受限 Workflow 入口](workflow-authenticated-entrypoint.md)。受限 SaaS 页面已接入登录、组织切换、权限和审批闭环；目标环境和生产容量仍待验收，业务开关默认关闭。当前预算不等同于租户总存储、进程资源隔离或多副本共享配额。

## 部署配置

推荐 Keycloak Organizations。为 Orbit 创建 confidential OIDC client，启用 Standard Flow，允许精确回调 `https://orbit.example.com/auth/callback`；在 ID Token 映射 `organization` 对象，其每个成员组织形如 `"alias": { "id": "稳定组织 ID" }`。Orbit 请求 `organization:*` scope；缺少稳定 ID 的登录会被拒绝。启用后通道注销，回调地址为 `https://orbit.example.com/auth/backchannel-logout`。

已在 Keycloak 26.4.7 验证：Organization Membership mapper 的 `addOrganizationId` 必须开启，默认关闭；client 启用 PKCE S256。`orbit_org_roles` 应由可信后台维护，以 JSON 类型写入 ID Token，对应用户属性只能由管理员编辑，不能开放用户自助编辑。组织移除和角色降权后同步映射并注销旧会话。可执行 `pnpm test:identity:keycloak` 重现隔离环境的 HTTPS 验收。

Web 和 BFF 应在同一公开 origin：`/api/*`、`/auth/*` 转到 BFF，其他页面由 Web 提供。反向代理终止 TLS。BFF 环境变量示例：

```dotenv
NODE_ENV=production
BFF_MODE=saas
BFF_SAAS_WORKFLOW_ACCESS=disabled
OIDC_BASE_URL=https://orbit.example.com
OIDC_ISSUER_URL=https://id.example.com/realms/orbit
OIDC_JWKS_URL=https://id.example.com/realms/orbit/protocol/openid-connect/certs
OIDC_CLIENT_ID=orbit-web
OIDC_CLIENT_SECRET=your-confidential-client-secret
BFF_SESSION_SECRET=64-hex-characters-from-32-random-bytes
BFF_SESSION_STORE_PATH=/private/orbit-sessions/session.sqlite
AGENT_SERVICE_TOKEN=your-independent-32-to-512-character-service-token
AGENT_MODE=saas
AGENT_SERVICE_BASE_URL=http://127.0.0.1:3181
```

`BFF_SESSION_SECRET` 可用 `openssl rand -hex 32` 生成。会话目录必须为 `0700`，数据库文件由服务设为 `0600`；目录和文件需要持久化备份与受控访问。Agent 进程必须使用相同的 `AGENT_SERVICE_TOKEN` 并设置 `AGENT_MODE=saas`，生产强制 SaaS 模式。BFF 和 Agent 内部连接只在受信网络传输；跨主机应使用 TLS 或等效私有网络。不要在 `VITE_*` 或浏览器环境变量中放服务令牌。Registry 的管理令牌与用户登录是不同凭据，不能当作租户授权。

页面 `/studio` 自动识别部署模式：SaaS 仅装配受限组织工作流，只有明确的 local 模式装配完整工作台。开发代理同时转发 `/api` 和 `/auth`；公开 origin 必须与 `OIDC_BASE_URL` 一致。

本机开发默认 `BFF_MODE=local`，沿用原接口。若需要本机调试 OIDC，可显式设置 `BFF_MODE=saas` 并使用 loopback HTTP；非本机和生产必须 HTTPS。生产禁止 `BFF_MODE=local`。变更认证参数后重启 BFF，轮换服务令牌时同步更新 Agent 与 BFF。

## 当前可用范围

| 接口 | SaaS 行为 |
| --- | --- |
| `GET /auth/login`、`GET/POST /auth/callback` | OIDC 登录与回调 |
| `POST /auth/backchannel-logout` | IdP 验签注销通知 |
| `GET /api/auth/config` | 公开部署模式和受限入口状态，不返回秘密；供页面在装配前识别模式 |
| `GET /api/healthz` | 无身份的最小存活探针 |
| `GET /api/auth/session`、`GET /api/auth/tenants` | 当前身份和已验证成员组织 |
| `POST /api/auth/tenant`、`POST /api/auth/logout` | 选择成员组织、本地注销 |
| `GET/PUT /api/profile`、`GET/PATCH /api/settings` | 按 issuer、组织 ID、用户 ID 隔离的个人配置 |
| SOP / Workflow API | 默认拒绝；`BFF_SAAS_WORKFLOW_ACCESS=restricted` 时仅放行 [精确列举的受限接口](workflow-authenticated-entrypoint.md)，仍执行全部业务权限与资源校验 |
| 其他 API、Agent 会话、技能、模板与全局 SSE | 已登录仍返回 `403 SAAS_CAPABILITY_NOT_ISOLATED` |

未登录访问业务接口返回 `401 AUTH_REQUIRED`。SaaS 模式下，写请求需要精确的公开 `Origin`；JSON 更新需要 `Content-Type: application/json`。无通配符 CORS，浏览器通过同源 cookie 调用。`POST /api/auth/logout` 后旧 cookie 立即失效，后通道注销可撤销对应用户会话；固定会话时长最长 300 秒，不滚动续期。组织成员资格变化若未触发 IdP 注销，已有会话最长保留 300 秒。

活动 Workflow SSE 绑定 SDK 实际读取的会话版本。本进程注销、组织切换和后通道撤权提交后通知关闭；原到期时间到达时关闭，同机会话库其他连接的变更每 1 秒复查。检查失败关闭连接，断线只结束订阅，不取消工作流；不会让旧连接延长会话。生产代理须传播上游断开并允许 SSE 流式转发。

旧 `business_sections` 中的本地数据保持原样，不会自动归属第一个登录用户。新个人配置写入同一 SQLite 文件中的 `tenant_business_sections`，复合主键为 `(issuer, tenant_id, subject, key)`。旧数据迁移必须由管理员显式指定归属并单独验收。

## 上线限制与下一步

这只是身份和个人配置的安全基础，尚不是完整可用的多租户工作台。会话数据库可供同机多个进程共享；跨主机横向扩容需要引入受支持的共享会话存储，当前不能承诺多主机 HA。

产品 SQLite 的 v7 迁移已将 SOP 草稿、版本、模板及 AgentVersion 放入 `(issuer, tenant_id)` 命名空间，旧记录保持在空命名空间，不自动归属任何 SaaS 租户。仓储读写按可信租户上下文限定；SOP 版本与模板写入还由数据库触发器检查租户内来源。SaaS 模式拒绝从租户请求执行整库备份和恢复。SOP 的最小读写及发布入口可通过受限配置联调，AgentVersion 和模板入口继续关闭。

v8 迁移将 WorkflowRun、节点运行和事件改为复合租户键，旧运行记录继续留在空命名空间；同名 run ID 在不同组织之间互不覆盖。SaaS AgentProfile 改由产品数据库按组织保存，同组织成员共享配置，本地模式继续读取原有配置。AgentVersion 新写入时由数据库检查同组织 profile 是否存在。BFF 在查询、取消、恢复和订阅运行前检查当前组织的运行记录。

v9 增加不可变的运行发起人和只追加的组织控制审计。SaaS 运行发起人不得审批自己的运行，历史发起人未知时拒绝审批；发布版本的操作者只来自可信登录身份。组织管理员也无法调用整库健康详情、备份或恢复的业务入口。本地模式保留原行为。

## Workflow 服务间租户授权

BFF 的 OIDC 边界建立 `(issuer, tenantId, subject)` 可信异步上下文。调用 Agent 时，JSON 与 SSE 代理从该上下文生成 `x-orbit-tenant-context`，不会转发浏览器提交的同名 header。没有服务凭据时，BFF 不发送带租户身份的请求。

Agent 先验证内部 Bearer token，再校验单一、格式正确的租户 header。该 header 使用 Base64URL 编码 JSON，只是内部身份载体，不是签名令牌；可信性来自服务凭据和受控传输。持有内部服务令牌的调用方可代表组织执行受支持操作，必须按服务账户管理和轮换令牌。

`AGENT_MODE=saas` 时，除携带服务凭据的 `GET /health` 外，缺少租户身份的请求均返回 `401`。租户请求目前只进入 Workflow 创建、查询、取消、恢复和事件 API；Session、Memory、模型配置、全局事件以及 `/internal/mastra/*` 等未隔离入口返回 `403`。开发环境默认 `local`；本地旧请求不能读取租户运行，租户请求也不能读取旧本地运行。

Runtime 在创建运行时持久化组织身份，并从 issuer 与组织 ID 派生执行 owner，忽略请求体伪造的 owner。运行归属不可修改；查询、取消、恢复和 SSE 在读取事件或操作 Mastra snapshot 前，均比较当前组织与持久化组织。不同组织或不同 issuer 的请求返回与不存在记录相同的 `404`。同组织成员共享运行；重启后继续使用持久化归属，审批幂等回执仍绑定原 run。

当前租户 Workflow 只允许 Start、End、Template、Variable、Human Approval、Iteration 和 Subworkflow，递归检查容器及依赖。模型、工具、HTTP、代码、表达式等执行节点尚未完成资源与凭据隔离，因此明确拒绝。SaaS 审批节点引用固定策略 `organization.workflow.approve`；发布和启动拒绝未知策略，恢复仍需具备审批权且不是发起人。BFF 业务入口默认关闭，显式受限联调不代表完整 SaaS 工作台或生产部署已验收。Runtime 运行元数据仍依赖单进程本地持久化，不能让多个 Agent 进程共享同一运行目录。

生产上线前须完成以下领域改造并各自通过越权回归，再逐项加入 SaaS 白名单：

1. 为组织内的管理、编辑、运行及审批操作建立授权策略，并逐项验收浏览器业务 API；整库备份须独立管理员权限与操作入口。
2. 技能包元数据、私有 Registry 读写授权与文件命名空间。
3. Agent 会话、Memory、异步运行、SSE、审计和安全事件的租户归属与订阅过滤。
4. 工具执行的租户工作目录、凭据隔离、网络限制、资源配额和成熟沙箱。

页面已在真实 Keycloak/HTTPS 隔离环境联调。目标 IdP 配置、网络/证书与目标容量验收完成前，生产继续保持 `BFF_SAAS_WORKFLOW_ACCESS=disabled`，不向外部 SaaS 用户开放业务接口。后续再隔离模型凭据、会话 Memory、技能与工具执行环境。
