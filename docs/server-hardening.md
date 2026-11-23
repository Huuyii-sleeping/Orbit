# 服务端加固与 SaaS 演进

本轮落地的是路线第一阶段：先修会丢数据、破坏版本或使进程退出的问题。当前实现仍是单部署、单工作区产品，尚未具备面向公网的多租户 SaaS 隔离能力。

## 已实现

| 边界 | 原问题 | 当前行为 |
| --- | --- | --- |
| 业务配置 | JSON 文件读改写，并发请求互相覆盖 | SQLite WAL，section 写事务；Agent、设置和技能状态在事务内更新 |
| Agent 草稿 | 旧页面覆盖新编辑 | 返回 `revision`；携带过期 revision 时返回 HTTP 409；并发修改同一草稿也检测冲突 |
| 技能包 | version 可拼接为越界路径，本地同版本可被覆盖 | 规范 SemVer 校验（含 prerelease/build），存储层再次检查；本地整包临时目录写入后切换，同版本不同内容拒绝 |
| Registry 发布 | 同版本覆盖、部分 SQL 成功、版本元数据串用 | 写事务，内容哈希文件，版本不可覆盖，相同内容重试不重置下载计数，各版本独立元数据 |
| Registry 查询 | 字符串排序把 2.9.0 当成比 2.10.0 新 | 按 SemVer 排序；无版本下载选择相同的最新版本；记录实际下载版本 |
| Registry HTTP | 错误 URL/JSON 可造成未处理异常与进程退出 | 全局异常边界；400/409/413/500；默认 JSON 上限 8 MiB，覆盖分块请求；请求头/请求体期限 |
| SOP 恢复 | 先替换文件，再发现备份损坏 | 临时副本先检查完整性与迁移兼容性，切换失败恢复原文件和连接；离线入口复用同一实现 |
| Workflow 投影 | 迟到事件把终态改回 running | 事件按 id 去重；迟到事件按对应实体的新事件判断，不回退终态；保留完整事件历史 |
| 审批恢复 | 成功后重试被 BFF 提前拒绝 | 交由同一个 Runtime 的 run-scoped 幂等回执判断；不同决定仍冲突 |
| 上游连接 | 请求挂起、流背压与断开泄漏 | Agent 普通请求和 Registry 请求默认 30 秒；SSE 只限制建连时间；背压等待可被关闭打断，客户端断开取消上游 |
| 部署凭据 | production 可以沿用公开开发管理 token | `NODE_ENV=production` 的启动配置拒绝缺失或默认 Registry 管理 token |
| 验证 | 缺少专门的服务端检查入口 | `.github/workflows/server-checks.yml` 覆盖构建、BFF/Registry 回归和依赖边界检查 |

`revision` 对现有客户端保持兼容：未提供时仍允许更新，服务端检测请求处理中发生的冲突。要完整防止“旧页面数分钟后保存覆盖新编辑”，客户端需要保留读取到的 revision 并随 PUT 发回，遇到 `AGENT_REVISION_CONFLICT` 提示重新加载；本轮没有改前端。

## 升级、备份与恢复

### 业务配置迁移

旧路径默认是 `<BFF cwd>/.data/bff-business-state.json`。首次访问时写入同路径追加 `.sqlite` 的数据库：

```text
bff-business-state.json           原文件保留，不再更新
bff-business-state.json.sqlite    新的权威业务配置
```

导入与迁移标记在同一事务中完成。旧 JSON 无效时明确报错，不用空数据覆盖；修复旧文件后可重试。重启不会再从旧文件覆盖新数据。

部署前停止所有旧 BFF 实例并备份 `.data`。不能混跑仍写 JSON 的旧版本与读 SQLite 的新版本，也不能仅回退程序就认为旧 JSON 包含最新状态。数据库、WAL、技能包目录都应放在持久化卷；当前 SQLite 方案用于同机部署，不用于多主机共享网络文件系统。

### 数据恢复

SOP 在线快照沿用：

```bash
pnpm --filter agent-bff sops:backup before-upgrade
pnpm --filter agent-bff sops:health
```

离线恢复前停止所有访问该数据库的 BFF 进程，再执行：

```bash
pnpm --filter agent-bff sops:restore <备份文件名.sqlite>
pnpm --filter agent-bff sops:health
```

