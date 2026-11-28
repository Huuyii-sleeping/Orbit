import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createTestHttpsProxy } from "./test-https-proxy.mjs";

const exec = promisify(execFile);
const browser = process.argv.includes("--browser");
const capacity = process.argv.includes("--capacity");
const image = "quay.io/keycloak/keycloak@sha256:9409c59bdfb65dbffa20b11e6f18b8abb9281d480c7ca402f51ed3d5977e6007"; // 26.4.7 multi-arch manifest
const root = await mkdtemp(join(tmpdir(), "orbit-keycloak-smoke-"));
const container = `orbit-keycloak-smoke-${randomBytes(6).toString("hex")}`;
const password = randomBytes(32).toString("hex");
let started = false;
let proxy;
try {
  const keyPath = join(root, "test.key"); const certPath = join(root, "test.crt");
  await exec("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=Orbit isolated test",
    "-addext", "subjectAltName=IP:127.0.0.1,DNS:host.docker.internal", "-keyout", keyPath, "-out", certPath]);
  let backend;
  proxy = await createTestHttpsProxy(keyPath, certPath, () => backend);
  await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(0, "127.0.0.1", resolve); });
  const baseURL = `https://127.0.0.1:${proxy.address().port}`;
  const envFile = join(root, "container.env");
  await writeFile(envFile, `KC_BOOTSTRAP_ADMIN_USERNAME=orbit-test-admin\nKC_BOOTSTRAP_ADMIN_PASSWORD=${password}\nKC_HOSTNAME=${baseURL}\nKC_PROXY_HEADERS=xforwarded\nKC_TRUSTSTORE_PATHS=/opt/keycloak/conf/test-ca.crt\n`, { mode: 0o600 });
  console.log("Starting isolated Keycloak 26.4.7 with HTTPS gateways...");
  await exec("docker", ["run", "--detach", "--rm", "--name", container, "--label", "com.orbit.test=m1-identity",
    "--publish", "127.0.0.1::8080", "--env-file", envFile, "--volume", `${certPath}:/opt/keycloak/conf/test-ca.crt:ro`, image, "start-dev"], { timeout: 180_000 });
  started = true;
  const { stdout } = await exec("docker", ["port", container, "8080/tcp"]);
  const port = stdout.trim().split(":").at(-1);
  backend = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (true) {
    try {
      const response = await fetch(`${backend}/realms/master/.well-known/openid-configuration`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) break;
    } catch { /* 只在启动就绪探测阶段重试，不重试业务操作。 */ }
    if (Date.now() >= deadline) throw new Error("Keycloak readiness timeout");
    await delay(1_000);
  }
  const configPath = join(root, "fixture.json");
  await writeFile(configPath, JSON.stringify({ baseURL, admin: "orbit-test-admin", password, keyPath, certPath }), { mode: 0o600 });
  const result = await exec("pnpm", ["--filter", "agent-bff", "test", "test/live/keycloak-workflow.test.ts", ...(browser ? ["test/live/keycloak-browser.test.mjs"] : []), ...(capacity ? ["test/live/keycloak-capacity.test.ts"] : []), "--maxWorkers=1", "--minWorkers=1"], {
    env: { ...process.env, NODE_ENV: "production", NODE_EXTRA_CA_CERTS: certPath, ORBIT_KEYCLOAK_FIXTURE_PATH: configPath, ORBIT_BROWSER_SMOKE: browser ? "1" : "", ORBIT_CAPACITY_SMOKE: capacity ? "1" : "" }, timeout: 300_000, maxBuffer: 4_194_304,
  });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  console.error("Keycloak smoke failed:", error.message);
  process.exitCode = 1;
} finally {
  if (proxy) { proxy.closeAllConnections(); await new Promise((resolve) => proxy.close(resolve)); }
  if (started) {
    try { await exec("docker", ["rm", "--force", container]); }
    catch { console.error("Could not remove test container:", container); process.exitCode = 1; }
  }
  await rm(root, { recursive: true, force: true });
}
