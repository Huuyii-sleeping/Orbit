import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { writeStreamChunk } from "../../../src/stream-utils.js";

describe("流响应背压", () => {
  it("缓冲区排空前暂停写入，断开后能结束等待", async () => {
    let complete: ((error?: Error | null) => void) | undefined;
    const stream = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { complete = callback; } });
    const writing = writeStreamChunk(stream, "first");
    let settled = false;
    void writing.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    complete?.();
    expect(await writing).toBe(true);
    const interrupted = writeStreamChunk(stream, "second");
    stream.destroy();
    expect(await interrupted).toBe(false);
    expect(stream.listenerCount("drain")).toBe(0);
  });
});
