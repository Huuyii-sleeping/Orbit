# Skill Registry

提供技能发布者、版本、技能包和审计记录的独立 HTTP 服务。

在仓库根目录执行：

```bash
pnpm dev:skill-registry
pnpm test:skill-registry
pnpm build:skill-registry
```

默认监听 `3190`。启动配置和持久化目录见根 [README](../../README.md)。相对数据路径以服务进程的工作目录为准；需要共享目录或种子文件时显式设置绝对路径。

- `src/main.ts`、`config.ts`：启动和环境配置。
- `src/http/`：路由、认证和 HTTP 响应。
- `src/registry/`：目录、版本和 SQLite 持久化。
- `src/packages/`：技能包路径、校验和内容处理。
- `src/types.ts`：本服务共享数据类型。
- `test/smoke/`：真实 HTTP 发布、查询和下载验证。
