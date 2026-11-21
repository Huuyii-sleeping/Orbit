import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Columns2,
  List,
  Moon,
  Rows3,
  Sun,
} from "lucide-react";
import {
  directions,
  type DesignDirection,
} from "../features/design-preview/design-data";
import { PreviewWorkspace } from "../features/design-preview/components/PreviewWorkspace";
import "../features/design-preview/styles/preview.css";
import "../features/design-preview/styles/directions.css";

const directionIcons = { index: List, library: Rows3, desk: Columns2 };

/** 改版候选入口：比较信息组织、密度和操作方式，独立于正式业务。 */
export default function DesignPreviewPage() {
  const params = new URLSearchParams(window.location.search);
  const [direction, setDirection] = useState<DesignDirection>(
    () =>
      directions.find((item) => item.id === params.get("style"))?.id ?? "index",
  );
  const [theme, setTheme] = useState(() =>
    params.get("theme") === "dark" ? "dark" : "light",
  );
  const [favorite, setFavorite] = useState(() => {
    const saved = localStorage.getItem("orbit-design-favorite-v2");
    return directions.some((item) => item.id === saved) ? saved : null;
  });
  const selected = directions.find((item) => item.id === direction)!;

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("style", direction);
    url.searchParams.set("theme", theme);
    window.history.replaceState(null, "", url);
    document.title = `${selected.name} · Orbit 界面预览`;
  }, [direction, theme, selected.name]);

  function toggleFavorite() {
    const next = favorite === direction ? null : direction;
    setFavorite(next);
    if (next) localStorage.setItem("orbit-design-favorite-v2", next);
    else localStorage.removeItem("orbit-design-favorite-v2");
  }

  return (
    <div
      className="design-lab"
      data-direction={direction}
      data-preview-theme={theme}
    >
      <header className="lab-header">
        <a className="lab-brand" href="/design">
          orbit<span>/</span>
          <span>界面预览</span>
        </a>
        <span className="lab-revision">第二轮 · 工作台</span>
        <a className="lab-return" href="/studio">
          正式工作台
          <ArrowUpRight size={13} />
        </a>
      </header>
      <div className="lab-selection">
        <nav className="direction-picker" aria-label="设计方向">
          {directions.map((item) => {
            const Icon = directionIcons[item.id];
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={direction === item.id}
                className={`direction-option ${direction === item.id ? "is-selected" : ""}`}
                onClick={() => setDirection(item.id)}
              >
                <Icon size={17} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.note}</small>
                </span>
                {favorite === item.id && (
                  <Check size={13} aria-label="已收藏" />
                )}
              </button>
            );
          })}
        </nav>
        <div className="preview-controls">
          <button
            type="button"
            className="theme-switch"
            aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
            <span>{theme === "light" ? "深色" : "浅色"}</span>
          </button>
          <button
            type="button"
            className="favorite-button"
            aria-pressed={favorite === direction}
            onClick={toggleFavorite}
          >
            {favorite === direction && <Check size={13} />}
            {favorite === direction ? "已收藏" : "收藏方案"}
          </button>
        </div>
      </div>
      <div className="preview-toolbar">
        <p>{selected.description}</p>
        <a href={selected.referenceUrl} target="_blank" rel="noreferrer">
          设计参考：{selected.reference}
          <ArrowUpRight size={11} />
        </a>
      </div>
      <PreviewWorkspace direction={direction} />
      <footer className="lab-footer">
        <span>交互原型 · 示例内容，不写入正式数据</span>
        <span role="status">
          {favorite
            ? `已收藏：${directions.find((item) => item.id === favorite)?.name}`
            : "三个方案均支持深浅主题"}
        </span>
      </footer>
    </div>
  );
}
