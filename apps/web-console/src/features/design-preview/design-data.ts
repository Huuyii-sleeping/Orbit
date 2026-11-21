import {
  Bot,
  ChartNoAxesCombined,
  Code2,
  FileText,
  MessageSquare,
  Workflow,
  Boxes,
} from "lucide-react";

/** 设计候选的视觉方向，独立于正式工作台的主题。 */
export const directions = [
  {
    id: "index",
    name: "紧凑列表",
    english: "Index",
    note: "列表优先 · 快速管理",
    description:
      "固定侧栏与紧凑列表，直接查看版本、技能绑定和最近测试。适合频繁切换、管理多个 Agent。",
    colors: ["#fafafa", "#eaecee", "#525d6d", "#44745c"],
    reference: "Linear UI redesign",
    referenceUrl: "https://linear.app/now/how-we-redesigned-the-linear-ui",
  },
  {
    id: "library",
    name: "内容目录",
    english: "Library",
    note: "内容优先 · 安静阅读",
    description:
      "按用途组织 Agent，展示职责说明与能力清单。宽松的行距与内容分组，适合从任务出发寻找 Agent。",
    colors: ["#ffffff", "#f3f2ee", "#4b5e50", "#b4b4a9"],
    reference: "Notion sidebar navigation",
    referenceUrl:
      "https://www.notion.com/help/guides/navigating-with-the-sidebar",
  },
  {
    id: "desk",
    name: "双栏检查器",
    english: "Workbench",
    note: "列表 + 详情 · 连续配置",
    description:
      "左侧选择 Agent，右侧检查配置与测试记录。减少来回跳转，适合配置、测试与版本核对。",
    colors: ["#f1f3f6", "#ffffff", "#547199", "#8995a4"],
    reference: "Linear structured layouts",
    referenceUrl: "https://linear.app/now/how-we-redesigned-the-linear-ui",
  },
] as const;

/** 预览内可切换的产品场景。 */
export const previewViews = [
  { id: "agents", label: "我的 Agent", short: "Agent", icon: Bot },
  { id: "chat", label: "测试对话", short: "对话", icon: MessageSquare },
  { id: "workflow", label: "SOP 工作流", short: "工作流", icon: Workflow },
  { id: "skills", label: "技能中心", short: "技能", icon: Boxes },
] as const;

/** 预览使用的示例数据，不读写正式业务数据。 */
export const sampleAgents = [
  {
    id: "research",
    name: "行业研究助手",
    role: "行业动态检索、来源核对与研究报告",
    description: "检索资料、交叉验证来源，生成结构化的研究报告。",
    category: "研究分析",
    icon: ChartNoAxesCombined,
    tone: "purple",
    skills: ["网页检索", "数据分析", "报告生成"],
    version: "v1.2",
    updated: "18 分钟前",
    lastTest: "通过",
    code: "AGT-001",
    owner: "Huayi",
    status: "已发布",
  },
  {
    id: "writing",
    name: "内容编辑",
    role: "选题整理、内容起草与文案校对",
    description: "根据选题和资料起草内容，检查措辞、结构与事实表述。",
    category: "内容创作",
    icon: FileText,
    tone: "pink",
    skills: ["内容写作", "风格改写"],
    version: "v1.0",
    updated: "昨天",
    lastTest: "通过",
    code: "AGT-002",
    owner: "Huayi",
    status: "已发布",
  },
  {
    id: "coding",
    name: "代码审查",
    role: "变更审查、问题定位与修复建议",
    description: "理解代码库、审查变更，给出可以直接执行的建议。",
    category: "开发工具",
    icon: Code2,
    tone: "mint",
    skills: ["代码审查", "文件操作", "终端执行"],
    version: "草稿",
    updated: "2 天前",
    lastTest: "待测试",
    code: "AGT-003",
    owner: "Huayi",
    status: "未发布",
  },
];

export const sampleSkills = [
  {
    id: "web-search",
    name: "网页检索",
    category: "信息获取",
    description: "搜索、阅读网页，并保留可追溯的信息来源。",
    icon: "search",
    tone: "purple",
  },
  {
    id: "data-analysis",
    name: "数据分析",
    category: "研究分析",
    description: "从表格与数据中提取洞察，生成清晰的图表。",
    icon: "chart",
    tone: "mint",
  },
  {
    id: "content-writing",
    name: "内容写作",
    category: "内容创作",
    description: "把你的想法组织成有条理、有风格的内容。",
    icon: "write",
    tone: "pink",
  },
  {
    id: "code-review",
    name: "代码审查",
    category: "开发工具",
    description: "理解代码变更，发现问题并提出修复建议。",
    icon: "code",
    tone: "blue",
  },
] as const;

export type PreviewView = (typeof previewViews)[number]["id"];
export type DesignDirection = (typeof directions)[number]["id"];

/** 预览配置和列表共用的 Agent 结构。 */
export type PreviewAgent = (typeof sampleAgents)[number];

/** 示例运行记录，用于观察列表和详情的信息层级。 */
export const sampleRuns = [
  {
    id: "RUN-018",
    title: "整理本周 AI 行业动态",
    agent: "行业研究助手",
    time: "今天 09:42",
    duration: "24.8s",
    status: "已完成",
  },
  {
    id: "RUN-017",
    title: "校对产品更新说明",
    agent: "内容编辑",
    time: "昨天 16:20",
    duration: "12.3s",
    status: "已完成",
  },
  {
    id: "RUN-016",
    title: "核对研究报告中的引用",
    agent: "行业研究助手",
    time: "昨天 14:08",
    duration: "18.6s",
    status: "已完成",
  },
];
