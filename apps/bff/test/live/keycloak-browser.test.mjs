import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, afterEach, expect } from "vitest";
import { createBffHttpServer } from "../../src/server.ts";
import { createKeycloakFixture } from "../helpers/keycloak-fixture.ts";
import { cleanupFixture, listenHttp, startAgentProcess, stopAgent } from "../helpers/workflow-http-fixture.ts";
import { createStaticWebFixture } from "../helpers/static-web-fixture.mjs";
import { createTestHttpsProxy } from "../../../../scripts/test-https-proxy.mjs";

const cleanup = [];
const pages = [];
afterEach(async (context) => {
  try {
    if (context.task.result?.state === "fail") for (const page of pages) {
      if (!page.isClosed()) {
        if (await page.locator(".tenant-studio").count()) console.error("Overflow elements:", await page.locator(".tenant-studio").evaluate((root) =>
          [...root.querySelectorAll("*")].filter((element) => element.getBoundingClientRect().right > root.clientWidth + 1)
            .slice(0, 12).map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, available: root.clientWidth }))));
        console.error("Browser failure location:", new URL(page.url()).pathname, (await page.locator("body").innerText()).slice(0, 2000));
        if (process.env.ORBIT_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.ORBIT_BROWSER_SCREENSHOT, fullPage: true });
      }
    }
  } finally { pages.length = 0; await cleanupFixture(cleanup); }
});
const closeServer = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });

