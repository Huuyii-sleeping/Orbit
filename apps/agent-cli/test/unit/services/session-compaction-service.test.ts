import { randomUUID } from "node:crypto";
import { LibSQLStore } from "@mastra/libsql";
import type { AgentRuntimePort } from "@orbit/runtime-contracts";
import { describe, expect, it, vi } from "vitest";
import { AgentHost } from "../../../src/host/agent-host.js";
import { createOrbitMastraMemory } from "../../../src/mastra/memory/factory.js";
import { MastraMemoryRuntimeAdapter } from "../../../src/mastra/memory/memory-runtime-adapter.js";
import { ChatService } from "../../../src/services/chat-service.js";
import { SessionCompactionService } from "../../../src/services/session-compaction-service.js";

async function harness() {
  const storage = new LibSQLStore({ id: randomUUID(), url: ":memory:" });
  await storage.init();
  const memory = new MastraMemoryRuntimeAdapter(createOrbitMastraMemory(storage), {
    persistenceEnabled: false,
  });
  const save = vi.fn(async () => undefined);
  const host = new AgentHost({ list: async () => [], save, delete: async () => false });
  const session = host.createSessionSync();
  const ownership = { ownerId: "owner", resourceId: "resource", threadId: session.id };
  await memory.createThread({ ...ownership, id: session.id });
  session.memoryBinding = { ownerId: "owner", resourceId: "resource", metadata: {} };
  session.history.push({ role: "user", content: "display history is intact" });
  await memory.appendMessages({
    ...ownership,
    messages: [
      { role: "user", content: "original goals ".repeat(100), metadata: {}, createdAt: 1 },
      { role: "assistant", content: "completed work ".repeat(100), metadata: {}, createdAt: 2 },
      { role: "user", content: "recent question", metadata: {}, createdAt: 3 },
      { role: "assistant", content: "recent answer", metadata: {}, createdAt: 4 },
    ],
  });
  const generate = vi.fn<AgentRuntimePort["generate"]>(async (command) => ({
    id: randomUUID(),
    status: "succeeded",
    text: "Keep user goals and completed work.",
    createdAt: 1,
    sessionId: command.sessionId,
    resourceId: command.resourceId,
    threadId: command.threadId,
    binding: { backend: "mastra", adapterVersion: "test" },
    toolExecutions: [],
  }));
  const agent: AgentRuntimePort = {
    generate,
    stream: vi.fn<AgentRuntimePort["stream"]>(),
    capabilities: vi.fn(),
    getRun: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = { agent, memory };
  const service = new SessionCompactionService(host, runtime);
  return { service, runtime, host, session, memory, save, generate, ownership };
}

describe("services/session-compaction-service", () => {
  it("再次压缩会将上一份摘要合入新摘要，不丢失先前保留的目标", async () => {
    const h = await harness();
    const first = await h.service.compact(h.session.id, 2);
    await h.memory.appendMessages({ ...h.ownership, threadId: first.threadId, messages: [
      { role: "user", content: "next goals ".repeat(100), metadata: {}, createdAt: 5 },
      { role: "assistant", content: "next work ".repeat(100), metadata: {}, createdAt: 6 },
    ] });
    const second = await h.service.compact(h.session.id, 2);
    expect(second.sourceThreadId).toBe(first.threadId);
    expect(second.threadId).not.toBe(first.threadId);
    expect(h.generate.mock.calls[1]![0].messages[1]!.content).toContain("Keep user goals and completed work.");
    expect((await h.memory.listThreads(h.ownership)).items).toHaveLength(3);
  });

  it("切换真实 Memory 分支并保留原线程、展示历史；后续聊天使用新线程", async () => {
    const h = await harness();
    const before = await h.memory.listMessages({ ...h.ownership, limit: 100 });
    const result = await h.service.compact(h.session.id, 1);
    expect(result.threadId).not.toBe(h.session.id);
    expect(result.keptRecent).toBe(2); // 保留完整用户回合。
    expect(result.reducedBy).toBeGreaterThan(0);
    expect(h.session.busy).toBe(false);
    expect(h.session.history).toEqual([{ role: "user", content: "display history is intact" }]);
    expect(await h.memory.listMessages({ ...h.ownership, limit: 100 })).toEqual(before);
    const compacted = { ...h.ownership, threadId: result.threadId };
    expect(
      (await h.memory.listMessages(compacted)).items.map((message) => message.content),
    ).toEqual(["recent question", "recent answer"]);
    expect((await h.memory.getThread(compacted))?.metadata.contextSummary).toContain(
      "completed work",
    );
    expect(h.generate.mock.calls[0]![0]).toMatchObject({
      memory: false,
      skillBindings: [],
      policy: { allowedToolIds: [], allowedSkillIds: [] },
    });
    const chats = new ChatService(h.host, { listToolRegistrations: async () => [] }, h.runtime);
    await chats.chat({ session_id: h.session.id, message: "continue" });
    expect(h.generate.mock.calls.at(-1)![0].threadId).toBe(result.threadId);
  });

  it.each(["summary", "storage", "persist", "ineffective"])(
    "%s 失败后仍使用原线程，释放锁且不遗留新分支",
    async (failure) => {
      const h = await harness();
      const originalBinding = h.session.memoryBinding;
      if (failure === "summary") h.generate.mockRejectedValueOnce(new Error("summary failed"));
      if (failure === "storage")
        vi.spyOn(h.memory, "compactThread").mockRejectedValueOnce(new Error("storage failed"));
      if (failure === "persist") h.save.mockRejectedValueOnce(new Error("persist failed"));
      if (failure === "ineffective") {
        const normal = h.generate.getMockImplementation()!;
        h.generate.mockImplementationOnce(async (command) => ({
          ...(await normal(command)),
          text: "too long ".repeat(4000),
        }));
      }
      await expect(h.service.compact(h.session.id, 2)).rejects.toThrow();
      expect(h.session.memoryBinding).toBe(originalBinding);
      expect(h.session.busy).toBe(false);
      expect((await h.memory.listThreads(h.ownership)).items.map((thread) => thread.id)).toEqual([
        h.session.id,
      ]);
      expect((await h.memory.listMessages(h.ownership)).items).toHaveLength(4);
      await expect(h.service.compact(h.session.id, 2)).resolves.toMatchObject({ keptRecent: 2 });
    },
  );

  it("空会话或不需要压缩时不调用模型；无效参数、忙碌与不存在会话明确失败", async () => {
    const h = await harness();
    await expect(h.service.compact(h.session.id, 20)).resolves.toMatchObject({
      reducedBy: 0,
      threadId: h.session.id,
    });
    expect(h.generate).not.toHaveBeenCalled();
    const empty = h.host.createSessionSync();
    await expect(h.service.compact(empty.id, 2)).resolves.toMatchObject({
      oldMessageCount: 0,
      reducedBy: 0,
    });
    await expect(h.service.compact(h.session.id, 0)).rejects.toThrow("正整数");
    h.session.busy = true;
    await expect(h.service.compact(h.session.id, 2)).rejects.toMatchObject({
      code: "SESSION_BUSY",
    });
    expect(h.session.busy).toBe(true);
    await expect(h.service.compact("missing", 2)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
  });

  it("摘要期间独占会话；并发聊天和重复压缩不会执行", async () => {
    const h = await harness();
    const normal = h.generate.getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.generate.mockImplementationOnce(async (command) => {
      await pending;
      return normal(command);
    });
    const first = h.service.compact(h.session.id, 2);
    await vi.waitFor(() => expect(h.generate).toHaveBeenCalledOnce());
    const chats = new ChatService(h.host, { listToolRegistrations: async () => [] }, h.runtime);
    await expect(
      chats.chat({ session_id: h.session.id, message: "concurrent" }),
    ).resolves.toMatchObject({ error: { code: "SESSION_BUSY" } });
    await expect(h.service.compact(h.session.id, 2)).rejects.toMatchObject({
      code: "SESSION_BUSY",
    });
    release();
    await first;
    expect(h.generate).toHaveBeenCalledOnce();
  });
});
