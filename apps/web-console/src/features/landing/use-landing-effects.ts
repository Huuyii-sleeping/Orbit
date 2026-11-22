import { useEffect, type RefObject } from "react";

/** 页内视觉反馈的生命周期；卸载后释放事件、观察器和动画帧。 */
export function useLandingEffects(ref: RefObject<HTMLDivElement>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const controller = new AbortController();
    const { signal } = controller;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frames = new Set<number>();
    const observers: IntersectionObserver[] = [];
    const oldTitle = document.title;
    document.title = "Orbit · 把想法，编排成能执行的 Agent";
    document.documentElement.classList.add("orbit-landing-active");
    root.classList.add("enhanced");
    if (!reduced) root.classList.add("js-motion");
    // 延迟加载页面后，浏览器首次定位 hash 时目标可能尚未挂载。
    const anchor = document.getElementById(window.location.hash.slice(1));
    if (anchor && root.contains(anchor)) {
      frames.add(requestAnimationFrame(() => anchor.scrollIntoView({ behavior: "instant" })));
    }
    const select = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    const all = <T extends HTMLElement = HTMLElement>(selector: string) => [...root.querySelectorAll<T>(selector)];
    const nav = select(".nav");
    const updateNav = () => nav.classList.toggle("scrolled", scrollY > 8);
    addEventListener("scroll", updateNav, { passive: true, signal });
    updateNav();
    const menu = select<HTMLButtonElement>(".menu-toggle");
    const links = select(".nav-links");
    function closeMenu() {
      menu.setAttribute("aria-expanded", "false");
      menu.setAttribute("aria-label", "展开导航");
      links.classList.remove("open");
    }
    menu.addEventListener(
      "click",
      () => {
        const open = menu.getAttribute("aria-expanded") !== "true";
        menu.setAttribute("aria-expanded", String(open));
        menu.setAttribute("aria-label", open ? "收起导航" : "展开导航");
        links.classList.toggle("open", open);
      },
      { signal },
    );
    all<HTMLAnchorElement>(".nav-links a").forEach((link) => link.addEventListener("click", closeMenu, { signal }));
    root.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") closeMenu();
      },
      { signal },
    );
    if (!reduced) {
      const reveal = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("visible");
              reveal.unobserve(entry.target);
            }
          }),
        { threshold: 0.15 },
      );
      all(".reveal").forEach((element) => reveal.observe(element));
      observers.push(reveal);
      const decode = select(".decode");
      const final = decode.textContent ?? "";
      decode.setAttribute("aria-label", final);
      let start = 0;
      function tick(now: number) {
        start ||= now;
        const progress = Math.min(1, (now - start) / 900);
        decode.textContent = [...final]
          .map((char, index) =>
            char === " " || index < progress * final.length
              ? char
              : "ABCDEFGHIJKLMNOPQRSTUVWXYZ+-/"[Math.floor(Math.random() * 29)],
          )
          .join("");
        if (progress < 1) frames.add(requestAnimationFrame(tick));
      }
      frames.add(requestAnimationFrame(tick));
      if (matchMedia("(min-width: 1024px) and (pointer: fine)").matches) {
        all(".magnet").forEach((element) => {
          element.addEventListener(
            "pointermove",
            (event) => {
              const rect = element.getBoundingClientRect();
              element.style.transform = `translate(${Math.max(-12, Math.min(12, (event.clientX - rect.left - rect.width / 2) * 0.1))}px,${Math.max(-8, Math.min(8, (event.clientY - rect.top - rect.height / 2) * 0.15))}px)`;
            },
            { signal },
          );
          element.addEventListener(
            "pointerleave",
            () => {
              element.style.transform = "";
            },
            { signal },
          );
        });
      }
    }
    function highlight(id: string, enabled: boolean) {
      all(`[data-node="${id}"],[data-event="${id}"]`).forEach((element) =>
        element.classList.toggle("highlight", enabled),
      );
    }
    all("[data-node],[data-event]").forEach((element) => {
      const id = element.dataset.node ?? element.dataset.event!;
      for (const event of ["mouseenter", "focus"])
        element.addEventListener(event, () => highlight(id, true), { signal });
      for (const event of ["mouseleave", "blur"])
        element.addEventListener(event, () => highlight(id, false), { signal });
    });
    const copy = [
      [
        "SYSTEM PROMPT",
        "你是研发纪要助手。收集本周 Agent 的运行反馈，按主题整理，并输出可用于下一轮迭代的结构化纪要。",
      ],
      ["MODEL", "选择已配置的模型连接。模型凭据由 Agent 服务管理，不写入 Agent 草稿和发布版本。"],
      ["TOOL PERMISSIONS", "显式指定允许使用的工具。新建 Agent 默认不授权工具，发布版本固定已保存的工具权限。"],
      ["PINNED SKILLS", "summarize-thread / v2 · extract-entities / v4。绑定已安装的固定版本技能。"],
      ["OUTPUT SCHEMA", "默认使用内置文本契约，也可配置 JSON Schema。试跑时按保存的输出格式检查结果。"],
    ];
    const configTabs = all<HTMLButtonElement>("[data-config]");
    const panel = select("[data-config-panel]");
    function configure(index: number) {
      configTabs.forEach((button, item) => {
        button.setAttribute("aria-selected", String(item === index));
        button.tabIndex = item === index ? 0 : -1;
      });
      panel.querySelector("span")!.textContent = copy[index][0];
      panel.querySelector("p")!.textContent = copy[index][1];
    }
    configTabs.forEach((button, index) => {
      button.tabIndex = index === 0 ? 0 : -1;
      button.addEventListener("click", () => configure(index), { signal });
      button.addEventListener(
        "keydown",
        (event) => {
          const next =
            event.key === "ArrowRight" ? (index + 1) % 5 : event.key === "ArrowLeft" ? (index + 4) % 5 : null;
          if (next !== null) {
            event.preventDefault();
            configure(next);
            configTabs[next].focus();
          }
        },
        { signal },
      );
    });
    return () => {
      controller.abort();
      observers.forEach((observer) => observer.disconnect());
      frames.forEach(cancelAnimationFrame);
      root.classList.remove("js-motion", "enhanced");
      document.documentElement.classList.remove("orbit-landing-active");
      document.title = oldTitle;
    };
  }, [ref]);
}
