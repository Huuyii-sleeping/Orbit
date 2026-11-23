import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { ModelsModule } from "../../../src/models/models.module.js";
import { RuntimeModule } from "../../../src/runtime-connection/runtime.module.js";

describe("模型配置 BFF 入口", () => {
  it("转发删除与恢复方法、路径和修订基线，保留上游错误", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.reference === "stale"
        ? Response.json({ ok: false, error: { message: "模型配置已被修改" } }, { status: 400 })
        : Response.json({ ok: true });
    });
    const app = await NestFactory.create(ModelsModule.register(RuntimeModule.register({ agentBaseUrl: "http://127.0.0.1:9999", fetchImpl })), { logger: false, abortOnError: false });
    try {
      await app.listen(0, "127.0.0.1");
      for (const [method, suffix, reference, status] of [["DELETE", "", "current", 200], ["POST", "/restore", "current", 200], ["DELETE", "", "stale", 400]] as const) {
        const body = JSON.stringify({ reference });
        const response = await fetch(`${await app.getUrl()}/api/model-connections/model-1${suffix}`, { method, headers: { "Content-Type": "application/json" }, body });
        expect(response.status).toBe(status);
        expect(fetchImpl).toHaveBeenLastCalledWith(new URL(`http://127.0.0.1:9999/model-connections/model-1${suffix}`), expect.objectContaining({ method, body }));
        if (status === 400) expect(await response.text()).toContain("已被修改");
      }
    } finally { await app.close(); }
  });

  it("转发编辑参数、PATCH 方法和上游冲突错误，不把密钥加入响应", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.reference === "old"
        ? Response.json({ ok: false, error: { code: "MODEL_CONNECTION_INVALID", message: "模型配置已被修改" } }, { status: 400 })
        : Response.json({ ok: true, connection: { id: "model-1", reference: "connection:new", hasApiKey: true } });
    });
    const app = await NestFactory.create(ModelsModule.register(RuntimeModule.register({ agentBaseUrl: "http://127.0.0.1:9999", fetchImpl })), { logger: false, abortOnError: false });
    try {
      await app.listen(0, "127.0.0.1");
      const url = `${await app.getUrl()}/api/model-connections/model-1`;
      const input = { reference: "current", name: "翻译", provider: "openai-compatible", modelId: "new", apiKey: "test-secret" };
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, connection: { id: "model-1", reference: "connection:new", hasApiKey: true } });
      expect(fetchImpl).toHaveBeenCalledWith(new URL("http://127.0.0.1:9999/model-connections/model-1"), expect.objectContaining({ method: "PATCH", body: JSON.stringify(input) }));
      const conflict = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, reference: "old" }) });
      expect(conflict.status).toBe(400);
      expect(await conflict.text()).not.toContain("test-secret");
    } finally { await app.close(); }
  });
});
