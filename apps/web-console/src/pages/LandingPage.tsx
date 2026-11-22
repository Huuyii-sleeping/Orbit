import { useRef } from "react";
import { LandingNavigation } from "../features/landing/components/LandingNavigation";
import { LandingHero } from "../features/landing/components/LandingHero";
import { LandingUseCases } from "../features/landing/components/LandingUseCases";
import { LandingCapabilities } from "../features/landing/components/LandingCapabilities";
import { RunPlayer } from "../features/landing/components/RunPlayer";
import { LandingDevelopers } from "../features/landing/components/LandingDevelopers";
import { LandingClosing } from "../features/landing/components/LandingClosing";
import { LandingFooter } from "../features/landing/components/LandingFooter";
import { LandingQuestions } from "../features/landing/components/LandingQuestions";
import { useLandingEffects } from "../features/landing/use-landing-effects";
import "../features/landing/styles/base.css";
import "../features/landing/styles/components.css";
import "../features/landing/styles/layouts.css";
import "../features/landing/styles/responsive.css";
import "../features/landing/styles/integration.css";
import "../features/landing/styles/personal.css";

/** 正式 A 版主页；演示只在页内运行，工作台入口使用可复制的真实链接。 */
export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  useLandingEffects(root);
  return (
    <div className="orbit-landing" ref={root}>
      <a className="skip-link" href="#main">
        跳至主要内容
      </a>
      <LandingNavigation />
      <main id="main">
        <LandingHero />
        <LandingUseCases />
        <LandingCapabilities />
        <RunPlayer />
        <LandingDevelopers />
        <LandingQuestions />
        <LandingClosing />
      </main>
      <LandingFooter />
    </div>
  );
}
