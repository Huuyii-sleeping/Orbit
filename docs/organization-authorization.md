# 组织角色与操作权限（M1-A / M1-B）

> 当前状态：权限来源、权限矩阵、会话查询，以及 SOP / Workflow service 的逐操作校验已实现。浏览器业务白名单保持关闭，输入与资源限制、完整登录执行链路及真实 IdP 部署仍待后续验收。

## 1. 这一增量解决什么

组织成员关系回答“用户能进入哪个组织”，角色回答“在该组织能做哪些操作”。例如 Alice 在 A 是管理员，在 B 只是查看者，切换到 B 后不能沿用 A 的审批权限。

当前授权链路：

1. IdP 根据受控的组织成员与角色数据签发 ID Token。
2. BFF 经 OIDC 回调验签及 issuer、audience 等校验后解析组织与角色。
3. 服务器会话保存组织列表及角色；浏览器不能修改此身份对象。
4. 每次请求按当前选中的组织计算权限，在异步调用链保存只读快照。
5. `GET /api/auth/session` 返回当前组织角色与权限，供界面展示。
6. SOP 与 Workflow service 使用权限检查函数执行操作授权，再检查资源归属和执行边界。

已有权限信息和业务检查不代表接口已开放；前端隐藏按钮不能替代后端校验。

## 2. 角色来自哪里

继续使用成熟的 OIDC 登录、JWT 验签与 IdP 组织管理能力。Orbit 不新增密码系统，也不从浏览器获取可信角色。

成员关系沿用 Keycloak Organizations 的 `organization` 映射。角色使用自定义 ID Token 声明 `orbit_org_roles`，以**稳定组织 ID**作为键：

```json
{
  "iss": "https://id.example.com/realms/orbit",
  "sub": "alice",
  "organization": {
    "alpha": { "id": "org-a" },
    "beta": { "id": "org-b" }
  },
  "orbit_org_roles": {
    "org-a": ["admin"],
    "org-b": ["viewer"]
  }
}
```

这是声明契约示例，不是 Keycloak 默认会签发的角色格式。部署时需要为 Orbit client 配置映射，并核验来源：

- 从 IdP 受控的组织成员授权数据计算，不能从用户可自行编辑的 profile/attribute 生成。
- 各组织分别映射，不能把 realm/client 全局管理员角色复制到所有组织。
- 不使用组织 alias 作为权限键，避免重命名和同名导致归属错误。
- 声明必须进入 ID Token；当前不使用 access token 或浏览器提供的 JWT 作为业务权限来源。

若现有 IdP 无法从受控数据生成该声明，先保持业务关闭，后续评估成熟授权服务或受控授权存储。不能使用固定的全员管理员声明替代组织授权。

静态角色矩阵属于 Orbit 业务策略，不重写 OIDC 协议。目前未引入独立策略引擎；出现资源级关系、复杂条件或外部集中授权需求时再评估成熟方案。

| 输入 | 行为 |
| --- | --- |
| 缺少 `orbit_org_roles` | 允许已有身份登录，所有组织默认无业务角色和权限 |
| 成员组织未映射角色或映射为空数组 | 该组织没有业务权限 |
| 合法多个角色 | 仅在对应组织内取权限并集 |
| 未知角色、重复角色、非数组值或畸形映射 | 拒绝登录 |
| 为非成员组织签发角色，或使用组织 alias 作为键 | 拒绝登录 |
| 顶层 `roles`、`realm_access.roles`、请求中的角色 | 不作为授权依据 |
| 历史服务器会话没有角色字段 | 默认无业务权限，不自动授予查看者或管理员 |

组织数最多 100；每个组织只接受以下 6 种角色且不能重复。

## 3. 权限矩阵

角色只在当前组织生效，`admin` 指组织管理员，不是跨组织的平台管理员。

| 操作权限 | viewer | editor | publisher | operator | approver | admin |
| --- | --- | --- | --- | --- | --- | --- |
| `workflow.read` 查看草稿、版本、运行及事件 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `workflow.edit` 创建、编辑、删除草稿 | — | ✓ | — | — | — | ✓ |
| `workflow.publish` 发布版本 | — | — | ✓ | — | — | ✓ |
| `workflow.run` 发起执行 | — | ✓ | — | ✓ | — | ✓ |
| `workflow.cancel` 取消组织内运行 | — | — | — | ✓ | — | ✓ |
| `workflow.approve` 审批组织内运行 | — | — | — | — | ✓ | ✓ |
| `organization.members.manage` 成员管理策略预留 | — | — | — | — | — | ✓ |

