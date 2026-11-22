import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingPage } from "./LandingPage";

describe("正式落地页入口", () => {
  it("展示 A 版产品内容，主要入口跳转真实工作台", () => {
    const html = renderToStaticMarkup(<LandingPage />);
    expect(html).toContain("把想法，编排成");
    expect(html).toContain("能执行的 Agent。");
    expect(html.match(/href="\/studio"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('href="#demo"');
    expect(html).toContain('id="demo"');
    expect(html).not.toMatch(/canvas\.html|story\.html|runtime\.html|方案总览/);
  });
  it("所有页面内锚点都有目标，播放器静态内容完整可读", () => {
    const html = renderToStaticMarkup(<LandingPage />);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) expect(ids.has(id), id).toBe(true);
    for (const label of ["收集资料", "整理内容", "人工确认", "生成结果", "iteration-notes.md", "run.finished"])
      expect(html).toContain(label);
  });
  it("先呈现一个具体成果，将使用条件收在折叠问题里", () => {
    const html = renderToStaticMarkup(<LandingPage />);
    for (const label of ["整理反馈", "阅读提炼", "内容初稿", "交给 Orbit", "你得到", "第一次使用", "模型调用费用"])
      expect(html).toContain(label);
    expect(html).toContain('aria-controls="use-case-panel"');
    expect(html.match(/class="landing-question"/g)).toHaveLength(4);
    expect(html).not.toMatch(/<details[^>]*\bopen(?:[\s=>])/);
  });
});
