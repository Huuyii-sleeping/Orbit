import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillStoreService } from "../../../src/skills/skill-store.service.js";
import { SkillValidatorService } from "../../../src/skills/skill-validator.service.js";

const servers: Server[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const validator = new SkillValidatorService();
function pkg(content = "original") {
  const result = validator.validatePackage({ files: [
    { path: "SKILL.md", content: `---\nname: safe-skill\ndescription: test\n---\n${content}` },
    { path: "skill.json", content: JSON.stringify({ id: "safe-skill", name: "Safe", version: "1.0.0" }) },
  ] });
  if (!result.ok) throw new Error(result.errors.join(";"));
  return result.package;
}

describe("Skill Store persistence", () => {
  it("相同本地版本的重复与并发写入可重试，不允许覆盖内容", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-skill-write-"));
    roots.push(root);
    const store = new SkillStoreService(validator, { skillDataRoot: root });
    await Promise.all([store.writePackage("custom", pkg()), store.writePackage("custom", pkg())]);
    await expect(store.writePackage("custom", pkg("changed"))).rejects.toThrow(/already exists/);
    expect(await readFile(join(root, "custom/safe-skill/1.0.0/SKILL.md"), "utf8")).toContain("original");
  });

  it.each([false, true])("Registry 请求及响应体挂起时中断（已发头：%s）", async (sendHeaders) => {
    const server = createServer((_req, res) => {
      if (sendHeaders) { res.writeHead(200); res.write('{"skills":'); }
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const service = new SkillStoreService(validator, { registryRequestTimeoutMs: 80 });
    await expect(service.readRemoteRegistry(`http://127.0.0.1:${address.port}/skills`)).rejects.toThrow();
  }, 3000);
});
