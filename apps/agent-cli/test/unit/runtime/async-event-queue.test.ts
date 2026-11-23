import { describe, expect, it } from "vitest";
import { AsyncEventQueue } from "../../../src/runtime/async-event-queue.js";

describe("AsyncEventQueue", () => {
  it("delivers queued and waiting events, including undefined, then closes", async () => {
    const queue = new AsyncEventQueue<number | undefined>();
    queue.push(undefined);
    queue.push(1);
    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: undefined });
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 });
    const waiting = iterator.next();
    queue.push(2);
    await expect(waiting).resolves.toEqual({ done: false, value: 2 });
    const ending = iterator.next();
    queue.close();
    await expect(ending).resolves.toEqual({ done: true, value: undefined });
  });

  it("propagates source failure to waiting and future consumers", async () => {
    const queue = new AsyncEventQueue<number>();
    const iterator = queue[Symbol.asyncIterator]();
    const waiting = expect(iterator.next()).rejects.toThrow("source failed");
    queue.fail(new Error("source failed"));
    await waiting;
    await expect(iterator.next()).rejects.toThrow("source failed");
  });

});
