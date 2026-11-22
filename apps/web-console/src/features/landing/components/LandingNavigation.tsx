import { BrandMark } from "../../../components/BrandMark";

/** A 版落地页的页内导航。 */
export function LandingNavigation() {
  return (
    <header className="nav">
      <div className="container nav-inner">
        <a className="brand" href="#main">
          <span className="brand-mark" aria-hidden="true">
            <BrandMark size={26} />
          </span>
          <span>{"Orbit"}</span>
        </a>
        <button className="menu-toggle" aria-label="展开导航" aria-expanded="false">
          <span />
          <span />
        </button>
        <nav className="nav-links" aria-label="主页导航">
          <a href="#use-cases">{"可以做什么"}</a>
          <a href="#demo">{"运行演示"}</a>
          <a href="#questions">{"常见问题"}</a>
          <a className="button primary" href="/studio">
            {"进入工作台"}
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 10h13m-5-5 5 5-5 5" />
            </svg>
          </a>
        </nav>
      </div>
    </header>
  );
}
