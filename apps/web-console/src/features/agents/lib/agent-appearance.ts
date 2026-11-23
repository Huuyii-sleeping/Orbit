import { Bot, Code2, PenTool, BarChart3, FileText } from "lucide-react";

/** Shared accent palette used by both the auto-hash fallback and the color picker. */
export const ACCENT_PALETTE: readonly { value: string; label: string }[] = [
  { value: "#3b82f6", label: "蓝" },
  { value: "#8b5cf6", label: "紫" },
  { value: "#f59e0b", label: "琥珀" },
  { value: "#ec4899", label: "粉" },
  { value: "#06b6d4", label: "青" },
  { value: "#84cc16", label: "青柠" },
  { value: "#f43f5e", label: "玫红" },
];

/** Stable accent color derived from agent id (deterministic, no random). */
function agentAccent(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return ACCENT_PALETTE[Math.abs(hash) % ACCENT_PALETTE.length].value;
}

/** Resolve an agent's effective accent: explicit color wins, else deterministic hash. */
export function resolveAccent(color: string, id: string): string {
  return color || agentAccent(id);
}

/** Pick a lucide icon component based on scenario keywords. */
export function agentSceneIcon(scenario: string): typeof Code2 {
  const s = scenario.toLowerCase();
  if (/代码|编程|技术|code|dev/i.test(s)) return Code2;
  if (/内容|写作|文案|翻译|创作|write|content/i.test(s)) return PenTool;
  if (/数据|分析|统计|报表|data|analy/i.test(s)) return BarChart3;
  if (/文档|文件|pdf|doc|file/i.test(s)) return FileText;
  return Bot;
}

/** Short label extracted from scenario text for the card tag. */
export function agentSceneLabel(scenario: string, maxLen = 10): string {
  const first = scenario.split(/[,，、]/)[0].trim();
  return first.length > maxLen ? first.slice(0, maxLen) : first;
}

/** Truncate string to max length, adding ellipsis if needed. */
export function ellipsis(text: string, max = 60): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}
