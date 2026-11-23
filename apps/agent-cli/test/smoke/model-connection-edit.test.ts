import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ModelsModule } from "../../src/nest/models/models.module.js";
import { ModelCatalog } from "../../src/mastra/models/model-catalog.js";
import { ModelConnectionStore } from "../../src/services/model-connection-store.js";

describe("模型配置编辑 HTTP smoke", () => {
  it("新增、编辑、重新加载和冲突检测保持历史版本可用", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-model-http-"));
    const catalog = new ModelCatalog({ env: {}, connections: new ModelConnectionStore(root) });
    const app = await NestFactory.create({ module: ModelsModule, providers: [{ provide: ModelCatalog, useValue: catalog }] }, { logger: false, abortOnError: false });
    try {
      await app.listen(0, "127.0.0.1");
      const base = `${await app.getUrl()}/model-connections`;
      const input = { name: "QA 模型", provider: "openai-compatible", modelId: "before", baseUrl: "http://127.0.0.1:9999/v1", apiKey: "test-only-secret" };
      const created = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      expect(created.status).toBe(201);
      const { connection } = await created.json();
      const edited = await fetch(`${base}/${connection.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, modelId: "after", apiKey: undefined, reference: connection.reference }) });
      expect(edited.status).toBe(200);
      const { connection: revision } = await edited.json();
      expect(revision.reference).not.toBe(connection.reference);
      expect(catalog.resolve(connection.reference).modelId).toBe("before");
      expect(catalog.resolve(revision.reference)).toMatchObject({ modelId: "after", apiKey: "test-only-secret" });
      const listing = await fetch(base);
      const text = await listing.text();
      expect(text).not.toContain("test-only-secret");
      expect(JSON.parse(text).connections).toHaveLength(1);
      const invalid = await fetch(`${base}/${connection.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, reference: connection.reference }) });
      expect(invalid.status).toBe(400);
      expect(await invalid.text()).toContain("已被修改");
      const request = (method: string, reference: string) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference }) });
      const staleDelete = await fetch(`${base}/${connection.id}`, request("DELETE", connection.reference));
      expect(staleDelete.status).toBe(400);
      const deleted = await fetch(`${base}/${connection.id}`, request("DELETE", revision.reference));
      expect(deleted.status).toBe(200);
      const hidden = await (await fetch(base)).json();
      expect(hidden.connections).toEqual([]);
      expect(hidden.deletedConnections).toHaveLength(1);
      expect(JSON.stringify(hidden)).not.toContain("test-only-secret");
      expect(catalog.resolve(connection.reference).modelId).toBe("before");
      const invalidDelete = await fetch(`${base}/${connection.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
      expect(invalidDelete.status).toBe(400);
      const restored = await fetch(`${base}/${connection.id}/restore`, request("POST", revision.reference));
      expect(restored.status).toBe(200);
      const visible = await (await fetch(base)).json();
      expect(visible.deletedConnections).toEqual([]);
      expect(visible.connections[0].reference).toBe(revision.reference);
    } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
