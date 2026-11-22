import { describe, expect, it } from "vitest";
import { advance, snapshot } from "./player-model";

describe("落地页演示时间轴", () => {
  it("跨过人工确认点时精确暂停", () => {
    expect(advance(8.98, 0.16)).toBe(9);
    expect(snapshot(9).status).toBe("run.paused");
    expect(snapshot(9).nodes).toEqual(["done", "done", "waiting", "pending"]);
  });
  it("回退到六秒还原完成节点并清除未来事件", () => {
    snapshot(12);
    const state = snapshot(6);
    expect(state.index).toBe(1);
    expect(state.nodes).toEqual(["done", "done", "pending", "pending"]);
    expect(state.events.some(([, name]) => name === "human.pause" || name === "run.resumed")).toBe(false);
    expect(state.events.at(-1)).toEqual([6, "artifact.write", "draft-1"]);
  });
  it("显式恢复后确认节点完成，终点全部完成", () => {
    expect(advance(9.001, 0.1)).toBeGreaterThan(9);
    expect(snapshot(9.001).nodes[2]).toBe("done");
    expect(snapshot(12).nodes).toEqual(["done", "done", "done", "done"]);
    expect(snapshot(12).events.at(-1)).toEqual([12, "run.finished", "ok"]);
  });
  it("重新跳回起点不保留先前节点或事件", () => {
    snapshot(12);
    expect(snapshot(0).events).toHaveLength(1);
    expect(snapshot(0).nodes).toEqual(["active", "pending", "pending", "pending"]);
    expect(snapshot(-1).time).toBe(0);
    expect(snapshot(20).time).toBe(12);
  });
});
