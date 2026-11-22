/** A 版落地页的收尾行动入口。 */
export function LandingClosing() {
  return (
    <section className="closing section container" id="start">
      <svg className="closing-orbit" viewBox="0 0 1200 340" aria-hidden="true">
        <path d="M-60 330C250 20 780 400 1240 90" />
        <circle cx="1009" cy="202" r="3" />
      </svg>
      <div className="closing-copy reveal">
        <div className="eyebrow">
          <span />
          {"GIVE YOUR IDEAS AN ORBIT"}
        </div>
        <h2>
          {"下一个想法，"}
          <br />
          {"值得一条清晰的执行路径。"}
        </h2>
        <p>{"从一段文字开始，试试你的第一个助手。"}</p>
      </div>
      <div className="closing-actions reveal">
        <a className="button primary magnet" href="/studio">
          {"进入工作台"}
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 10h13m-5-5 5 5-5 5" />
          </svg>
        </a>
        <a className="text-link" href="#demo">
          {"或者，先体验页内演示 ↗"}
        </a>
      </div>
    </section>
  );
}
