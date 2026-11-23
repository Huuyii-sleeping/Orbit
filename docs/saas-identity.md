# SaaS 身份与租户隔离基础

当前增量建立共享服务、共享 SQLite 数据库的身份入口。生产 BFF 强制启用 SaaS 模式。认证使用 `express-openid-connect` 的 OIDC 授权码 + PKCE；回调中的 ID Token 还必须通过 `jose` 对 IdP JWKS 的签名、issuer 和 audience 校验。Orbit 不保存密码，也不向浏览器提供服务间令牌。

## 部署配置

推荐 Keycloak Organizations。为 Orbit 创建 confidential OIDC client，启用 Standard Flow，允许精确回调 `https://orbit.example.com/auth/callback`；在 ID Token 映射 `organization` 对象，其每个成员组织形如 `"alias": { "id": "稳定组织 ID" }`。Orbit 请求 `organization:*` scope；缺少稳定 ID 的登录会被拒绝。启用后通道注销，回调地址为 `https://orbit.example.com/auth/backchannel-logout`。

Web 和 BFF 应在同一公开 origin：`/api/*`、`/auth/*` 转到 BFF，其他页面由 Web 提供。反向代理终止 TLS。BFF 环境变量示例：

```dotenv
NODE_ENV=production
BFF_MODE=saas
OIDC_BASE_URL=https://orbit.example.com
OIDC_ISSUER_URL=https://id.example.com/realms/orbit
OIDC_JWKS_URL=https://id.example.com/realms/orbit/protocol/openid-connect/certs
OIDC_CLIENT_ID=orbit-web
OIDC_CLIENT_SECRET=your-confidential-client-secret
BFF_SESSION_SECRET=64-hex-characters-from-32-random-bytes
BFF_SESSION_STORE_PATH=/private/orbit-sessions/session.sqlite
AGENT_SERVICE_TOKEN=your-independent-32-to-512-character-service-token
AGENT_SERVICE_BASE_URL=http://127.0.0.1:3181
```

`BFF_SESSION_SECRET` 可用 `openssl rand -hex 32` 生成。会话目录必须为 `0700`，数据库文件由服务设为 `0600`；目录和文件需要持久化备份与受控访问。Agent 进程必须使用相同的 `AGENT_SERVICE_TOKEN`，BFF 和 Agent 内部连接只在受信网络传输；跨主机应使用 TLS 或等效私有网络。不要在 `VITE_*` 或浏览器环境变量中放服务令牌。Registry 的管理令牌与用户登录是不同凭据，不能当作租户授权。

本机开发默认 `BFF_MODE=local`，沿用原接口。若需要本机调试 OIDC，可显式设置 `BFF_MODE=saas` 并使用 loopback HTTP；非本机和生产必须 HTTPS。生产禁止 `BFF_MODE=local`。变更认证参数后重启 BFF，轮换服务令牌时同步更新 Agent 与 BFF。

## 当前可用范围

| 接口 | SaaS 行为 |
| --- | --- |
| `GET /auth/login`、`GET/POST /auth/callback` | OIDC 登录与回调 |
| `POST /auth/backchannel-logout` | IdP 验签注销通知 |
| `GET /api/healthz` | 无身份的最小存活探针 |
| `GET /api/auth/session`、`GET /api/auth/tenants` | 当前身份和已验证成员组织 |
| `POST /api/auth/tenant`、`POST /api/auth/logout` | 选择成员组织、本地注销 |
| `GET/PUT /api/profile`、`GET/PATCH /api/settings` | 按 issuer、组织 ID、用户 ID 隔离的个人配置 |
| 其他 API、Agent 会话、技能、SOP、运行与 SSE | 未完成领域隔离，已登录仍返回 `403 SAAS_CAPABILITY_NOT_ISOLATED` |

未登录访问业务接口返回 `401 AUTH_REQUIRED`。SaaS 模式下，写请求需要精确的公开 `Origin`；JSON 更新需要 `Content-Type: application/json`。无通配符 CORS，浏览器通过同源 cookie 调用。`POST /api/auth/logout` 后旧 cookie 立即失效，后通道注销可撤销对应用户会话；固定会话时长最长 300 秒，不滚动续期。组织成员资格变化若未触发 IdP 注销，已有会话最长保留 300 秒。

旧 `business_sections` 中的本地数据保持原样，不会自动归属第一个登录用户。新个人配置写入同一 SQLite 文件中的 `tenant_business_sections`，复合主键为 `(issuer, tenant_id, subject, key)`。旧数据迁移必须由管理员显式指定归属并单独验收。

## 上线限制与下一步

这只是身份和个人配置的安全基础，尚不是完整可用的多租户工作台。会话数据库可供同机多个进程共享；跨主机横向扩容需要引入受支持的共享会话存储，当前不能承诺多主机 HA。生产上线前须完成以下领域改造并各自通过越权回归，再逐项加入 SaaS 白名单：

1. SOP、AgentVersion 和 WorkflowRun 的 `tenant_id`、复合引用约束与整库备份管理权限。
2. 技能包元数据、私有 Registry 读写授权与文件命名空间。
3. Agent 会话、Memory、异步运行、SSE、审计和安全事件的租户归属与订阅过滤。
4. 工具执行的租户工作目录、凭据隔离、网络限制、资源配额和成熟沙箱。

在这些完成前，不应向外部 SaaS 用户开放共享 Agent、SOP 或 Registry 接口，也不应把当前模式当作完整 SaaS 发布。下一增量先完成 SOP/AgentVersion 的持久化归属和 IDOR 回归。
