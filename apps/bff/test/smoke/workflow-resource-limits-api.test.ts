import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createBffHttpServer } from "../../src/server.js";
import { createTestDraft } from "../unit/sops/test-fixtures.js";

const servers: Server[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function listen(server: Server) {
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return `http://127.0.0.1:${address.port}`;
}

describe("Workflow 输入资源 HTTP 回归", () => {
  it("真实 HTTP 拒绝超大定义、chunked 超大请求、压缩体与超限运行输入，随后仍可正常使用", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-resource-api-")); roots.push(root);
    let hits = 0;
    const agent = await listen(createServer((_req, res) => { hits++; res.writeHead(500); res.end(); }));
    const base = await listen(await createBffHttpServer({ agentBaseUrl: agent,
      filePath: join(root, "local.json"), sopDataRoot: join(root, "sops"), skillDataRoot: join(root, "skills") }));
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const oversized = await post("/api/sops", { draft: { ...createTestDraft(), metadata: { text: "中".repeat(400_000) } } });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: "WORKFLOW_RESOURCE_LIMIT" } });
    const chunkedStatus = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/api/sops`, { method: "POST", headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" } }, (res) => { res.resume(); res.once("end", () => resolve(res.statusCode!)); });
      req.once("error", reject);
      req.write('{"text":"');
      for (let i = 0; i < 33; i++) req.write("x".repeat(65_536));
      req.end('"}');
    });
    expect(chunkedStatus).toBe(413);
    const compressed = await fetch(`${base}/api/sops`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" }, body: gzipSync('{"draft":{}}') });
    expect(compressed.status).toBe(415);
    expect((await post("/api/sops", { draft: createTestDraft("valid") })).status).toBe(201);
    const invalidRun = await post("/api/workflow-runs", { workflowId: "valid", mode: "draft", inputs: { text: "x".repeat(262_144) } });
    expect(invalidRun.status).toBe(413);
    expect(await invalidRun.json()).toMatchObject({ error: { code: "WORKFLOW_RESOURCE_LIMIT" } });
    const list = await fetch(`${base}/api/sops`);
    expect(await list.json()).toMatchObject({ data: [expect.objectContaining({ id: "valid" })] });
    expect(hits).toBe(0);
  });
});