发布与编辑、审批与运行分别授权。例如需要编辑和发布时，组合 `editor + publisher`。成员管理权限目前只是策略契约，Orbit 没有已开放的成员管理 API，组织授权仍由 IdP 管理。

当前默认禁止运行发起人审批自己的运行，包括组织管理员。具备审批角色的其他组织成员可以审批本组织运行；尚未实现指定个人审批人或按 policyId 分配审批人的规则。取消权限允许 operator/admin 取消组织内运行，不仅限本人发起的运行。

## 4. 会话接口

`GET /api/auth/session` 在原响应上增加 `roles`、`permissions`，组织列表也带当前登录时验证的角色。示例：

```json
{
  "ok": true,
  "user": { "subject": "alice" },
  "tenantId": "org-b",
  "organizations": [
    { "id": "org-a", "alias": "alpha", "roles": ["admin"] },
    { "id": "org-b", "alias": "beta", "roles": ["viewer"] }
  ],
  "roles": ["viewer"],
  "permissions": ["workflow.read"]
}
```

`POST /api/auth/tenant` 只读取 `tenantId` 并验证成员关系，成功后返回目标组织角色与权限。提交额外的 `roles` 或 `permissions` 不会修改授权。

角色与权限只存在 BFF 授权上下文。BFF → Agent 的身份契约仍只携带 issuer、tenantId、subject；Agent 继续执行组织归属与能力检查。服务身份 header 不是完整业务操作授权凭据。

## 5. 角色变化与撤权时限

采用固定会话快照，不逐请求向 IdP 查询角色：

| 事件 | 已有会话的结果 |
| --- | --- |
| 切换组织 | 按会话中目标组织角色重新计算，不沿用原组织权限 |
| IdP 修改角色或移除成员，尚无注销通知 | 保留登录时快照，最长至原固定会话到期（300 秒以内） |
| 用户重新登录 | 从新验签 Token 读取新角色 |
| 有效签名后通道注销 | 撤销匹配会话，后续请求拒绝；迟到写回不能恢复 |
| 本地注销或会话到期 | 旧 cookie 不能继续使用 |

IdP 角色变化不一定自动发送后通道注销；部署验收必须检查成员变更与撤权流程。要求更短失效时限时，须在开放敏感操作前引入额外实时授权/撤销机制。

这些约束针对后续请求，不自动停止已执行的任务或立即中断已建立的事件流；运行取消与长连接权限复核属于后续工作。

## 6. 代码与验证入口

| 职责 | 文件 |
| --- | --- |
| 角色集合及声明校验 | [organization-roles.ts](../apps/bff/src/identity/organization-roles.ts) |
| 组织身份与角色快照 | [organization-claims.ts](../apps/bff/src/identity/organization-claims.ts) |
| 权限矩阵、上下文和默认拒绝 | [organization-authorization.ts](../apps/bff/src/identity/organization-authorization.ts) |
| OIDC 请求建立授权上下文 | [identity-http.ts](../apps/bff/src/identity/identity-http.ts) |
| 会话与组织切换响应 | [identity.controller.ts](../apps/bff/src/identity/identity.controller.ts) |
| 登录、切换、伪造与撤权回归 | [saas-identity.test.ts](../apps/bff/test/smoke/saas-identity.test.ts) |

`requireOrganizationPermission()` 在缺少上下文时也拒绝，不退回默认角色。它还校验授权快照与当前 issuer、组织、用户的一致性，避免嵌套切换身份后沿用权限。`OrganizationOperationsService` 根据数据库的显式部署配置保留本地旧行为；SaaS 模式不会因缺少上下文回退到本地。

```bash
pnpm --filter agent-bff exec vitest run test/unit/identity test/smoke/saas-identity.test.ts
```

真实 IdP 的角色映射与注销通知验收不由测试 IdP 替代。M1-C 资源边界已在当前单进程部署范围实现并验证；下一步按 [Server 路线的 M1-D 清单](server-development-roadmap.md) 完成完整入口与部署验收。

## 7. 业务操作如何执行授权（M1-B）

