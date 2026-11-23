import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";

function visibleText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(visibleText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(value)) return visibleText(value.props.children);
  return "";
}

describe("AppSidebar", () => {
  it("只展示 Agent 工作台入口，不提供独立审批收件箱", () => {
    const sidebar = AppSidebar({
      view: "agent",
      health: { ok: true, connected: true, bffStatus: "ok", agentStatus: "ok" },
      sessions: [],
      agents: [],
      installedSkills: [],
      workflowCount: 7,
      collapsed: false,
      onNavigate: vi.fn(),
      onToggleCollapsed: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    expect(visibleText(sidebar)).not.toContain("审批收件箱");
    expect(visibleText(sidebar)).toMatch(/工作流\s+7/);
  });
});
