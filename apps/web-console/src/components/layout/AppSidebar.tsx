import { Boxes, LayoutList, MessageSquare, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun, Workflow } from "lucide-react";
import { BrandMark } from "../BrandMark";
import type { AppView } from "../../app/types";
import type { HealthStatus, SessionSummary, AgentProfile, SkillRegistryItem, UserProfile } from "../../api/index";
import type { SettingsSection } from "../../features/settings/lib/settings-route";
import type { ThemeMode } from "../../features/settings/lib/theme";

type SidebarProps = {
  view: AppView;
  health: HealthStatus | null;
  sessions: SessionSummary[];
  agents: AgentProfile[];
  installedSkills: SkillRegistryItem[];
  collapsed: boolean;
  workflowCount?: number | null;
  profile?: UserProfile;
  theme?: ThemeMode;
  onThemeToggle?: () => void;
  onNavigate: (view: AppView) => void;
  onToggleCollapsed: () => void;
  onOpenSettings: (section: SettingsSection) => void;
};

const workspaceNav: { label: string; view: AppView; icon: typeof LayoutList }[] = [
  { label: "Agent", view: "agent", icon: LayoutList },
  { label: "对话", view: "chat", icon: MessageSquare },
  { label: "工作流", view: "builder", icon: Workflow },
  { label: "技能", view: "skills", icon: Boxes },
];

/** 工作空间导航、运行连接状态和个人偏好入口。 */
export function AppSidebar({ view, health, sessions, agents, installedSkills, workflowCount, collapsed, profile, theme, onThemeToggle, onNavigate, onToggleCollapsed, onOpenSettings }: SidebarProps) {
  return (
    <aside id="workspace-sidebar" className="sidebar" aria-label="Orbit 工作台导航">
      <div className="brand"><span className="brand-mark" aria-hidden="true"><BrandMark size={17} /></span><span className="brand-copy"><strong>Orbit</strong><small>个人空间</small></span><button type="button" className="sidebar-collapse-action" aria-label={collapsed ? "展开侧栏" : "折叠侧栏"} title={collapsed ? "展开侧栏" : "折叠侧栏"} onClick={onToggleCollapsed}>{collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}</button></div>
      <nav className="nav" aria-label="工作台导航"><span className="nav-label">工作台</span>
        {workspaceNav.map(({ view: target, label, icon: Icon }) => {
          const badge = target === "agent" ? agents.length : target === "skills" ? installedSkills.length : target === "chat" ? sessions.length : workflowCount ?? "—";
          return <button key={target} type="button" className={`nav-item ${view === target ? "on" : ""}`} aria-current={view === target ? "page" : undefined} aria-label={label} title={label} onClick={() => onNavigate(target)}><Icon aria-hidden="true" /><span className="nav-item-label">{label}</span>{badge !== null ? <span className="nav-badge">{badge}</span> : null}</button>;
        })}
      </nav>
      <div className="sidebar-spacer" />
      <div className="foot">
        <button type="button" className="foot-item" title="设置" aria-label="设置" onClick={() => onOpenSettings("profile")}><Settings aria-hidden="true" /><span>设置</span></button>
        {onThemeToggle ? <button type="button" className="foot-item" title={theme === "dark" ? "切换浅色主题" : "切换深色主题"} aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"} onClick={onThemeToggle}>{theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}<span>{theme === "dark" ? "浅色外观" : "深色外观"}</span></button> : null}
        <div className={`health ${health?.ok ? "is-connected" : ""}`} role="status"><span className="health-dot" aria-hidden="true" /><span className="health-txt">运行时{health?.ok ? "已连接" : "未连接"}</span></div>
        <button type="button" className="sidebar-profile" aria-label="编辑个人资料" onClick={() => onOpenSettings("profile")}><span className="profile-initial">{(profile?.displayName || "O").slice(0, 1)}</span><span><strong>{profile?.displayName || "Orbit 用户"}</strong><small>个人账户</small></span></button>
      </div>
    </aside>
  );
}
