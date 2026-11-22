/** A 版落地页的页脚。 */
export function LandingFooter() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-top">
          <a className="brand" href="#main">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="8" />
                <circle className="orbit-point" cx="17.65" cy="6.35" r="3" />
              </svg>
            </span>
            <span>{"Orbit"}</span>
          </a>
          <nav aria-label="页脚导航">
            <a href="#use-cases">{"可以做什么"}</a>
            <a href="#demo">{"运行演示"}</a>
            <a href="#questions">{"常见问题"}</a>
          </nav>
          <span className="mono">{"© 2026 Orbit"}</span>
        </div>
        <p className="mono">{"本页所有界面均为设计示意，不含真实产品截图与运营数据。"}</p>
      </div>
    </footer>
  );
}