恢复命令只接受受控 backups 目录中的文件名。运行中的 API 恢复仅支持当前单 BFF 实例，不支持其他进程仍持有旧数据库连接的情况。恢复验证通过后再启动服务。

**SOP 快照只包含 workflows.sqlite，不是全产品备份。** 当前完整备份应停 BFF、Registry 和 Runtime 后，复制业务 SQLite、SOP SQLite、Registry SQLite 与包目录、BFF 技能目录、Runtime 状态以及模型连接密钥文件。恢复演练要同时检查配置、已发布版本、运行状态和包下载。自动备份、异地副本和自动恢复演练仍待下一阶段实现。

Registry 不迁移已有包路径；新版本包以内容哈希命名，旧版本继续从数据库记录的路径读取并检查哈希。相同版本不能靠重启种子数据来覆盖；修正内容应发布新版本。进程中断可能留下未引用的包或 staging 文件，本轮不自动删除运行数据。

## 后续路线与验收边界

| 阶段 | 必须实现 | 验收依据 |
| --- | --- | --- |
| 2：身份与隔离 | OIDC 身份接入；tenant、user、membership；资源 tenant_id 与复合外键；服务间身份；Runtime 沙箱/网络/文件权限隔离 | 租户 A 无法查询、编辑、下载或执行租户 B 的资源；异步任务、SSE、缓存同样隔离 |
| 3：持久化与执行可靠性 | PostgreSQL 领域表与迁移；对象存储不可变技能包；持久任务、幂等键、事务 outbox、重试与状态对账 | 重启、断网、重复投递、Worker 崩溃后可恢复，任务不因浏览器断开失去跟踪 |
| 4：额度与计费 | tenant 配额、并发限额、用量明细、追加式账本、预占/结算/释放、支付 webhook 幂等 | 并发不能超卖；重复 webhook 不重复记账；模型/工具失败的实际成本可解释 |
| 5：可观测与运维 | request/tenant/run 关联日志；指标、告警、SLO；自动备份、保留期、恢复演练；审计和密钥轮换 | 能定位失败请求，告警有效，演练得到可测量的 RPO/RTO |
| 6：容量与企业能力 | 真实负载压测、队列背压、按需水平扩容、企业成员权限和数据治理 | 容量上限和成本明确；扩容经过故障演练，而非凭经验拆微服务 |

建议继续保留模块化单体 BFF 与单一路径 Mastra Runtime；在有容量证据前不拆微服务。

下一阶段的核心表应先明确领域关系：`tenants`、`users`、`tenant_memberships`，以及带 tenant_id 的 Agent/SOP 草稿、不可变版本、会话、运行、技能制品和审计。数据归属必须由服务端已验证身份产生，不能信任客户端任意传入的 tenant_id；外键、唯一索引和 Repository 查询都要包含归属边界。

当前尚未解决的公网阻断项：BFF 没有用户认证与租户授权；Runtime 可运行宿主工具；Registry 的 `private` 只是来源标签，并未限制读取；运行投影更新仍依赖查询或 SSE 订阅，尚无独立后台对账；没有按租户计费与资源限额。这一阶段的测试通过不表示可以直接对外开放 SaaS。

## 本轮验证

在独立发布分支 `codex/server-hardening-release` 上验证，环境为 Node.js 24.16.0、pnpm 10.18.3：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | 通过 |
| `pnpm build` | 全仓构建通过 |
| `pnpm --filter agent-bff exec vitest run --no-cache` | 80 项通过，包含 API smoke 和存储回归 |
| `pnpm --filter skill-registry test` | 20 项通过，包含 HTTP smoke、不可变版本和哈希验证 |
| `pnpm --filter agent-cli test:workflow` | 84 项通过，包含并发运行、暂停恢复与重启恢复 |
| Agent 服务、Runtime 装配和存储定向回归 | 66 项通过；完整命令见 CI workflow |
| `pnpm check:workflow-boundaries` | 通过 |
| `git diff --check` | 通过 |

验证中发现基线的 `runtime/` 忽略规则漏掉了 Agent 必需的三个生产模块。本轮补齐 `apps/agent-cli/src/runtime/` 的 Runtime 装配、异步事件队列和 JSON 控制面仓库，并添加忽略例外及回归；JSON 写入使用直接原子重命名，读取错误明确抛出。发布分支未纳入其他对话的 Agent/前端目录重构。