describe.skipIf(!process.env.ORBIT_KEYCLOAK_FIXTURE_PATH || !process.env.ORBIT_BROWSER_SMOKE)("真实浏览器 SaaS 最小工作流", () => {
  it("登录、修订、发布、审批/拒绝/取消、跨组织与跨页签清理形成闭环", async () => {
    // 支持 CI 安装的 playwright，也支持宿主提供的浏览器自动化运行时；不下载依赖到生产包。
    const { chromium } = await import(process.env.ORBIT_PLAYWRIGHT_MODULE || "playwright");
    const browser = await chromium.launch({ headless: true, ...(process.env.ORBIT_BROWSER_EXECUTABLE ? { executablePath: process.env.ORBIT_BROWSER_EXECUTABLE } : {}) });
    cleanup.push(() => browser.close());
    const root = await mkdtemp(join(tmpdir(), "orbit-browser-m1-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const configPath = process.env.ORBIT_KEYCLOAK_FIXTURE_PATH;
    const tls = JSON.parse(await readFile(configPath, "utf8"));
    let backend;
    const web = createStaticWebFixture(); cleanup.push(() => closeServer(web));
    const webURL = await listenHttp(web);
    const proxy = await createTestHttpsProxy(tls.keyPath, tls.certPath, (path) => /^\/(api|auth)(\/|\?|$)/.test(path) ? backend : webURL);
    cleanup.push(() => closeServer(proxy));
    const baseURL = (await listenHttp(proxy)).replace("http:", "https:");
    const keycloak = await createKeycloakFixture(configPath, baseURL); cleanup.push(keycloak.close);
    await keycloak.setRoles("alice", ["editor", "approver", "operator"]);
    await keycloak.addMembership("alice", "beta", ["viewer"]);
    const token = "browser-test-service-token-0123456789abcdef";
    const agent = await startAgentProcess(root, token); cleanup.push(() => stopAgent(agent.child));
    const bff = await createBffHttpServer({
      agentBaseUrl: agent.baseURL, agentServiceToken: token, filePath: join(root, "business.json"), skillDataRoot: join(root, "skills"), sopDataRoot: join(root, "sops"),
      identity: { mode: "saas", baseURL, issuerBaseURL: keycloak.issuer, jwksURL: `${keycloak.issuer}/protocol/openid-connect/certs`, clientID: keycloak.clientID,
        clientSecret: keycloak.clientSecret, sessionSecret: "d".repeat(64), sessionStorePath: join(root, "sessions.sqlite"), workflowAccess: "restricted" },
    });
    cleanup.push(() => closeServer(bff)); backend = await listenHttp(bff);
    const requests = []; const failures = [];
    const newUser = async (username) => {
      // 自签证书仅限当前隔离浏览器上下文；Node 与 Keycloak 的 TLS 校验仍使用 runner 配置的 CA。
      const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 1000 } });
      context.on("request", (request) => { if (request.url().startsWith(`${baseURL}/api/`)) requests.push(new URL(request.url()).pathname); });
      const page = await context.newPage(); pages.push(page); page.on("pageerror", (error) => failures.push(error.message));
      page.setDefaultTimeout(15_000);
      await page.goto(`${baseURL}/studio`);
      await page.getByRole("link", { name: "登录", exact: true }).click();
      const credentials = keycloak.browserCredentials(username);
      await page.locator('input[name="username"]').fill(credentials.username);
      await page.locator('button[type="submit"], input[type="submit"]').first().click();
      await page.locator('input[name="password"]').fill(credentials.password);
      await page.locator('button[type="submit"], input[type="submit"]').first().click();
      await page.waitForURL(`${baseURL}/studio`);
      await page.getByLabel("当前组织").waitFor();
      return { context, page };
    };
    const alice = await newUser("alice");
    await alice.page.getByLabel("当前组织").selectOption(keycloak.orgs.alpha);
    await alice.page.getByRole("heading", { name: "新建审批工作流" }).waitFor();
    const title = "M1 浏览器验收";
    await alice.page.getByLabel("工作流名称", { exact: true }).fill(title);
    await alice.page.getByLabel("待审批内容", { exact: true }).fill("审批 {{原样内容}} 与 <script>文本</script>");
    await alice.page.getByRole("button", { name: "创建草稿", exact: true }).click();
    await alice.page.getByRole("heading", { name: title, exact: true }).waitFor();
    await alice.page.mouse.move(1000, 800);
    await alice.page.mouse.wheel(0, 600);
    await expect.poll(() => alice.page.locator(".tenant-studio").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const staleEditor = await alice.context.newPage();
    await staleEditor.goto(`${baseURL}/studio`);
    await staleEditor.getByRole("heading", { name: title, exact: true }).waitFor();
    await alice.page.getByLabel("审批正文", { exact: true }).fill("修订后的 {{原样内容}} 与 <script>文本</script>");
    await alice.page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect.poll(() => alice.page.getByText(/草稿修订 1/).count()).toBe(1);
    await staleEditor.getByLabel("审批正文", { exact: true }).fill("过时草稿不能覆盖已保存的正文");
    const staleSave = staleEditor.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname.startsWith("/api/sops/"));
    await staleEditor.getByRole("button", { name: "保存草稿", exact: true }).click();
    expect((await staleSave).status()).toBe(409);
    await staleEditor.getByRole("alert").waitFor();
    await staleEditor.getByRole("button", { name: "刷新列表", exact: true }).click();
    await expect.poll(() => staleEditor.getByLabel("审批正文", { exact: true }).inputValue()).toBe("修订后的 {{原样内容}} 与 <script>文本</script>");
    await staleEditor.close();
    expect(await alice.page.getByRole("button", { name: "发布当前草稿" }).count()).toBe(0);
    const bob = await newUser("bob");
    await bob.page.getByRole("heading", { name: title, exact: true }).waitFor();
    expect(await bob.page.getByRole("button", { name: "保存草稿", exact: true }).count()).toBe(0);
    await bob.page.getByRole("button", { name: "发布当前草稿", exact: true }).click();
    await expect.poll(() => bob.page.getByLabel("发布版本", { exact: true }).inputValue()).not.toBe("");
    await alice.page.getByRole("button", { name: "刷新版本与运行" }).click();
    await expect.poll(() => alice.page.getByLabel("发布版本", { exact: true }).inputValue()).not.toBe("");
    const start = async () => {
      const responsePromise = alice.page.waitForResponse((response) => response.url() === `${baseURL}/api/workflow-runs` && response.request().method() === "POST");
      await alice.page.getByRole("button", { name: "运行所选版本" }).click();
      const response = await responsePromise; expect(response.status(), await response.text()).toBe(201);
      const run = (await response.json()).data;
      await alice.page.getByText("等待审批", { exact: true }).waitFor();
      expect(await alice.page.getByRole("button", { name: "同意并继续" }).count()).toBe(0);
      return run;
    };
    const approve = async (run, reject = false) => {
      await bob.page.getByRole("button", { name: "刷新版本与运行" }).click();
      if (reject) {
        await bob.page.getByLabel("打开运行 ID", { exact: true }).fill(run.id);
        await bob.page.getByRole("button", { name: "打开运行", exact: true }).click();
      } else await bob.page.getByRole("button", { name: new RegExp(run.id) }).click();
      await bob.page.getByRole("region", { name: "运行详情" }).getByText("修订后的 {{原样内容}} 与 <script>文本</script>", { exact: true }).waitFor();
      await bob.page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => bob.page.locator(".tenant-studio").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await bob.page.setViewportSize({ width: 1360, height: 1000 });
      if (process.env.ORBIT_BROWSER_SCREENSHOT) await bob.page.screenshot({ path: process.env.ORBIT_BROWSER_SCREENSHOT.replace(/\.png$/, "-approval.png"), fullPage: true });
      await bob.page.getByLabel(/审批意见/).fill(reject ? "拒绝" : "批准");
      await bob.page.getByRole("button", { name: reject ? "拒绝并继续" : "同意并继续" }).click();
      await bob.page.getByText("已完成", { exact: true }).waitFor();
      await alice.page.getByText("已完成", { exact: true }).waitFor();
    };
    const run = await start(); await approve(run);
    await approve(await start(), true);
    await start();
    await alice.page.getByRole("button", { name: "取消运行", exact: true }).click();
    await alice.page.getByText("已取消", { exact: true }).waitFor();
    const mallory = await newUser("mallory");
    await mallory.page.getByText("当前组织暂无工作流。", { exact: true }).waitFor();
    const denied = await mallory.context.request.get(`${baseURL}/api/workflow-runs/${run.id}`); expect(denied.status()).toBe(404);
    const otherTab = await alice.context.newPage(); await otherTab.goto(`${baseURL}/studio`);
    await otherTab.getByRole("heading", { name: title, exact: true }).waitFor();
    await alice.page.getByLabel("当前组织").selectOption(keycloak.orgs.beta);
    for (const page of [alice.page, otherTab]) {
      await page.getByText("当前组织暂无工作流。", { exact: true }).waitFor();
      expect(await page.getByRole("heading", { name: title, exact: true }).count()).toBe(0);
      expect(await page.getByRole("heading", { name: "新建审批工作流" }).count()).toBe(0);
      expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => /sop|workflow|tenant|session/i.test(key)))).toEqual([]);
    }
    await alice.page.getByLabel("当前组织").selectOption(keycloak.orgs.alpha);
    await alice.page.getByRole("heading", { name: title, exact: true }).waitFor();
    await alice.page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => alice.page.locator(".tenant-studio").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await alice.page.setViewportSize({ width: 1360, height: 1000 });
    if (process.env.ORBIT_BROWSER_SCREENSHOT) await alice.page.screenshot({ path: process.env.ORBIT_BROWSER_SCREENSHOT, fullPage: true });
    await alice.page.getByRole("button", { name: "退出登录", exact: true }).click();
    await alice.page.getByRole("heading", { name: "登录组织工作区" }).waitFor();
    await otherTab.getByRole("heading", { name: "登录组织工作区" }).waitFor();
    // 会话到期须卸载业务内容；用真实 IdP 签名注销模拟已建立会话失效。
    await keycloak.logout("bob"); await bob.page.bringToFront();
    await bob.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await bob.page.getByRole("heading", { name: "登录组织工作区" }).waitFor();
    expect(requests.every((path) => /^\/api\/(auth|sops|workflow-runs)(\/|$)/.test(path))).toBe(true);
    // 模式查询失败时必须停在错误页，不能误装配本地全功能工作台。
    const unavailable = await mallory.context.newPage(); pages.push(unavailable);
    const checkpoint = requests.length;
    await unavailable.route("**/api/auth/config", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "UNAVAILABLE", message: "unavailable" } }) }));
    await unavailable.goto(`${baseURL}/studio`);
    await unavailable.getByRole("heading", { name: "无法加载工作区" }).waitFor();
    expect(requests.slice(checkpoint).every((path) => path === "/api/auth/config")).toBe(true);
    await unavailable.unroute("**/api/auth/config");
    await unavailable.getByRole("button", { name: "重试", exact: true }).click();
    await unavailable.getByText("当前组织暂无工作流。", { exact: true }).waitFor();
    expect(failures).toEqual([]);
  }, 150_000);
});
