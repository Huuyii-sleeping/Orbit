import { once } from "node:events";
import type { Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** 仅监听 loopback，兼容测试 HTTPS server。 */
export async function listenHttp(server: Server, port = 0): Promise<string> {
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

/** 关闭本轮创建的 Agent 子进程，超时后只终止该进程。 */
export async function stopAgent(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try { await exited; } finally { clearTimeout(timer); }
}

/** 在测试独占目录启动真实 Agent；不加载项目工作目录里的本地数据。 */
export async function startAgentProcess(root: string, serviceToken: string, port = 0) {
  const entry = new URL("../../../agent-cli/src/entrypoints/server.ts", import.meta.url).href;
  const config = fileURLToPath(new URL("../../../agent-cli/tsconfig.json", import.meta.url));
  const program = `import { runServer } from ${JSON.stringify(entry)};
    const server = await runServer({ port: ${port} });
    console.log('READY:' + server.address().port);`;
  const child = spawn(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), "--input-type=module", "--eval", program], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", AGENT_MODE: "saas", AGENT_SERVICE_TOKEN: serviceToken,
      TSX_TSCONFIG_PATH: config, AGENT_PRIVACY_PERSISTENCE_MODE: "default" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseURL = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Agent startup timeout: ${output}`)), 30_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Agent exited ${code}: ${output}`)); });
    child.stderr!.on("data", (chunk) => { output += String(chunk); });
    child.stdout!.on("data", (chunk) => {
      output += String(chunk);
      const ready = /READY:(\d+)/.exec(output);
      if (ready) { clearTimeout(timer); resolve(`http://127.0.0.1:${ready[1]}`); }
    });
  }).catch(async (error: unknown) => { await stopAgent(child); throw error; });
  return { baseURL, child };
}

/** 将应用与 IdP 的测试 Cookie 分别保存；不向第三方发送应用会话。 */
export function cookieJar() {
  const cookies = new Map<string, string>();
  return {
    header: () => [...cookies.values()].join("; "),
    receive(response: Response) {
      for (const item of response.headers.getSetCookie()) {
        const cookie = item.split(";")[0]!;
        const name = cookie.split("=")[0]!;
        if (cookie.endsWith("=")) cookies.delete(name); else cookies.set(name, cookie);
      }
    },
  };
}

/** 单项清理失败仍关闭其余资源，最后汇总报告。 */
export async function cleanupFixture(operations: Array<() => Promise<unknown>>): Promise<void> {
  const errors: unknown[] = [];
  for (const close of operations.splice(0).reverse()) {
    try { await close(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Test fixture cleanup failed");
}
