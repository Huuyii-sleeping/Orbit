import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = process.cwd();
const repoRoot = path.resolve(packageRoot, "..", "..");
const archiveRoot = path.join(repoRoot, "archive", "legacy-agent-runtime");

async function sourceText(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  const chunks: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      chunks.push(await sourceText(target));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      chunks.push(await readFile(target, "utf8"));
    }
  }
  return chunks.join("\n");
}

describe("runtime/mastra-only-boundary", () => {
  it("does not retain executable legacy Agent, Workflow, Memory, routing, or raw HTTP kernels", async () => {
    const removedFiles = [
      "src/agent-loop.ts",
      "src/runtime/query-engine.ts",
      "src/workflows/runtime.ts",
      "src/workflows/scheduler.ts",
      "src/workflows/state-machine.ts",
      "src/workflows/events.ts",
      "src/services/memory-service.ts",
      "src/models/messages.ts",
      "src/models/recovery.ts",
      "src/workflows/executors/llm.ts",
    ];

    for (const relativePath of removedFiles) {
      await expect(access(path.join(packageRoot, relativePath)), relativePath).rejects.toBeTruthy();
    }
    for (const relativePath of ["src/runtime/adapters/legacy", "src/runtime/routing", "src/memory"]) {
      await expect(access(path.join(packageRoot, relativePath)), relativePath).rejects.toBeTruthy();
    }

    const productionSource = await sourceText(path.join(packageRoot, "src"));
    expect(productionSource).not.toContain("createAgentHttpServer");
    expect(productionSource).not.toContain("LegacyAgentRuntimeAdapter");
    expect(productionSource).not.toContain("LegacyWorkflowRuntimeAdapter");
    expect(productionSource).not.toContain("LegacyMemoryRuntimeAdapter");
    expect(productionSource).not.toContain("createMastraDefaultAgentService");
    expect(productionSource).not.toContain('from "@ai-sdk/');
    expect(productionSource).not.toContain("Content-Length:");
    expect(productionSource).not.toContain("client.chat.completions.create");
  });

  it("routes every executable Agent entrypoint through the Mastra service and Nest host", async () => {
    const agentEntrypoints = [
      ["src/entrypoints/daemon.ts", "createMastraAgentService"],
      ["src/entrypoints/headless.ts", "createEmbeddedAgent"],
      ["src/entrypoints/mcp-server.ts", "createMastraAgentService"],
      ["src/entrypoints/tui.ts", "../cli/tui/readline.js"],
      ["src/entrypoints/tui-ink.tsx", "createTerminalRuntime"],
      ["src/cli/index.ts", "createEmbeddedAgent"],
      ["src/cli/tui/readline.ts", "createTerminalRuntime"],
      ["src/cli/tui/runtime.ts", "createEmbeddedAgent"],
      ["src/bootstrap/embedded-agent.ts", "createMastraAgentService"],
      ["src/entrypoints/server.ts", "createMastraAgentService"],
    ];

    for (const [relativePath, boundary] of agentEntrypoints) {
      const content = await readFile(path.join(packageRoot, relativePath), "utf8");
      expect(content, relativePath).toContain(boundary);
    }
    await expect(readFile(path.join(packageRoot, "src/entrypoints/server.ts"), "utf8")).resolves.toContain(
      "createNestAgentHttpServer",
    );
  });

  it("keeps the legacy source archive frozen and outside every executable dependency boundary", async () => {
    const readme = await readFile(path.join(archiveRoot, "README.md"), "utf8");
    expect(readme).toContain("FROZEN");
    expect(readme).toContain("READ-ONLY");
    expect(readme).toContain("NON-PRODUCTION");

    for (const relativePath of [
      "apps/agent-cli/src/agent-loop.ts",
      "apps/agent-cli/src/runtime/query-engine.ts",
      "apps/agent-cli/src/workflows/scheduler.ts",
      "apps/agent-cli/src/memory/service.ts",
    ]) {
      await expect(access(path.join(archiveRoot, relativePath)), relativePath).resolves.toBeUndefined();
    }

    for (const relativePath of [
      "package.json",
      "tsconfig.json",
      "apps/agent-cli/package.json",
      "apps/agent-cli/tsconfig.json",
      "apps/agent-cli/test",
    ]) {
      await expect(access(path.join(archiveRoot, relativePath)), relativePath).rejects.toBeTruthy();
    }

    const workspaceConfig = await readFile(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    expect(workspaceConfig).not.toContain("archive/legacy-agent-runtime");

    const activeConfigs = await Promise.all(
      [
        "package.json",
        "apps/agent-cli/package.json",
        "apps/agent-cli/tsconfig.json",
        "packages/runtime-contracts/package.json",
        "packages/runtime-contracts/tsconfig.json",
        "packages/workflow-core/package.json",
        "packages/workflow-core/tsconfig.json",
      ].map((relativePath) => readFile(path.join(repoRoot, relativePath), "utf8")),
    );
    expect(activeConfigs.join("\n")).not.toContain("archive/legacy-agent-runtime");

    const activeSource = await Promise.all([
      sourceText(path.join(packageRoot, "src")),
      sourceText(path.join(repoRoot, "packages", "runtime-contracts", "src")),
      sourceText(path.join(repoRoot, "packages", "workflow-core", "src")),
    ]);
    expect(activeSource.join("\n")).not.toContain("archive/legacy-agent-runtime");
  });
});
