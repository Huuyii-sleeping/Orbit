import "reflect-metadata";
import Database from "better-sqlite3";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStoreModule } from "../../src/storage/local-store.module.js";
import { RuntimeModule } from "../../src/runtime-connection/runtime.module.js";
import { SessionsModule } from "../../src/sessions/sessions.module.js";
import { WorkspaceModule } from "../../src/workspace/workspace.module.js";
import { AppModule } from "../../src/app.module.js";
import { SopDatabase } from "../../src/storage/sop-database.js";
import { AGENT_VERSION_REPOSITORY } from "../../src/agents/agent-version.repository.js";

const apps: INestApplication[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("BFF 模块独立运行", () => {
  it("Agent、SOP 和运行控制共享数据库与版本仓库，应用关闭时只释放一次", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-storage-module-"));
    roots.push(root);
    const app = await NestFactory.createApplicationContext(AppModule.register({
      agentBaseUrl: "http://127.0.0.1:1",
      filePath: join(root, "workspace.json"),
      sopDatabasePath: ":memory:",
      skillDataRoot: join(root, "skills"),
    }), { logger: false, abortOnError: false });
    const database = app.get(SopDatabase);
    const close = vi.spyOn(database, "onModuleDestroy");
    try {
      expect(app.get(SopDatabase, { each: true })).toHaveLength(1);
      expect(app.get(AGENT_VERSION_REPOSITORY, { each: true })).toHaveLength(1);
      expect(database.health().ok).toBe(true);
    } finally {
      await app.close();
    }
    expect(close).toHaveBeenCalledTimes(1);
    expect(() => database.health()).toThrow();
  });

  it("工作区设置可独立读写，不需要 Runtime、技能或 SOP 数据库", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-workspace-module-"));
    roots.push(root);
    const filePath = join(root, "workspace.json");
    const app = await NestFactory.create(
      WorkspaceModule.register(LocalStoreModule.register({ filePath })),
      { logger: false, abortOnError: false },
    );
    apps.push(app);
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();

    const update = await fetch(`${base}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "light" }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ ok: true, settings: { theme: "light" } });
    const database = new Database(`${filePath}.sqlite`, { readonly: true });
    try {
      const row = database.prepare("SELECT value_json FROM business_sections WHERE key = ?").get("settings") as { value_json: string };
      expect(JSON.parse(row.value_json)).toMatchObject({ theme: "light" });
    } finally {
      database.close();
    }
    const settings = await fetch(`${base}/api/settings`);
    expect(await settings.json()).toMatchObject({ settings: { theme: "light" } });
    expect((await fetch(`${base}/api/agents`)).status).toBe(404);
  });

  it("聊天模块只接入 Runtime 即可转发会话和流式消息", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/sessions") {
        return Response.json({ ok: true, session: { id: "session-isolated" } }, { status: 201 });
      }
      if (url.pathname === "/chat/stream") {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          session_id: "session-isolated",
          message: "hello",
        });
        return new Response('event: message.done\ndata: {"ok":true,"assistant":"reply"}\n\n', {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return Response.json({ ok: false }, { status: 404 });
    });
    const app = await NestFactory.create(
      SessionsModule.register(RuntimeModule.register({ agentBaseUrl: "http://runtime.local", fetchImpl })),
      { logger: false, abortOnError: false },
    );
    apps.push(app);
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();

    const session = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(session.status).toBe(201);
    expect(await session.json()).toMatchObject({ session: { id: "session-isolated" } });
    const stream = await fetch(`${base}/api/sessions/session-isolated/messages/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await stream.text()).toContain('"assistant":"reply"');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await fetch(`${base}/api/settings`)).status).toBe(404);
  });
});
