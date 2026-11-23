import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const children: ChildProcess[] = [];
const roots: string[] = [];

async function start() {
  const root = await mkdtemp(join(tmpdir(), "orbit-registry-http-"));
  roots.push(root);
  const moduleUrl = new URL("../../src/server.ts", import.meta.url).href;
  const script = `import { createSkillRegistryHttpServer } from ${JSON.stringify(moduleUrl)};
    const server = createSkillRegistryHttpServer(${JSON.stringify({ dbPath: join(root, "db.sqlite"), packageRoot: join(root, "packages"), adminToken: "test-token", maxRequestBodyBytes: 1024 })});
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let stderr = "";
  child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  const ready = await Promise.race([
    once(child.stdout!, "data").then(([chunk]) => `http://127.0.0.1:${String(chunk).trim()}`),
    once(child, "exit").then(() => { throw new Error(`Registry exited: ${stderr}`); }),
  ]);
  return ready;
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, "exit");
    child.kill("SIGTERM");
    await closed;
  }));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Registry HTTP failure boundaries", () => {
  it.each(["/skills/%ZZ/versions", "/skills/%ZZ", "/skills/%ZZ/download"])("非法编码 %s 返回 400，服务继续处理请求", async (path) => {
    const base = await start();
    const response = await fetch(`${base}${path}`, { method: path.endsWith("download") ? "POST" : "GET" });
    expect(response.status).toBe(400);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("非法 JSON、null 请求体和无效 limit 不造成未处理的异常", async () => {
    const base = await start();
    for (const body of ["{broken", "null"]) {
      const response = await fetch(`${base}/admin/publishers`, {
        method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, body,
      });
      expect(response.status).toBe(400);
    }
    const invalidLimit = await fetch(`${base}/admin/audit-events?limit=NaN`, { headers: { Authorization: "Bearer test-token" } });
    expect(invalidLimit.status).toBe(400);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("覆盖已发布版本返回 409，原包继续可下载", async () => {
    const base = await start();
    const publish = (content: string) => fetch(`${base}/admin/publish`, {
      method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ package: { files: [
        { path: "SKILL.md", content: `---\nname: sample\ndescription: test\n---\n${content}` },
        { path: "skill.json", content: JSON.stringify({ id: "sample", name: "Sample", version: "1.0.0" }) },
      ] } }),
    });
    expect((await publish("original")).status).toBe(201);
    expect((await publish("original")).status).toBe(201);
    const conflict = await publish("changed");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "SKILL_VERSION_CONFLICT" } });
    const downloaded = await fetch(`${base}/skills/sample/download`);
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toContain("original");
  });

  it("未提供 Content-Length 的超限分块请求也返回 413", async () => {
    const base = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${base}/admin/publish`, {
        method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
      req.write('{"data":"');
      req.write("x".repeat(2048));
      req.end('"}');
    });
    expect(status).toBe(413);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("超限请求返回 413 后服务仍可用", async () => {
    const base = await start();
    const response = await fetch(`${base}/admin/publish`, {
      method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: JSON.stringify({ data: "x".repeat(2048) }),
    });
    expect(response.status).toBe(413);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});
