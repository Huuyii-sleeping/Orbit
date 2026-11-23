import React from "react";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import { AppEntry } from "./app/AppEntry";
import { lazy, Suspense } from "react";
import "./styles/index.css";
import "./styles/compact-console.css";
import "./features/sop/styles/free-canvas.css";

const DesignPreviewPage = lazy(() => import("./pages/DesignPreviewPage"));
const WorkflowDesignPage = lazy(() => import("./pages/WorkflowDesignPage"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      {window.location.pathname === "/design/workflow" ? (
        <Suspense fallback={<div role="status">正在加载画布预览…</div>}>
          <WorkflowDesignPage />
        </Suspense>
      ) : window.location.pathname === "/design" ? (
        <Suspense fallback={<div role="status">正在加载设计预览…</div>}>
          <DesignPreviewPage />
        </Suspense>
      ) : (
        <AppEntry />
      )}
    </AppErrorBoundary>
  </React.StrictMode>,
);
