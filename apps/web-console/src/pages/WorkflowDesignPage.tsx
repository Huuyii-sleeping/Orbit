import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Columns3,
  Moon,
  PanelsTopLeft,
  Sun,
  Terminal,
} from "lucide-react";
import {
  canvasDirections,
  type CanvasDirection,
} from "../features/workflow-design/canvas-design-data";
import { WorkflowCanvasPreview } from "../features/workflow-design/WorkflowCanvasPreview";
import "@xyflow/react/dist/style.css";
import "../features/workflow-design/styles/canvas-preview.css";
import "../features/workflow-design/styles/canvas-directions.css";

const directionIcons = {
  studio: Columns3,
  float: PanelsTopLeft,
  console: Terminal,
};

/** 工作流编辑器的三个可交互方案，用户选定方向后再接入正式编辑器。 */
export default function WorkflowDesignPage() {
  const params = new URLSearchParams(window.location.search);
  const [direction, setDirection] = useState<CanvasDirection>(
    () =>
      canvasDirections.find((item) => item.id === params.get("style"))?.id ??
      "studio",
  );
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    params.get("theme") === "dark" ? "dark" : "light",
  );
  const [favorite, setFavorite] = useState(() =>
    localStorage.getItem("orbit-workflow-design-favorite"),
  );
  const selected = canvasDirections.find((item) => item.id === direction)!;

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("style", direction);
    url.searchParams.set("theme", theme);
    window.history.replaceState(null, "", url);
    document.title = `${selected.name} · Orbit 画布预览`;
  }, [direction, theme, selected.name]);

  return (
    <div className="workflow-lab" data-theme={theme}>
      <header className="wl-header">
        <a href="/studio">
          <ArrowLeft size={13} />
          工作台
        </a>
        <span className="wl-header-divider" />
        <strong>画布设计</strong>
        <span className="wl-header-note">选择适合你的工作方式</span>
        <a
          className="wl-reference"
          href={selected.referenceUrl}
          target="_blank"
          rel="noreferrer"
        >
          参考 {selected.reference}
          <ArrowUpRight size={12} />
        </a>
        <button
          className="wl-theme"
          aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        >
          {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </header>
      <div className="wl-comparison">
        <div className="wl-directions" role="tablist" aria-label="画布重构方案">
          {canvasDirections.map((item, index) => {
            const Icon = directionIcons[item.id];
            return (
              <button
                key={item.id}
                role="tab"
                id={`wl-tab-${item.id}`}
                aria-controls="wl-preview"
                aria-selected={direction === item.id}
                tabIndex={direction === item.id ? 0 : -1}
                onKeyDown={(event) => {
                  if (
                    !["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 2
                        : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                  setDirection(canvasDirections[next].id);
                  document
                    .getElementById(`wl-tab-${canvasDirections[next].id}`)
                    ?.focus();
                }}
                onClick={() => setDirection(item.id)}
              >
                <span className="wl-direction-letter">
                  {String.fromCharCode(65 + index)}
                </span>
                <Icon size={17} />
                <span>
                  <strong>
                    {item.name}
                    {item.id === "studio" && <em>推荐</em>}
                  </strong>
                  <small>{item.caption}</small>
                </span>
                {favorite === item.id && (
                  <Check size={13} aria-label="已记住偏好" />
                )}
              </button>
            );
          })}
        </div>
        <button
          className="wl-favorite"
          aria-pressed={favorite === direction}
          onClick={() => {
            setFavorite(direction);
            localStorage.setItem("orbit-workflow-design-favorite", direction);
          }}
        >
          <Check size={13} />
          {favorite === direction ? "已记住偏好" : "记住这个方案"}
        </button>
      </div>
      <div className="wl-direction-description">
        <p>{selected.description}</p>
        <span>拖动节点 · 点击配置 · 拖动端口连线</span>
      </div>
      <div
        className="wl-preview"
        id="wl-preview"
        role="tabpanel"
        aria-labelledby={`wl-tab-${direction}`}
      >
        <ReactFlowProvider key={direction}>
          <WorkflowCanvasPreview direction={direction} theme={theme} />
        </ReactFlowProvider>
      </div>
      <footer className="wl-footer">
        <span>交互设计预览 · 示例内容，不写入正式流程</span>
        <span role="status">
          {favorite
            ? `偏好：${canvasDirections.find((item) => item.id === favorite)?.name ?? ""}`
            : "同一条流程，三种编辑体验"}
        </span>
      </footer>
    </div>
  );
}
