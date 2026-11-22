# Web Console

Orbit 的 React + TypeScript + Vite 前端，提供 Agent 管理、聊天测试、Skill Hub、SOP 画布和设置。

## 启动

完整服务启动与环境配置见[项目 README](../../README.md)。前端命令在仓库根目录执行：

```bash
pnpm dev:web
pnpm --filter agent-web-console test
pnpm build:web
```

默认地址为 `http://127.0.0.1:5173`。Vite 将 `/api/*` 代理到 BFF，使用 `VITE_BFF_URL` 可修改代理目标。

## 主页与工作台入口

`/` 使用 A 版「画布优先」落地页，工作台入口均指向 `/studio`；使用场景、运行演示和常见问题使用页内锚点。首页独立延迟加载，不初始化工作台或请求业务 API，前端单独启动也可预览。

`src/pages/LandingPage.tsx` 负责页面装配，内容、样式与交互位于 `src/features/landing/`。三种文本场景共用一处输入与成果预览，支持点击和方向键切换；上手步骤和默认折叠的 FAQ 说明当前模型、费用、数据和权限条件。成果内容、配置切换与运行时间轴均为本地示意，不调用模型、不创建真实运行。进入 `/studio` 后使用原有真实接口链路。

## 代码结构

- `src/main.tsx`：挂载 React。
- `src/app/`：路由、初始化和页面装配。
- `src/api/`：按领域组织接口、DTO 转换和 SSE；`src/api.ts` 是公共导出入口。
- `src/features/`：聊天、Agent、技能、SOP、设置的领域逻辑。
- `src/components/`：布局和展示组件。

开发与生产使用同一条真实接口链路，不默认注入模拟 Agent 或技能。后端不可用时显示连接与请求错误。

## 正式工作台视觉

正式入口为 `/studio`，已使用确定的「紧凑列表」方向。首页、导航、Agent、技能、SOP 和设置共用中性灰配色、连续列表与小尺寸控件，支持深浅主题和手机导航。页面使用真实 BFF API，不注入预览数据。

- `src/styles/compact-console.css`：主题令牌、应用边框和响应式导航。
- `src/styles/compact-collections.css`：Agent 表格、技能和 SOP 连续列表。
- `src/styles/compact-surfaces.css`：编辑表单、聊天、设置和画布面板。
- `src/features/agents/components/AgentList.tsx`：真实草稿列表、技能筛选和空间摘要。
- `src/features/agents/components/AgentEditor.tsx`：配置编辑与技能预检；保存仍由领域 hook 调用 API。

在独立 worktree 与主分支并行开发时，可使用单独端口和 worktree 内的数据目录：

```bash
AGENT_HTTP_PORT=3183 pnpm --filter agent-cli dev:server
BFF_PORT=3184 AGENT_SERVICE_BASE_URL=http://127.0.0.1:3183 SKILL_REGISTRY_SERVICE_URL=http://127.0.0.1:3192 pnpm dev:bff
SKILL_REGISTRY_PORT=3192 pnpm dev:skill-registry
VITE_BFF_URL=http://127.0.0.1:3184 pnpm dev:web --host 127.0.0.1 --port 5174
```

模型配置沿用根 README；BFF 和 Agent 的技能目录需按根 README 配置为同一位置。数据保留在各自 worktree 中，不复制或覆盖主分支运行数据。

## 正式工作流画布

工作流编辑器采用自由画布：文档栏、左侧面板入口、底部工具条和按需打开的节点配置共用工作台深浅主题。面板浮在画布上，打开或关闭时不挤压节点位置。

- `src/features/sop/editor/components/SopCanvasShell.tsx` 组合工具、图层、节点库、配置和运行面板；`SopCanvasViewport.tsx` 负责 React Flow 交互。
- `src/components/canvas/use-canvas-snapping.ts` 在位置变更提交前处理边缘与中心吸附，支持组拖动；按住 Alt 暂停吸附。
- `src/lib/canvas/` 计算避障正交路径，依次优先最短距离、最少转弯和同源 / 同目标共用干线。
- `src/features/sop/editor/sop-canvas-routing.ts` 适配真实业务端口，路由只用于展示，不写入工作流 JSON。输入输出同名时仍按端口方向区分。
- `src/features/sop/styles/free-canvas*.css` 按布局、面板、节点和窄屏规则拆分，复用现有主题变量。

空格临时平移，V / H 切换选择与平移，Shift + 1 适合窗口；支持滚轮移动、修饰键滚轮缩放、撤销重做、端口磁吸与连线重接。保存后继续留在画布；隐藏运行面板时保留运行事件监听。

验证：`pnpm build`、`pnpm --filter agent-web-console test`、`pnpm --filter agent-bff exec vitest run test/smoke/sops-api.test.ts test/smoke/workflow-runs-api.test.ts --no-cache`、`git diff --check`。

## 前端改版预览

启动 Web 后访问 [设计实验室](http://127.0.0.1:5173/design)。第二轮提供「紧凑列表」「内容目录」「双栏检查器」三个候选方向，每个方向支持浅色与深色主题，以及 Agent、对话、SOP 和技能场景。

预览通过独立入口延迟加载，示例数据与交互位于 `src/features/design-preview/`，页面装配位于 `src/pages/DesignPreviewPage.tsx`。预览不访问业务 API；配置、聊天、技能添加与流程运行均为本地演示。收藏方向保存在当前浏览器，方向与主题保存在 URL 中（`style=index|library|desk`、`theme=light|dark`），可复制链接对比；正式工作台入口仍为 `/studio`。

第二轮参考：

- [Linear 官方 UI 改版复盘](https://linear.app/now/how-we-redesigned-the-linear-ui)：减少应用边框的视觉噪声，统一侧栏、标题和详情面板的对齐与信息层级。
- [Notion 官方侧栏说明](https://www.notion.com/help/guides/navigating-with-the-sidebar)：将空间、导航、快捷访问和个人设置按用途分组。

三个方向用相同示例比较对象列表、内容目录和主从检查器的操作差异。旧方向的 URL 会回到紧凑列表；旧收藏不会作为第二轮的选择。
