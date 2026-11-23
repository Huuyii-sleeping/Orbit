import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHost } from "../../../src/host/agent-host.js";
import { createAgentSessionRecord } from "../../../src/service-api/sessions.js";
import { SessionStore } from "../../../src/service-api/session-store.js";
let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    tempDir = "";
  }
});

describe("host/agent-host", () => {
  it("持久化压缩后的 Memory 指向，但不将运行锁恢复成永久 busy", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agent-host-compact-"));
    const store = new SessionStore(path.join(tempDir, ".sessions"));
    const host = new AgentHost(store);
    const session = host.createSessionSync();
    session.memoryBinding = {
      ownerId: "owner",
      resourceId: "resource",
      threadId: "compacted-thread",
      metadata: {},
    };
    session.busy = true;
    await host.persistSession(session);
    expect(host.getSession(session.id)?.busy).toBe(true);
    const restored = new AgentHost(store);
    await restored.initialize();
    expect(restored.getSession(session.id)).toMatchObject({
      busy: false,
      memoryBinding: { threadId: "compacted-thread" },
    });
  });

  it("loads persisted sessions on initialize", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agent-host-test-"));
    const sessionStore = new SessionStore(path.join(tempDir, ".sessions"));
    const session = createAgentSessionRecord("session_1", 1000);
    session.history.push({ role: "user", content: "restore me" });
    await sessionStore.save(session);

    const host = new AgentHost(sessionStore);
    await host.initialize();

    expect(host.listSessions().map((item) => item.id)).toEqual(["session_1"]);
    expect(host.getSession("session_1")?.history).toEqual([
      { role: "user", content: "restore me" },
    ]);
  });

  it("persists created sessions through the backing store", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agent-host-test-"));
    const sessionStore = new SessionStore(path.join(tempDir, ".sessions"));
    const host = new AgentHost(sessionStore);
    await host.initialize();

    const session = await host.createSession();
    const restored = await sessionStore.load(session.id);

    expect(restored).not.toBeNull();
    expect(restored?.id).toBe(session.id);
    expect(host.listSessions().map((item) => item.id)).toEqual([session.id]);
  });

  it("owns a shared session-created event stream with monotonic ids", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agent-host-test-"));
    const host = new AgentHost(new SessionStore(path.join(tempDir, ".sessions")));
    await host.initialize();

    const seen: Array<{ id: number; type: string; sessionId: string }> = [];
    const unsubscribe = host.subscribeEvents((event) => {
      seen.push({
        id: event.id,
        type: event.type,
        sessionId: String((event.payload.session as { id?: unknown } | undefined)?.id ?? ""),
      });
    });

    const first = host.createSessionSync();
    const second = host.createSessionSync();
    unsubscribe();

    expect(seen).toEqual([
      { id: 0, type: "session.created", sessionId: first.id },
      { id: 1, type: "session.created", sessionId: second.id },
    ]);
  });

  it("replays buffered host events after a cursor and trims to the configured limit", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agent-host-test-"));
    const host = new AgentHost(new SessionStore(path.join(tempDir, ".sessions")), {
      eventBufferLimit: 2,
    });
    await host.initialize();

    const first = host.createSessionSync();
    const second = host.createSessionSync();
    const third = host.createSessionSync();

    expect(host.listEventsSince(null).map((event) => event.id)).toEqual([1, 2]);
    expect(host.listEventsSince(1).map((event) => event.id)).toEqual([2]);
    expect(host.eventWindow()).toEqual({
      oldestEventId: 1,
      latestEventId: 2,
      bufferedEventCount: 2,
    });
    expect(
      host
        .listEventsSince(null)
        .map((event) => String((event.payload.session as { id?: unknown } | undefined)?.id ?? "")),
    ).toEqual([second.id, third.id]);
    expect(
      host
        .listEventsSince(0)
        .map((event) => String((event.payload.session as { id?: unknown } | undefined)?.id ?? "")),
    ).toEqual([second.id, third.id]);
    expect(first.id).not.toBe(second.id);
  });
});
