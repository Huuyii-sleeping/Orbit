/** 演示数据：事件名称为叙事示意，不代表 Orbit 的实际运行接口。 */
export const stages = [
  {
    start: 0,
    end: 4,
    title: "收集资料",
    input: [
      ["topic", "Agent 运行反馈"],
      ["range", "本周"],
    ],
    output: [["records", "12 条原始记录"]],
  },
  {
    start: 4,
    end: 6,
    title: "整理内容",
    input: [["records", "12 条原始记录"]],
    output: [
      ["缺陷", "5 条"],
      ["需求", "4 条"],
      ["疑问", "3 条"],
    ],
  },
  {
    start: 9,
    end: 10,
    title: "人工确认",
    input: [["artifact", "纪要草稿 draft-1"]],
    output: [
      ["status", "等待本次运行确认"],
      ["comment", "第二段补充失败率"],
    ],
  },
  {
    start: 10,
    end: 12,
    title: "生成结果",
    input: [["artifact", "确认后的草稿 draft-2"]],
    output: [["file", "iteration-notes.md"]],
  },
];
export const events: [number, string, string][] = [
  [0, "run.started", "feedback-notes"],
  [0.8, "tool.call", "web.search"],
  [2, "tool.return", "12 items"],
  [3, "skill.run", "extract-entities v4"],
  [4, "skill.run", "summarize-thread v2"],
  [5, "context.window", "68%"],
  [6, "artifact.write", "draft-1"],
  [9, "human.pause", "awaiting_confirm"],
  [9, "human.comment", "第二段补充失败率"],
  [9.001, "run.resumed", "draft-2"],
  [10, "artifact.write", "iteration-notes.md"],
  [12, "run.finished", "ok"],
];
export const timeLabel = (value: number) => `00:${Math.floor(value).toString().padStart(2, "0")}`;
/** 所有节点、详情与事件均从 timecode 派生；回跳时不会遗留未来事件。 */
export function snapshot(timecode: number) {
  const time = Math.max(0, Math.min(12, timecode));
  const index = time < 4 ? 0 : time < 9 ? 1 : time < 10 ? 2 : 3;
  return {
    time,
    index,
    status: time === 9 ? "run.paused" : time === 12 ? "run.finished" : "run.running",
    nodes: stages.map((stage, i) =>
      time >= stage.end || (i === 2 && time > 9)
        ? "done"
        : i === index
          ? time === 9
            ? "waiting"
            : "active"
          : "pending",
    ),
    events: events.filter(([at]) => at <= time),
  };
}
/** 播放穿过人工确认点时必须准确停在 09 秒，显式继续后才越过。 */
export function advance(time: number, delta: number) {
  const next = Math.min(12, time + delta);
  return time < 9 && next >= 9 ? 9 : next;
}
