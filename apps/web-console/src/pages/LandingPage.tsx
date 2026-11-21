import { ArrowRight, Boxes, LayoutList, MessageSquare, Workflow } from "lucide-react";
import { BrandMark } from "../components/BrandMark";

const areas = [
  { icon: LayoutList, title: "Agent", description: "定义职责与提示词，绑定需要的技能。" },
  { icon: MessageSquare, title: "对话", description: "创建测试会话，查看回复与工具调用。" },
  { icon: Workflow, title: "工作流", description: "连接流程节点，测试并管理发布版本。" },
  { icon: Boxes, title: "技能", description: "查找技能，管理安装版本与权限。" },
];

/** 工作台入口，与正式应用共用紧凑列表视觉系统。 */
export function LandingPage({ onStart }: { onStart: () => void }) {
  return <div className="compact-console compact-entry">
    <header className="entry-header"><a href="/" aria-label="Orbit 首页"><BrandMark size={22} /><strong>Orbit</strong></a><button type="button" className="entry-link" onClick={onStart}>进入工作台 <ArrowRight aria-hidden="true" /></button></header>
    <main className="entry-main"><div className="entry-intro"><span>个人 Agent 工作空间</span><h1>配置、测试，<br />把工作组织起来。</h1><p>在一个工作台里管理 Agent、技能与 工作流。</p><button type="button" className="entry-start" onClick={onStart}>打开工作台 <ArrowRight aria-hidden="true" /></button></div>
      <div className="entry-directory">{areas.map(({ icon: Icon, title, description }) => <div key={title} className="entry-area"><Icon aria-hidden="true" /><div><h2>{title}</h2><p>{description}</p></div></div>)}</div>
    </main><footer className="entry-footer"><span>Orbit</span><span>Agent · Skills · Workflows</span></footer>
  </div>;
}
