import {
  Bot,
  Check,
  FileText,
  GitBranch,
  Globe,
  Play,
  Square,
  UserRound,
} from "lucide-react";
import type { Edge, Node } from "@xyflow/react";

/** 画布候选方案使用相同示例数据，比较布局而非业务差异。 */
export const canvasDirections = [
  {
    id: "studio",
    name: "设计工作台",
    caption: "固定双栏 · Figma 式布局",
    description: "图层在左，属性在右。熟悉、稳定，适合持续编辑和精确配置。",
    reference: "Figma",
    referenceUrl: "https://www.figma.com/design/",
  },
  {
    id: "float",
    name: "自由画布",
    caption: "悬浮面板 · 画布优先",
    description:
      "收起固定边栏，工具停靠在画布边缘。更适合浏览、梳理和展示复杂流程。",
    reference: "FigJam",
    referenceUrl: "https://www.figma.com/figjam/",
  },
  {
    id: "console",
    name: "调试工作台",
    caption: "紧凑节点 · 运行记录",
    description:
      "把输入输出、节点配置和运行记录放在一起，适合反复测试与排查问题。",
    reference: "Node-RED",
    referenceUrl: "https://nodered.org/",
  },
] as const;

/** 可切换的编辑器布局。 */
export type CanvasDirection = (typeof canvasDirections)[number]["id"];
/** 示例节点的种类及展示信息。 */
export const previewNodeKinds = {
  start: {
    label: "开始",
    icon: Play,
    tone: "neutral",
    description: "定义流程输入",
    detail: "topic · string",
    output: "topic",
  },
  research: {
    label: "Agent",
    icon: Bot,
    tone: "blue",
    description: "检索来源，整理研究简报",
    detail: "研究助手 · 网页检索",
    output: "report",
  },
  condition: {
    label: "条件分支",
    icon: GitBranch,
    tone: "amber",
    description: "检查资料是否充分",
    detail: "sources.length ≥ 3",
    output: "passed",
  },
  document: {
    label: "文档",
    icon: FileText,
    tone: "blue",
    description: "生成可分享的研究报告",
    detail: "Markdown · 引用来源",
    output: "document",
  },
  approval: {
    label: "人工确认",
    icon: UserRound,
    tone: "violet",
    description: "资料不足时转交人工",
    detail: "等待确认后继续",
    output: "decision",
  },
  end: {
    label: "结束",
    icon: Square,
    tone: "neutral",
    description: "返回最终结果",
    detail: "result · object",
    output: "result",
  },
  http: {
    label: "HTTP 请求",
    icon: Globe,
    tone: "blue",
    description: "从外部接口获取数据",
    detail: "GET · 配置请求地址",
    output: "response",
  },
  code: {
    label: "数据处理",
    icon: Check,
    tone: "neutral",
    description: "整理上游输出",
    detail: "输入 → 转换 → 输出",
    output: "data",
  },
} as const;

/** 预览内存中的节点数据，不对应生产流程协议。 */
export type CanvasNodeData = {
  kind: keyof typeof previewNodeKinds;
  label: string;
  description: string;
  model: string;
  prompt: string;
};
/** React Flow 节点直接复用所属库类型。 */
export type CanvasNode = Node<CanvasNodeData, "preview">;

/** 每次进入预览创建独立示例，不读写正式流程。 */
export function createPreviewNodes(): CanvasNode[] {
  return [
    {
      id: "start",
      type: "preview",
      position: { x: 0, y: 150 },
      data: {
        kind: "start",
        label: "开始",
        description: "研究主题",
        model: "",
        prompt: "",
      },
    },
    {
      id: "research",
      type: "preview",
      position: { x: 150, y: 130 },
      selected: true,
      data: {
        kind: "research",
        label: "资料研究",
        description: "收集可信来源，提炼关键信息",
        model: "跟随 Agent 配置",
        prompt:
          "围绕 {{ start.topic }} 搜集公开资料。\n核对来源与时间，整理主要发现。\n输出研究简报，并保留引用链接。",
      },
    },
    {
      id: "condition",
      type: "preview",
      position: { x: 400, y: 130 },
      data: {
        kind: "condition",
        label: "来源是否充分",
        description: "至少包含 3 个独立来源",
        model: "",
        prompt: "sources.length >= 3",
      },
    },
    {
      id: "document",
      type: "preview",
      position: { x: 650, y: 30 },
      data: {
        kind: "document",
        label: "生成简报",
        description: "整理结论与引用",
        model: "",
        prompt: "将研究内容整理为 Markdown 简报。",
      },
    },
    {
      id: "approval",
      type: "preview",
      position: { x: 650, y: 280 },
      data: {
        kind: "approval",
        label: "人工复核",
        description: "补充资料或确认继续",
        model: "",
        prompt: "请确认现有资料是否足以生成简报。",
      },
    },
    {
      id: "end",
      type: "preview",
      position: { x: 910, y: 150 },
      data: {
        kind: "end",
        label: "结束",
        description: "返回研究结果",
        model: "",
        prompt: "",
      },
    },
  ];
}

/** 分支连线通过文字区分路径，避免仅依赖颜色。 */
export function createPreviewEdges(): Edge[] {
  return [
    { id: "start-research", source: "start", target: "research" },
    { id: "research-condition", source: "research", target: "condition" },
    {
      id: "condition-document",
      source: "condition",
      target: "document",
      label: "充分",
    },
    {
      id: "condition-approval",
      source: "condition",
      target: "approval",
      label: "待复核",
    },
    { id: "document-end", source: "document", target: "end" },
    { id: "approval-end", source: "approval", target: "end" },
  ].map((edge) => ({ ...edge, type: "smart" }));
}
