import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AgentsController } from "../../../src/agents/agents.controller.js";
import { AgentProfileService } from "../../../src/agents/agent-profile.service.js";
import { AgentVersionService } from "../../../src/agents/agent-version.service.js";
import { LocalStoreService } from "../../../src/storage/local-store.service.js";

it("过期编辑返回 409，非法 revision 返回 400，均不覆盖已保存职责", async () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-agent-edit-http-"));
  const store = new LocalStoreService({ filePath: join(root, "business.json") });
  const profiles = new AgentProfileService(store, { listSkills: async () => [] });
  const profile = await profiles.createAgent({ name: "翻译", systemPrompt: "第一版职责" });
  const app = await NestFactory.create({
    module: class TestModule {}, controllers: [AgentsController],
    providers: [{ provide: AgentProfileService, useValue: profiles }, { provide: AgentVersionService, useValue: {} }],
  }, { logger: false, abortOnError: false });
  try {
    await app.listen(0, "127.0.0.1");
    const url = `${await app.getUrl()}/api/agents/${profile.id}`;
    const update = (revision: unknown, systemPrompt: string) => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, systemPrompt }) });
    expect((await update(profile.revision, "第二版职责")).status).toBe(200);
    const conflict = await update(profile.revision, "旧窗口职责");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "AGENT_REVISION_CONFLICT" } });
    const invalid = await update(-1, "非法编辑");
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "AGENT_REVISION_INVALID" } });
    expect(await profiles.getAgent(profile.id)).toMatchObject({ systemPrompt: "第二版职责", revision: 1 });
  } finally { await app.close(); store.onModuleDestroy(); rmSync(root, { recursive: true, force: true }); }
});
