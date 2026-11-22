import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { advance, snapshot, stages, timeLabel } from "../player-model";

/** 本地交互演示：单一时间码决定节点、输入输出和事件，不创建真实运行。 */
export function RunPlayer() {
  const [timecode, setTimecode] = useState(12);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const root = useRef<HTMLElement>(null);
  const eventList = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const state = snapshot(timecode);
  const stage = stages[state.index];
  const visibleEvents = expanded ? snapshot(12).events : state.events;

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches) return;
    setExpanded(false);
    setTimecode(0);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = 0;
    function tick(now: number) {
      const delta = previous ? Math.min(0.1, (now - previous) / 1000) * 2 : 0;
      previous = now;
      setTimecode((current) => advance(current, delta));
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    if (timecode === 9 || timecode === 12) setPlaying(false);
  }, [timecode]);

  useEffect(() => {
    if (eventList.current) eventList.current.scrollTop = eventList.current.scrollHeight;
  }, [visibleEvents.length]);

  function jump(time: number) {
    setPlaying(false);
    setExpanded(false);
    setTimecode(Math.min(12, Math.max(0, time)));
  }
  function play() {
    setExpanded(false);
    setTimecode((current) => (current >= 12 ? 0 : current === 9 ? 9.001 : current));
    setPlaying(true);
  }
  function scrub(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    jump(((event.clientX - rect.left) / rect.width) * 12);
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.code !== "Space" || (event.target as HTMLElement).closest("button,a")) return;
    event.preventDefault();
    if (playing) setPlaying(false);
    else play();
  }
  function fields(rows: string[][]) {
    return rows.map(([key, value]) => (
      <div className="kv-row" key={key}>
        <dt>{key}</dt>
        <dd>{value}</dd>
      </div>
    ));
  }
  const output =
    state.index === 2 && timecode > 9
      ? [
          ["status", "本次运行已恢复"],
          ["artifact", "确认后的草稿 draft-2"],
        ]
      : stage.output;

  return (
    <section className="demo-section section" aria-labelledby="run-demo-title">
      <div className="container">
        <div className="section-heading reveal">
          <div>
            <div className="eyebrow">
              <span />
              FOLLOW THE EXECUTION
            </div>
            <h2 id="run-demo-title">
              每一步，都能看见。
              <br />
              每一步，都能介入。
            </h2>
          </div>
          <div className="section-intro">
            <p>
              以一份研发纪要为例，
              <br />
              体验一次从输入到结果的执行过程。
            </p>
            <span className="mono">INTERACTIVE DEMO / 00:12</span>
          </div>
        </div>
        <section
          className="run-player"
          id="demo"
          aria-label="可交互运行演示"
          tabIndex={0}
          ref={root}
          onKeyDown={keyboard}
          data-timecode={timecode.toFixed(3)}
          data-status={state.status}
        >
          <div className="player-head">
            <span className="mono">
              <i className="status-dot done" />
              feedback-notes <span className="muted">/ 示例运行</span>
            </span>
            <span className={`mono player-status ${timecode === 9 ? "paused" : ""}`} role="status">
              {state.status}
            </span>
          </div>
          <div className="player-track-area">
            <div className="track-labels mono">
              <span>00:00</span>
              <span>00:12</span>
            </div>
            <div
              className="scrub-track"
              role="slider"
              tabIndex={0}
              aria-label="运行时间轴"
              aria-valuemin={0}
              aria-valuemax={12}
              aria-valuenow={timecode}
              aria-valuetext={timeLabel(timecode)}
              style={{ "--progress": `${(timecode / 12) * 100}%` } as CSSProperties}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget.focus();
                scrub(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) scrub(event);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                jump(
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 12
                      : timecode + (event.key === "ArrowRight" ? 1 : -1),
                );
              }}
            >
              <div className="track-base" />
              <div className="track-fill" />
              <div className="track-ticks">
                {[0, 2, 4, 6, 8, 10, 12].map((time) => (
                  <span
                    key={time}
                    className={time <= timecode ? "passed" : ""}
                    style={{ left: `${(time / 12) * 100}%` }}
                  />
                ))}
              </div>
              <div className="playhead">
                <span className="time-label mono">{timeLabel(timecode)}</span>
                <i />
              </div>
            </div>
            <div className="stage-tabs" role="tablist" aria-label="运行节点">
              {stages.map((item, index) => (
                <button
                  key={item.title}
                  type="button"
                  ref={(element) => {
                    tabs.current[index] = element;
                  }}
                  className={`stage-tab ${state.nodes[index]}`}
                  role="tab"
                  aria-selected={index === state.index}
                  tabIndex={index === state.index ? 0 : -1}
                  aria-controls="demo-detail"
                  onClick={() => jump(item.start)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : null;
                    if (next !== null) {
                      event.preventDefault();
                      jump(stages[next].start);
                      tabs.current[next]?.focus();
                    }
                  }}
                >
                  <span className="mono">
                    WF-0{index + 1}
                    <i className={`status-dot ${state.nodes[index]}`} />
                  </span>
                  <b>{item.title}</b>
                  <time className="mono">{timeLabel(item.start)}</time>
                </button>
              ))}
            </div>
          </div>
          <div className="player-detail" id="demo-detail">
            <div className="io-panel">
              {expanded ? (
                <div className="all-stage-details">
                  {stages.map((item, index) => (
                    <div key={item.title}>
                      <span className="mono muted">WF-0{index + 1}</span>
                      <h3>{item.title}</h3>
                      <div className="io-columns">
                        <div>
                          <span className="mono muted">INPUT</span>
                          <dl>{fields(item.input)}</dl>
                        </div>
                        <div>
                          <span className="mono muted">OUTPUT</span>
                          <dl>{fields(item.output)}</dl>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="live-io">
                  <div className="io-title">
                    <span className="mono muted">NODE INPUT / OUTPUT</span>
                    <span className="mono current-stage">WF-0{state.index + 1}</span>
                  </div>
                  <h3 className="stage-title">{stage.title}</h3>
                  <div className="io-columns">
                    <div>
                      <span className="mono muted">INPUT</span>
                      <dl>{fields(stage.input)}</dl>
                    </div>
                    <div>
                      <span className="mono muted">OUTPUT</span>
                      <dl>{fields(output)}</dl>
                    </div>
                  </div>
                </div>
              )}
              <div className="player-controls">
                {timecode === 9 ? (
                  <>
                    <button className="button primary resume" onClick={play}>
                      继续运行 →
                    </button>
                    <button className="button secondary back" onClick={() => jump(6)}>
                      退回上一步
                    </button>
                  </>
                ) : (
                  <button
                    className="button primary toggle"
                    onClick={() => {
                      if (playing) setPlaying(false);
                      else play();
                    }}
                  >
                    {playing ? "Ⅱ 暂停" : timecode === 12 ? "▷ 再看一次" : "▷ 播放"}
                  </button>
                )}
                {timecode === 12 && (
                  <button
                    className="button secondary replay"
                    onClick={() => {
                      setTimecode(0);
                      setExpanded(false);
                      setPlaying(true);
                    }}
                  >
                    ↻ 重播
                  </button>
                )}
              </div>
              <p className="run-context mono">仅演示本次运行，不调用模型或外部工具</p>
            </div>
            <div className="events-panel">
              <div className="io-title">
                <span className="mono muted">RUNTIME EVENTS</span>
                <span className="mono event-count">{visibleEvents.length} EVENTS</span>
              </div>
              <div className="live-events" ref={eventList}>
                {visibleEvents.map(([at, name, value], index) => (
                  <div
                    className={`event-row ${name === "human.pause" ? "pause-event" : ""}`}
                    key={`${at}-${name}`}
                    style={{ "--delay": `${index * 40}ms` } as CSSProperties}
                  >
                    <time>{timeLabel(at)}</time>
                    <span>{name}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="player-foot mono">
            <span>可播放 · 可拖动时间轴 · 点击节点跳转</span>
            <span>人工确认 = 这次运行的暂停与继续</span>
          </div>
        </section>
        <p className="mock-caption mono">
          事件名、技能与内容均为演示示例，不代表已确认的产品接口。发布版本是独立操作，不由运行自动触发。
        </p>
      </div>
    </section>
  );
}