| 业务入口 | 权限与附加约束 |
| --- | --- |
| SOP 查询、版本、导出、模板读取 | `workflow.read`，仓储只读取当前组织 |
| 创建/保存/删除草稿、导入预检与导入、模板写入、从版本/模板创建草稿 | `workflow.edit`，关联版本继续限定当前组织 |
| 发布 | `workflow.publish`；`createdBy` 来自可信 subject，忽略请求伪造值 |
| 启动 Workflow | `workflow.run`；草稿和版本必须属于当前组织，内联草稿也必须有当前组织的草稿记录 |
| 查询、索引、SSE | `workflow.read`；访问上游之前验证本组织的运行记录 |
| 取消 | `workflow.cancel`，且运行属于当前组织 |
| 审批/恢复 | `workflow.approve`，且运行属于当前组织、发起人已知、操作者不是发起人；审批身份与幂等仍由 Runtime 校验 |
| 独立 Agent 试跑 | SaaS service 直接拒绝，等待模型/工具等执行隔离；本地模式保留原行为 |
| 整库健康详情、备份与恢复 | SaaS 组织管理员也不能执行；不等同于最小存活探针 |

检查放在 service，不能依靠 controller 或未来浏览器白名单单独保证安全。缺少操作权限返回 `403 PERMISSION_DENIED`；已有权限但跨组织访问运行返回 `404`，不暴露其他组织资源。controller 已将授权错误映射为 403，避免变成 500。

Agent 的快照响应还必须匹配所请求的运行 ID；启动响应必须匹配工作流 ID，否则返回 502，不把不匹配的记录写入本地投影。

### 发起人与审批人

产品数据库 v9 增加 `workflow_runs.initiated_by`。启动时由 BFF 使用可信 subject 写入，不使用请求体或 Runtime 快照的自报身份。后续查询、状态更新和 SSE 不改变发起人，数据库触发器阻止修改。

历史缺少发起人的运行保留 `NULL`，不能通过后续快照写回自动认领。SaaS 审批这类运行返回 `403 WORKFLOW_RUN_INITIATOR_REQUIRED`；发起人自审批返回 `403 WORKFLOW_SELF_APPROVAL_FORBIDDEN`。本地旧审批行为保持不变。

### 操作审计与故障语义

v9 增加只追加的 `organization_audit_events`，记录发布、启动、取消和审批请求。M1-C 继续复用此表，补齐草稿和模板写入。每个操作有唯一 operation ID，先写入 `requested` 再执行操作，之后追加结果：

| 状态 | 准确含义 |
| --- | --- |
| `requested` | 已持久化请求意图，进程可能尚未执行或尚未确认结果 |
| `succeeded` | 该控制请求已确认成功，不代表整个工作流最终执行成功 |
| `failed` | 本次请求未确认成功；上游超时等情形不代表外部副作用已回滚 |

审计记录包含组织、真实操作人、动作、资源标识、时间；审批另记决定、interrupt ID 和幂等键的 SHA-256 哈希。不保存审批正文、运行输入、凭据、原始幂等键或错误原文。

草稿创建、保存（包括 autosave）、删除、导入、从版本派生，以及模板保存、删除、从模板派生均使用 `workflow.edit`。detail 只增加固定的 `mutation` 名称，不保存草稿、模板或参数正文。参数/权限在业务写入前被拒绝时不新增审计；进入写入后的修订冲突记录 requested/failed。

这些本地 SQLite 写入使用 `OrganizationOperationsService.mutate`：requested 在事务外保存，业务写入和 succeeded 在同一事务执行；succeeded 写入失败则业务写入回滚，随后追加 failed。无法写 requested 时不执行写入。它与下面跨 Agent 的控制操作故障语义不同。审计存储本身不可用时请求明确失败，不绕过审计继续保存。

无法写入 `requested` 时不执行副作用。若副作用成功后结果审计写入失败，保留请求意图并返回错误，不自动重试；需要结合 Runtime 状态对账。跨 BFF 数据库与 Agent 的操作不是分布式事务，当前不承诺所有控制请求恰好执行一次。

审计由数据库触发器阻止普通更新/删除，不随运行投影清理而级联删除。M6 仍需补齐审计保留期/归档和容量控制；当前没有开放组织审计查询 API。HTTP 限流拒绝不逐条写审计，避免拒绝流量扩大存储；已进入控制审计后被 Runtime 运行容量拒绝的请求记录 failed。配额说明见 [组织资源限制](organization-resource-quotas.md)。

新增代码入口：[组织操作授权与审计](../apps/bff/src/identity/organization-operations.service.ts)、[v9 迁移](../apps/bff/src/storage/migrations/organization-authorization.ts)、[SOP service](../apps/bff/src/sops/sops.service.ts)、[Workflow service](../apps/bff/src/workflow-runs/workflow-runs.service.ts)。

HTTP 授权 smoke 使用真实 Nest 装配与测试宿主提供的固定可信身份，验证 controller/service 和 403 映射；它不会改变生产 OIDC 白名单，也不替代 M1-D 的完整登录执行链路。
