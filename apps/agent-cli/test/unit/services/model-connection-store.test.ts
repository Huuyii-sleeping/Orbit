import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ModelConnectionStore } from "../../../src/services/model-connection-store.js";
import { ModelCatalog } from "../../../src/mastra/models/model-catalog.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("工作台模型连接", () => {
  it("删除和恢复无需解密密钥，非法请求不改变目录", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-model-delete-key-"));
    roots.push(root);
    const catalog = new ModelCatalog({ env: {}, connections: new ModelConnectionStore(root) });
    const connection = catalog.createConnection({ name: "QA", provider: "openai-compatible", modelId: "qa", baseUrl: "https://example.com/v1", apiKey: "test-key" });
    rmSync(join(root, "key"));
    expect(() => catalog.deleteConnection(connection.id, {})).toThrow("当前引用");
    expect(catalog.listConnections().connections).toHaveLength(1);
    catalog.deleteConnection(connection.id, { reference: connection.reference });
    expect(catalog.listConnections().connections).toHaveLength(0);
    catalog.restoreConnection(connection.id, { reference: connection.reference });
    expect(catalog.listConnections().connections).toHaveLength(1);
  });

  it("删除隐藏全部修订且可恢复，不影响已有引用；拒绝过期编辑和不存在的配置", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-model-delete-test-"));
    roots.push(root);
    const store = new ModelConnectionStore(root);
    const catalog = new ModelCatalog({ env: {}, connections: store });
    const input = { name: "删除测试", provider: "openai-compatible", modelId: "old", baseUrl: "https://example.com/v1", apiKey: "delete-test-secret" };
    const original = catalog.createConnection(input);
    const edited = catalog.updateConnection(original.id, { ...input, modelId: "new", reference: original.reference });
    expect(() => catalog.deleteConnection(original.id, { reference: original.reference })).toThrow("已被修改");
    catalog.deleteConnection(edited.id, { reference: edited.reference });
    expect(catalog.listConnections().connections).toEqual([]);
    expect(catalog.listConnections().deletedConnections).toHaveLength(1);
    expect(catalog.resolve(original.reference)).toMatchObject({ modelId: "old", apiKey: "delete-test-secret" });
    expect(catalog.resolve(edited.reference).modelId).toBe("new");
    expect(() => catalog.updateConnection(edited.id, { ...input, reference: edited.reference })).toThrow("已删除");
    const restarted = new ModelCatalog({ env: {}, connections: new ModelConnectionStore(root) });
    expect(restarted.listConnections().connections).toEqual([]);
    expect(JSON.stringify(restarted.listConnections())).not.toContain("delete-test-secret");
    restarted.restoreConnection(edited.id, { reference: edited.reference });
    expect(restarted.listConnections().deletedConnections).toEqual([]);
    expect(restarted.listConnections().connections[0]).toMatchObject({ id: edited.id, reference: edited.reference, previousReferences: [original.reference] });
    expect(() => restarted.deleteConnection("missing", { reference: "connection:missing" })).toThrow("不存在");
  });

  it("编辑生成新修订，保留旧引用和密钥；重启后只列出最新配置", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-model-edit-test-"));
    roots.push(root);
    const catalog = new ModelCatalog({ env: {}, connections: new ModelConnectionStore(root) });
    const input = { name: "翻译模型", provider: "openai-compatible", modelId: "old", baseUrl: "https://example.com/v1", apiKey: "old-secret" };
    const original = catalog.createConnection(input);
    const edited = catalog.updateConnection(original.id, { ...input, modelId: "new", apiKey: undefined, reference: original.reference });
    expect(edited.id).toBe(original.id);
    expect(edited.reference).not.toBe(original.reference);
    expect(catalog.resolve(original.reference)).toMatchObject({ modelId: "old", apiKey: "old-secret" });
    expect(catalog.resolve(edited.reference)).toMatchObject({ modelId: "new", apiKey: "old-secret" });
    expect(() => catalog.updateConnection(original.id, { ...input, reference: original.reference })).toThrow("已被修改");
    const rotated = catalog.updateConnection(edited.id, { ...input, apiKey: "new-secret", reference: edited.reference });
    expect(catalog.resolve(rotated.reference).apiKey).toBe("new-secret");
    const cleared = catalog.updateConnection(edited.id, { ...input, apiKey: undefined, clearApiKey: true, reference: rotated.reference });
    expect(catalog.resolve(cleared.reference).apiKey).toBeUndefined();
    const restarted = new ModelCatalog({ env: {}, connections: new ModelConnectionStore(root) });
    expect(restarted.listConnections().connections).toEqual([{ ...cleared, previousReferences: [rotated.reference, edited.reference, original.reference] }]);
    expect(JSON.stringify(restarted.listConnections())).not.toContain("secret");
    expect(restarted.resolve(original.reference).apiKey).toBe("old-secret");
  });

  it("加密持久化密钥，目录不回显密钥，重建目录后可直接供模型解析", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-model-connection-test-"));
    roots.push(root);
    const store = new ModelConnectionStore(root);
    const catalog = new ModelCatalog({ env: {}, connections: store });
    const summary = catalog.createConnection({
      name: "测试连接",
      provider: "openai-compatible",
      modelId: "test-model",
      baseUrl: "http://127.0.0.1:9999/v1",
      apiKey: "secret-for-test",
    });
    expect(JSON.stringify(summary)).not.toContain("secret-for-test");
    expect(JSON.stringify(store.list())).not.toContain("encryptedKey");
    expect(readFileSync(join(root, "connections.json"), "utf8")).not.toContain("secret-for-test");
    expect(statSync(join(root, "connections.json")).mode & 0o777).toBe(0o600);
    const restarted = new ModelCatalog({ env: {}, connections: new ModelConnectionStore(root) });
    expect(restarted.resolve(summary.reference)).toMatchObject({
      modelId: "test-model",
      apiKey: "secret-for-test",
      baseUrl: "http://127.0.0.1:9999/v1",
    });
    expect(restarted.listConnections().connections).toEqual([summary]);
    const second = restarted.createConnection({
      name: "另一个模型",
      provider: "openai-compatible",
      modelId: "second",
      baseUrl: "http://127.0.0.1:9998/v1",
    });
    expect(second.reference).not.toBe(summary.reference);
    expect(restarted.resolve(summary.reference).modelId).toBe("test-model");
  });

  it("无效地址、供应商和缺失凭据在保存前拒绝，错误不回显密钥", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-model-connection-test-"));
    roots.push(root);
    const catalog = new ModelCatalog({ env: {}, connections: new ModelConnectionStore(root) });
    for (const input of [
      {
        name: "x",
        modelId: "x",
        provider: "openai-compatible",
        baseUrl: "file:///tmp/x",
        apiKey: "secret-for-test",
      },
      { name: "x", modelId: "x", provider: "missing", apiKey: "secret-for-test" },
      { name: "x", modelId: "x", provider: "anthropic" },
    ]) {
      expect(() => catalog.createConnection(input)).toThrow();
      try {
        catalog.createConnection(input);
      } catch (error) {
        expect(String(error)).not.toContain("secret-for-test");
      }
    }
    expect(catalog.listConnections().connections).toEqual([]);
    expect(() => catalog.resolve("connection:missing")).toThrow("不存在");
  });

  it("存储损坏时明确失败，不静默清空目录", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-model-connection-test-"));
    roots.push(root);
    writeFileSync(join(root, "connections.json"), "{}");
    expect(() => new ModelConnectionStore(root).list()).toThrow("存储格式无效");
    writeFileSync(join(root, "connections.json"), '{"apiKey":"secret-for-test"');
    expect(() => new ModelConnectionStore(root).list()).toThrow("存储格式无效");
  });
});
