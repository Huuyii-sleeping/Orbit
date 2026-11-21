import { ErrorNotice } from "../components/feedback/ErrorNotice";
import { getErrorMessage } from "../lib/errors/error-factory";
import { useEffect, useState } from "react";
import {
  appRouteFromPathname,
  appRoutePath,
  type AppRoute,
} from "../app-route";
import {
  settingsSectionFromHash,
  type SettingsSection,
} from "../settings-route";
import type { AppView } from "./types";
import { streamLabel } from "../features/chat/lib/chat-format";
import { useChat } from "../features/chat/hooks/use-chat";
import { useAgents } from "../features/agents/hooks/use-agents";
import { useSkills } from "../features/skills/hooks/use-skills";
import { useProfile } from "../features/settings/hooks/use-profile";
import { LandingPage } from "../pages/LandingPage";
import { AppSidebar } from "../components/layout/AppSidebar";
import { WorkspaceTopBar } from "../components/workspace/WorkspaceTopBar";
import { ChatView } from "../components/workspace/views/ChatView";
import { AgentView } from "../components/workspace/views/AgentView";
import { SkillsView } from "../components/workspace/views/SkillsView";
import { SopBuilderView } from "../components/workspace/views/SopBuilderView";
import { SettingsView } from "../components/workspace/views/SettingsView";

