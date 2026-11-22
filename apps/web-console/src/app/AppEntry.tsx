import { lazy, Suspense, useEffect, useState } from "react";
import { appRouteFromPathname } from "../app-route";

const Workspace = lazy(() => import("./App").then((module) => ({ default: module.App })));
const Home = lazy(() => import("../pages/LandingPage").then((module) => ({ default: module.LandingPage })));

/** 首页不装配工作台状态或请求；浏览器前进、后退时同步顶层页面。 */
export function AppEntry() {
  const [route, setRoute] = useState(() => appRouteFromPathname(window.location.pathname));
  useEffect(() => {
    const update = () => setRoute(appRouteFromPathname(window.location.pathname));
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return (
    <Suspense fallback={<div role="status">正在加载 Orbit…</div>}>
      {route === "landing" ? <Home /> : <Workspace />}
    </Suspense>
  );
}
