import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { startModelProvider } from "../fixtures/model-provider.js";

const main = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url));
const tsconfig = fileURLToPath(new URL("../../tsconfig.json", import.meta.url));

describe("CLI → AgentService → Mastra → 文件工具", () => {
  it("/compact 改变后续模型实际收到的 Memory，上下文摘要独立执行且原始历史仍可查看", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-cli-compact-"));
    const provider = await startModelProvider({ textOnly: true });
    const old = `ARCHIVED_DETAIL_${"original detail ".repeat(90)}`;
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          [tsx, "--tsconfig", tsconfig, main],
          {
            cwd: root,
            timeout: 40_000,
            maxBuffer: 4 * 1024 * 1024,
            env: {
              ...process.env,
              MODEL_ID: "compact-test",
              MODEL_CONFIG_FILE: "",
              MODEL_PROVIDER: "",
              MODEL_CODING: "",
              OPENAI_API_KEY: "fixture-only",
              OPENAI_BASE_URL: provider.baseUrl,
              NO_COLOR: "1",
              FORCE_COLOR: "0",
            },
          },
          (error, stdout, stderr) =>
            error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout),
        );
        child.stdin?.end(`${old}\nKEEP_RECENT_DETAIL\n/compact 2\nAFTER_COMPACTION\n${Array.from({ length: 12 }, (_, index) => `FOLLOW_UP_${index}`).join("\n")}\n/history first\nq\n`);
      });
      expect(output).toContain("Compact");
      expect(output).not.toContain("compact unavailable");
      expect(provider.requests).toHaveLength(16);
      const summary = provider.requests[2]!.body;
      expect(JSON.stringify(summary)).toContain("ARCHIVED_DETAIL");
      expect(JSON.stringify(summary)).not.toContain("You are a coding agent");
      expect(summary.tools ?? []).toHaveLength(0);
      const after = JSON.stringify(provider.requests[3]!.body);
      expect(after).toContain("Earlier conversation summary");
      expect(after).toContain("KEEP_RECENT_DETAIL");
      expect(after).not.toContain("ARCHIVED_DETAIL");
      expect(after).toContain("You are a coding agent");
      // 超过默认的 20 条 Memory 消息窗口后，摘要仍然参与推理。
      expect(JSON.stringify(provider.requests.at(-1)!.body)).toContain("Earlier conversation summary");
      expect(output).toContain("ARCHIVED_DETAIL");
    } finally {
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 45_000);

  for (const mode of ["headless", "ink"] as const) {
    it(`${mode} 使用真实 CLI 进程完成模型与 read_file 工具往返`, async () => {
      const root = await mkdtemp(join(tmpdir(), "orbit-cli-mastra-"));
      const provider = await startModelProvider({
        tool: { name: "read_file", input: { path: "sample.txt" } },
      });
      try {
        await writeFile(join(root, "sample.txt"), "cli-tool-roundtrip-ok", "utf8");
        const output = await new Promise<string>((resolve, reject) => {
          const child = execFile(
            process.execPath,
            [
              tsx,
              "--tsconfig",
              tsconfig,
              main,
              ...(mode === "headless" ? ["--print", "Read sample.txt"] : []),
            ],
            {
              cwd: root,
              timeout: 40_000,
              maxBuffer: 4 * 1024 * 1024,
              env: {
                ...process.env,
                MODEL_ID: mode === "headless" ? "cli-test-model" : "",
                MODEL_CONFIG_FILE: "",
                MODEL_PROVIDER: "",
                MODEL_CODING: "",
                OPENAI_API_KEY: "fixture-only",
                OPENAI_BASE_URL: provider.baseUrl,
                NO_COLOR: "1",
                FORCE_COLOR: "0",
              },
            },
            (error, stdout, stderr) =>
              error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout),
          );
          child.stdin?.end(
            mode === "ink" ? "/model cli-test-model\n!pwd\nRead sample.txt\n/tools\nq\n" : "",
          );
        });
        expect(output).toContain("adapter-ok");
        if (mode === "ink") {
          expect(output).toContain("model set to cli-test-model");
          expect(output).toContain("read_file");
          expect(output).toContain("Shell");
          // Ink 会按终端宽度换行；macOS 的 /var 也可能显示为 /private/var。
          expect(output.replace(/\s+/g, "")).toContain(root);
        }
        expect(provider.requests).toHaveLength(2);
        expect(provider.requests[0]!.body.model).toBe("cli-test-model");
        expect(JSON.stringify(provider.requests[0]!.body)).toContain("You are a coding agent");
        expect(JSON.stringify(provider.requests[1]!.body)).toContain("cli-tool-roundtrip-ok");
        expect(provider.requests[1]!.body.messages).toEqual(
          expect.arrayContaining([expect.objectContaining({ role: "tool" })]),
        );
      } finally {
        await provider.close();
        await rm(root, { recursive: true, force: true });
      }
    }, 45_000);
  }
});