/** 装配工作台页面、路由和各领域状态。 */
export function App() {
  const initialSettingsSection =
    typeof window === "undefined"
      ? null
      : settingsSectionFromHash(window.location.hash);
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window === "undefined"
      ? "workspace"
      : appRouteFromPathname(window.location.pathname),
  );
  const [view, setView] = useState<AppView>(
    initialSettingsSection ? "settings" : "agent",
  );
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(
    initialSettingsSection ?? "profile",
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [topQuery, setTopQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const {
    skillRegistry,
    skillAuditEvents,
    installedSkills,
    skillRegistryRefreshing,
    skillUploadOpen,
    setSkillUploadOpen,
    refreshSkills,
    handleRefreshSkillRegistry,
    handleSkillAction,
    handleUploadSkillPackage,
  } = useSkills(setError);
  const {
    agents,
    activeAgent,
    activeAgentId,
    agentDraft,
    isNewAgentDraft,
    agentSaving,
    agentError,
    agentSkillPreflight,
    agentSkillPreflightLoading,
    refreshAgentsSafely,
    selectAgent,
    handleCreateAgent,
    handleAgentDraftChange,
    handleResolveAgentSkills,
    handleSaveAgent,
    handleDeleteAgent,
    discardAgentDraft,
  } = useAgents(skillRegistry, () => setView("agent"));
  const {
    health,
    sessions,
    visibleSessions,
    activeSession,
    activeSessionId,
    draft,
    setDraft,
    setLoadState,
    streamState,
    isBusy,
    canSend,
    textareaRef,
    refreshHealth,
    refreshSessions,
    handleCreateSession,
    handleSend,
    handleComposerKeyDown,
  } = useChat(activeAgent, () => setView("chat"), setError);
  const {
    profile,
    profileDraft,
    setProfileDraft,
    editingProfile,
    theme,
    refreshProfile,
    handleThemeToggle,
    toggleProfileEdit,
    cancelProfileEdit,
    saveProfile,
  } = useProfile(setError);
  const installedSkillCount = installedSkills.length;

  async function bootstrap(): Promise<void> {
    setLoadState("loading");
    const profileResult = refreshProfile();
    const agentResult = refreshAgentsSafely(true);
    const skillsResult = refreshSkills();
    const runtimeResultsPromise = Promise.allSettled([
      refreshHealth(),
      refreshSessions(true),
    ]);
    const businessResultsPromise = Promise.allSettled([
      profileResult,
      agentResult,
      skillsResult,
    ]);
    const [runtimeResults, businessResults] = await Promise.all([
      runtimeResultsPromise,
      businessResultsPromise,
    ]);
    const failedRuntime = runtimeResults.find(
      (result) => result.status === "rejected",
    );
    const failedBusiness = businessResults.find(
      (result) => result.status === "rejected",
    );

    if (failedRuntime?.status === "rejected") {
      setError(
        getErrorMessage(failedRuntime.reason),
      );
    } else if (failedBusiness?.status === "rejected") {
      setError(
        getErrorMessage(failedBusiness.reason),
      );
    } else {
      setError(null);
    }
    setLoadState("idle");
  }

  function openSettings(section: SettingsSection): void {
    setMobileNavOpen(false);
    setTopQuery("");
    setSettingsSection(section);
    setView("settings");
    setRoute("workspace");
    if (window.location.pathname !== appRoutePath("workspace")) {
      window.history.pushState(
        "",
        document.title,
        `${appRoutePath("workspace")}#settings/${section}`,
      );
      return;
    }
    window.location.hash = `settings/${section}`;
  }

  function backToChat(): void {
    setView("chat");
    if (window.location.hash.startsWith("#settings")) {
      window.history.pushState(
        "",
        document.title,
        window.location.pathname + window.location.search,
      );
    }
  }

  function openWorkspace(initialView: AppView = "agent"): void {
    setRoute("workspace");
    setView(initialView);
    if (
      window.location.pathname !== appRoutePath("workspace") ||
      window.location.hash
    ) {
      window.history.pushState("", document.title, appRoutePath("workspace"));
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    function handlePopState(): void {
      const nextRoute = appRouteFromPathname(window.location.pathname);
      setRoute(nextRoute);
      if (nextRoute === "workspace") {
        const nextSection = settingsSectionFromHash(window.location.hash);
        if (nextSection) {
          setSettingsSection(nextSection);
          setView("settings");
          return;
        }
        setView((current) => (current === "settings" ? "chat" : current));
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    function handleHashChange(): void {
      const nextSection = settingsSectionFromHash(window.location.hash);
      if (nextSection) {
        setSettingsSection(nextSection);
        setView("settings");
        return;
      }
      setView((current) => (current === "settings" ? "chat" : current));
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function navigate(view: AppView): void {
    setView(view);
    setTopQuery("");
    setMobileNavOpen(false);
    if (window.location.hash.startsWith("#settings")) {
      window.history.pushState("", document.title, window.location.pathname + window.location.search);
    }
  }

  useEffect(() => {
    if (!mobileNavOpen) return;
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setMobileNavOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  const topMeta = {
    chat: {
      title: activeAgent ? `与 ${activeAgent.name} 对话` : "对话",
      sub: `${streamLabel(streamState)} · ${health?.ok ? "运行时已连接" : "运行时未连接"}`,
      primary: "新建会话",
      onPrimary: () => void handleCreateSession(),
    },
    agent: {
      title: "Agent",
      sub: `${agents.length} 个草稿 · ${installedSkillCount} 个已安装技能`,
      primary: "新建 Agent",
      onPrimary: handleCreateAgent,
    },
    skills: {
      title: "技能",
      sub: `${skillRegistry.length} 个技能 · ${installedSkillCount} 已安装`,
      primary: "上传技能包",
      onPrimary: () => setSkillUploadOpen(true),
    },
    builder: { title: "工作流", sub: "流程编排 · 版本管理", primary: "", onPrimary: () => {} },
    settings: { title: "设置", sub: "个人资料 · 偏好 · 系统", primary: "", onPrimary: () => {} },
  }[view];

  if (route === "landing") {
    return <LandingPage onStart={() => openWorkspace("agent")} />;
  }

  return (
    <div className={`orbit-studio compact-console ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
      <div className={`shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        {mobileNavOpen ? <button type="button" className="sidebar-scrim" aria-label="关闭导航遮罩" onClick={() => setMobileNavOpen(false)} /> : null}
        <AppSidebar
          view={view}
          health={health}
          sessions={visibleSessions}
          agents={agents}
          installedSkills={installedSkills}
          collapsed={isSidebarCollapsed}
          profile={profile}
          theme={theme}
          onThemeToggle={handleThemeToggle}
          onNavigate={navigate}
          onToggleCollapsed={() => setIsSidebarCollapsed((current) => !current)}
          onOpenSettings={openSettings}
        />
        <main className="main">
          <WorkspaceTopBar
            title={topMeta.title}
            sub={topMeta.sub}
            primary={topMeta.primary}
            searchPlaceholder={view === "agent" ? "搜索 Agent…" : view === "skills" ? "搜索技能…" : view === "builder" ? "搜索工作流…" : undefined}
            mobileNavOpen={mobileNavOpen}
            onToggleMobileNav={() => setMobileNavOpen((current) => !current)}
            query={topQuery}
            onQueryChange={setTopQuery}
            onPrimary={topMeta.onPrimary}
          />
          <div className="view">
            {error && view !== "chat" && !(view === "agent" && error === agentError) ? (
              <ErrorNotice message={error} onRetry={() => void bootstrap()} />
            ) : null}
            <ChatView
              active={view === "chat"}
              activeAgent={activeAgent}
              activeSession={activeSession}
              activeSessionId={activeSessionId}
              messages={activeSession?.messages ?? []}
              draft={draft}
              canSend={canSend}
              isBusy={isBusy}
              error={error}
              streamState={streamState}
              health={health}
              textareaRef={textareaRef}
              onDraftChange={setDraft}
              onSend={(event) => void handleSend(event)}
              onComposerKeyDown={handleComposerKeyDown}
              onCreateSession={() => void handleCreateSession()}
              onBootstrap={() => void bootstrap()}
            />
            <AgentView
              active={view === "agent"}
              agents={agents}
              query={topQuery}
              onClearQuery={() => setTopQuery("")}
              sessions={visibleSessions}
              activeAgentId={activeAgentId}
              onSelectAgent={selectAgent}
              draft={agentDraft}
              activeAgent={activeAgent}
              isNewDraft={isNewAgentDraft}
              error={agentError}
              saving={agentSaving}
              installedSkills={installedSkills}
              skillPreflight={agentSkillPreflight}
              skillPreflightLoading={agentSkillPreflightLoading}
              onDraftChange={handleAgentDraftChange}
              onResolveAgentSkills={() => void handleResolveAgentSkills()}
              onSaveAgent={() => void handleSaveAgent()}
              onDiscardDraft={discardAgentDraft}
              onDeleteAgent={(agent) => void handleDeleteAgent(agent)}
              onNewAgent={() => void handleCreateAgent()}
              onRefresh={() => void refreshAgentsSafely(true)}
            />
            <SkillsView
              active={view === "skills"}
              skills={skillRegistry}
              agents={agents}
              auditEvents={skillAuditEvents}
              query={topQuery}
              registryRefreshing={skillRegistryRefreshing}
              uploadOpen={skillUploadOpen}
              onUploadOpenChange={setSkillUploadOpen}
              onSkillAction={(skill) => void handleSkillAction(skill)}
              onUploadPackage={(input) => void handleUploadSkillPackage(input)}
              onRefreshRegistry={() => void handleRefreshSkillRegistry()}
            />
            <SopBuilderView active={view === "builder"} query={topQuery} theme={theme} onThemeToggle={handleThemeToggle} />
            <SettingsView
              active={view === "settings"}
              activeSection={settingsSection}
              health={health}
              sessionCount={sessions.length}
              streamState={streamState}
              theme={theme}
              editingProfile={editingProfile}
              profile={profile}
              profileDraft={profileDraft}
              onBack={backToChat}
              onCancelProfileEdit={cancelProfileEdit}
              onProfileDraftChange={setProfileDraft}
              onSaveProfile={() => void saveProfile()}
              onSectionChange={setSettingsSection}
              onToggleProfileEdit={toggleProfileEdit}
              onThemeToggle={handleThemeToggle}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
