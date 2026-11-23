import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { LibSQLStore } from "@mastra/libsql";
import type { MastraDBMessage } from "@mastra/core/agent";
import { defineMemoryRuntimePortContract } from "../../../harness/runtime-ports/memory-contract.js";
import {
  createOrbitMastraMemory,
  ORBIT_MASTRA_MEMORY_OPTIONS,
} from "../../../../src/mastra/memory/factory.js";
import { MastraMemoryRuntimeAdapter } from "../../../../src/mastra/memory/memory-runtime-adapter.js";
import {
  getOrCreateMastraRuntime,
  shutdownMastraRuntime,
} from "../../../../src/mastra/instance/factory.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function inMemoryAdapter(): Promise<MastraMemoryRuntimeAdapter> {
  const storage = new LibSQLStore({ id: `memory-test-${randomUUID()}`, url: ":memory:" });
  await storage.init();
  return new MastraMemoryRuntimeAdapter(createOrbitMastraMemory(storage), { persistenceEnabled: false });
}

defineMemoryRuntimePortContract("Mastra", async () => ({
  port: await inMemoryAdapter(),
  ownerA: { ownerId: "owner-a", resourceId: "resource-a" },
  ownerB: { ownerId: "owner-b", resourceId: "resource-b" },
}));

describe("mastra/memory/memory-runtime-adapter", () => {
  it("压缩分支保留原始工具消息结构、验证所有权且在重启后可读取摘要", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orbit-memory-compact-restart-"));
    roots.push(root);
    const first = await getOrCreateMastraRuntime({ root, persistenceEnabled: true });
    const adapter = new MastraMemoryRuntimeAdapter(first.memory, { root, persistenceEnabled: true });
    const owner = { ownerId: "owner-a", resourceId: "resource-a", threadId: "original" };
    try {
      await adapter.createThread({ ...owner, id: "original" });
      const messages: MastraDBMessage[] = [{
        id: "native-tool-message", role: "assistant", createdAt: new Date(10), threadId: "original", resourceId: "resource-a",
        content: { format: 2, parts: [{ type: "tool-invocation", toolInvocation: {
          state: "result", toolCallId: "call-1", toolName: "echo", args: { value: "hello" }, result: { text: "hello" },
        } }] },
      }];
      await first.memory.saveMessages({ messages });
      await expect(adapter.compactThread({ ...owner, ownerId: "other", summary: "summary", retainedMessageIds: ["native-tool-message"] })).rejects.toMatchObject({ code: "RUNTIME_OWNERSHIP_CONFLICT" });
      await expect(adapter.compactThread({ ...owner, summary: "summary", retainedMessageIds: ["missing"] })).rejects.toThrow("不属于");
      const thread = await adapter.compactThread({ ...owner, summary: "durable summary", retainedMessageIds: ["native-tool-message"] });
      const copied = await first.memory.recall({ threadId: thread.id, resourceId: "resource-a", perPage: false });
      expect(copied.messages[0]?.content).toEqual(messages[0]!.content);
      expect(copied.messages[0]?.id).not.toBe("native-tool-message");
      expect((await adapter.listMessages(owner)).items).toHaveLength(1);
      await shutdownMastraRuntime({ root, persistenceEnabled: true });
      const restored = await getOrCreateMastraRuntime({ root, persistenceEnabled: true });
      const memory = new MastraMemoryRuntimeAdapter(restored.memory, { root, persistenceEnabled: true });
      expect((await memory.getThread({ ...owner, threadId: thread.id }))?.metadata.contextSummary).toBe("durable summary");
      expect((await memory.listMessages({ ...owner, threadId: thread.id })).items).toHaveLength(1);
    } finally {
      await shutdownMastraRuntime({ root, persistenceEnabled: true });
    }
  });

  it("首轮只启用 message history，并显式关闭高级 Memory", () => {
    expect(ORBIT_MASTRA_MEMORY_OPTIONS).toEqual({
      lastMessages: 20,
      semanticRecall: false,
      workingMemory: { enabled: false },
      observationalMemory: false,
    });
  });

  it("在进程重启后读取同一 resource/thread 的消息", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orbit-mastra-memory-restart-"));
    roots.push(root);
    const firstRuntime = await getOrCreateMastraRuntime({ root, persistenceEnabled: true });
    const first = new MastraMemoryRuntimeAdapter(firstRuntime.memory, { root, persistenceEnabled: true });
    await first.createThread({ ownerId: "owner-a", resourceId: "resource-a", id: "thread-a" });
    await first.appendMessages({
      ownerId: "owner-a",
      resourceId: "resource-a",
      threadId: "thread-a",
      messages: [{ role: "user", content: "persisted", metadata: { source: "test" } }],
    });
    await shutdownMastraRuntime({ root, persistenceEnabled: true });

    const restoredRuntime = await getOrCreateMastraRuntime({ root, persistenceEnabled: true });
    const restored = new MastraMemoryRuntimeAdapter(restoredRuntime.memory, { root, persistenceEnabled: true });
    await expect(restored.listMessages({
      ownerId: "owner-a",
      resourceId: "resource-a",
      threadId: "thread-a",
    })).resolves.toMatchObject({ items: [{ content: "persisted", metadata: { source: "test" } }] });
    await shutdownMastraRuntime({ root, persistenceEnabled: true });
  });

  it("Agent 通过同一 Mastra Memory 写入后可由 MemoryRuntimePort 查询", async () => {
    const storage = new LibSQLStore({ id: `agent-memory-test-${randomUUID()}`, url: ":memory:" });
    await storage.init();
    const memory = createOrbitMastraMemory(storage);
    const adapter = new MastraMemoryRuntimeAdapter(memory, { persistenceEnabled: false });
    await adapter.createThread({ ownerId: "owner-a", resourceId: "resource-a", id: "thread-a" });
    const message: MastraDBMessage = {
      id: "agent-message-1",
      role: "assistant",
      createdAt: new Date(10),
      threadId: "thread-a",
      resourceId: "resource-a",
      content: { format: 2, parts: [{ type: "text", text: "written by agent" }] },
    };
    await memory.saveMessages({ messages: [message] });

    const page = await adapter.listMessages({
      ownerId: "owner-a",
      resourceId: "resource-a",
      threadId: "thread-a",
    });
    expect(page.items).toMatchObject([{
      id: "agent-message-1",
      role: "assistant",
      content: "written by agent",
    }]);
  });
});
