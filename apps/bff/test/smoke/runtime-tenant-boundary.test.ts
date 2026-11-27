import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { builtinNodeRegistry } from "@orbit/workflow-core";
import { encodeServiceTenant, SERVICE_TENANT_HEADER } from "@orbit/service-auth";
import { AgentProxyService } from "../../src/runtime-connection/agent-proxy.service.js";
import { runWithTenant } from "../../src/identity/tenant-context.js";
import { createTestDraft } from "../unit/sops/test-fixtures.js";
import { WorkflowSseDecoder } from "../../src/workflow-runs/sse-decoder.js";
import { TENANT_WORKFLOW_QUOTAS } from "@orbit/service-auth";
import { TENANT_HTTP_LIMITS } from "@orbit/service-auth/http";

const token = "runtime-tenant-smoke-token-0123456789abcdef";
const alpha = { issuer: "https://id.example", tenantId: "org-a", subject: "user-a" };
const beta = { ...alpha, tenantId: "org-b" };
const children: ChildProcess[] = [];
const roots: string[] = [];

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try { await exited; } finally { clearTimeout(timer); }
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(stop));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function startAgent(root: string) {
  const entry = new URL("../../../agent-cli/src/entrypoints/server.ts", import.meta.url).href;
  const config = fileURLToPath(new URL("../../../agent-cli/tsconfig.json", import.meta.url));
  const program = `import { runServer } from ${JSON.stringify(entry)};
    const server = await runServer({ port: 0 });
    console.log('READY:' + server.address().port);`;
  const child = spawn(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), "--input-type=module", "--eval", program], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", AGENT_MODE: "saas", AGENT_SERVICE_TOKEN: token,
      TSX_TSCONFIG_PATH: config, AGENT_PRIVACY_PERSISTENCE_MODE: "default" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return new Promise<string>((resolve, reject) => {
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
  });
}

function approvalWorkflow() {
  const workflow = createTestDraft("shared-workflow");
  const definition = builtinNodeRegistry.get("human-approval")!;
  const config = definition.createDefaultConfig();
  config.policyId = "policy-1";
  workflow.nodes.splice(1, 0, {
    kind: "builtin", id: "approval", type: "human-approval", version: 1, label: "审批",
    position: { x: 0, y: 80 }, config, ports: definition.createPorts(config),
  });
  workflow.edges = [
    { id: "start-approval", source: { nodeId: "start", portId: "out" }, target: { nodeId: "approval", portId: "in" } },
    { id: "approval-end", source: { nodeId: "approval", portId: "approved" }, target: { nodeId: "end", portId: "in" } },
  ];
  return workflow;
}

describe("真实 Agent 进程的租户授权链路", () => {
  it("组织运行额度在并发、waiting 和进程重启后成立，取消释放额度并保留其他组织容量", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-runtime-concurrency-")); roots.push(root);
    let base = await startAgent(root);
    const proxy = () => new AgentProxyService({ agentBaseUrl: base, agentServiceToken: token });
    const start = (identity = alpha) => runWithTenant(identity, () => proxy().startWorkflowRun({
      workflow: approvalWorkflow(), mode: "draft", approval_policy_ids: ["policy-1"],
    }));
    const results = await Promise.all(Array.from({ length: 8 }, () => start()));
    const accepted = results.filter((result) => result.status === 201);
    expect(accepted).toHaveLength(TENANT_WORKFLOW_QUOTAS.unfinishedRuns);
    const rejected = results.filter((result) => result.status === 429);
    expect(rejected).toHaveLength(3);
    for (const result of rejected) expect(result).toMatchObject({ retryAfterSeconds: 60, body: { error: { code: "WORKFLOW_CONCURRENCY_LIMIT" } } });
    const runIds = accepted.map((result) => (result.body as { run: { id: string } }).run.id);
    await runWithTenant(alpha, async () => {
      await expect.poll(async () => (await Promise.all(runIds.map((id) => proxy().workflowRun(id))))
        .every((result) => (result.body as { run: { status: string } }).run.status === "waiting")).toBe(true);
    });
    await stop(children[0]); base = await startAgent(root);
    expect(await start()).toMatchObject({ status: 429, body: { error: { code: "WORKFLOW_CONCURRENCY_LIMIT" } } });
    const other = await start(beta); expect(other.status).toBe(201);
    await runWithTenant(alpha, async () => {
      expect((await proxy().cancelWorkflowRun(runIds[0]!)).status).toBe(202);
    });
    const replacement = await start(); expect(replacement.status).toBe(201);
    const invalid = await Promise.all(Array.from({ length: 25 }, () => runWithTenant(beta,
      () => proxy().startWorkflowRun({ workflow: {}, mode: "draft" }))));
    expect(invalid.some((result) => result.status === 429 && (result.body as { error?: { code?: string } }).error?.code === "TENANT_REQUEST_RATE_LIMIT")).toBe(true);
    await runWithTenant(beta, async () => {
      const otherId = (other.body as { run: { id: string } }).run.id;
      expect((await proxy().workflowRun(otherId)).status).toBe(200);
      expect((await proxy().cancelWorkflowRun(otherId)).status).toBe(202);
    });
  }, 60_000);

  it("真实 waiting SSE 超额返回 429，断线释放连接额度且运行继续等待", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-runtime-stream-quota-")); roots.push(root);
    const base = await startAgent(root);
    const proxy = new AgentProxyService({ agentBaseUrl: base, agentServiceToken: token });
    const controllers: AbortController[] = [];
    try {
      await runWithTenant(alpha, async () => {
        const started = await proxy.startWorkflowRun({ workflow: approvalWorkflow(), mode: "draft", approval_policy_ids: ["policy-1"] });
        const runId = (started.body as { run: { id: string } }).run.id;
        const open = () => {
          const controller = new AbortController(); controllers.push(controller);
          return proxy.workflowEventStream(runId, "", "0", controller.signal);
        };
        expect((await Promise.all(Array.from({ length: TENANT_HTTP_LIMITS.tenantStreams }, open)))
          .every((response) => response.status === 200)).toBe(true);
        const denied = await open(); expect(denied.status).toBe(429);
        expect(await denied.json()).toMatchObject({ error: { code: "TENANT_STREAM_LIMIT" } });
        controllers[0]!.abort();
        await expect.poll(async () => {
          const response = await open();
          if (response.status !== 200) await response.body?.cancel();
          return response.status;
        }).toBe(200);
        await expect.poll(async () => (await proxy.workflowRun(runId)).body).toMatchObject({ run: { status: "waiting" } });
      });
    } finally { controllers.forEach((controller) => controller.abort()); }
  }, 60_000);

  it("合法输入展开为超限输出后，HTTP 查询和 SSE 均返回资源失败，重启后仍可回放", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-runtime-output-budget-")); roots.push(root);
    let base = await startAgent(root);
    const proxy = () => new AgentProxyService({ agentBaseUrl: base, agentServiceToken: token });
    const workflow = createTestDraft("output-budget");
    const definition = builtinNodeRegistry.get("template")!;
    const config = {
      template: "{{text}}".repeat(7),
      variables: { text: { kind: "variable" as const, ref: { scope: "workflow-input" as const, inputId: "text" } } },
    };
    const start = builtinNodeRegistry.get("start")!;
    const startConfig = { inputs: [{ id: "text", name: "Text", dataType: "string" as const, required: true }] };
    workflow.nodes[0] = { ...workflow.nodes[0]!, config: startConfig, ports: start.createPorts(startConfig) };
    workflow.nodes.splice(1, 0, {
      kind: "builtin", id: "expand", type: "template", version: 1, label: "Expand",
      position: { x: 0, y: 80 }, config, ports: definition.createPorts(config),
    });
    workflow.edges = [
      { id: "start-expand", source: { nodeId: "start", portId: "out" }, target: { nodeId: "expand", portId: "in" } },
      { id: "expand-end", source: { nodeId: "expand", portId: "text" }, target: { nodeId: "end", portId: "in" } },
    ];
    await runWithTenant(alpha, async () => {
      const started = await proxy().startWorkflowRun({ workflow, mode: "draft", inputs: { text: "x".repeat(180_000) } });
      expect(started.status).toBe(201);
      const runId = (started.body as { run: { id: string } }).run.id;
      const stream = await proxy().workflowEventStream(runId, "", "0", AbortSignal.timeout(10_000));
      expect(stream.status).toBe(200);
      const events = await stream.text();
      expect(events).toContain('"code":"WORKFLOW_OUTPUT_LIMIT_EXCEEDED"');
      expect(events.split("\n\n").map((frame) => WorkflowSseDecoder.runtimeEvent(frame))
        .filter((event) => event?.type === "run.status").map((event) => event.status)).not.toContain("succeeded");
      const failed = await proxy().workflowRun(runId);
      expect(failed.body).toMatchObject({ run: { status: "failed", error: { code: "WORKFLOW_OUTPUT_LIMIT_EXCEEDED" } } });
      expect((failed.body as { run: { output?: unknown } }).run.output).toBeUndefined();
      await stop(children[0]);
      base = await startAgent(root);
      expect((await proxy().workflowRun(runId)).body).toMatchObject({ run: { status: "failed", error: { code: "WORKFLOW_OUTPUT_LIMIT_EXCEEDED" } } });
      const replay = await proxy().workflowEventStream(runId, "", "0", AbortSignal.timeout(10_000));
      expect(await replay.text()).toBe(events);
      const healthy = await proxy().startWorkflowRun({ workflow: createTestDraft("healthy-after-budget"), mode: "draft" });
      expect(healthy.status).toBe(201);
      const healthyId = (healthy.body as { run: { id: string } }).run.id;
      const healthyEvents = await proxy().workflowEventStream(healthyId, "", "0", AbortSignal.timeout(10_000));
      expect(await healthyEvents.text()).toContain('"status":"succeeded"');
    });
  }, 60_000);

  it("BFF 代理传递可信身份，运行与 SSE 跨租户不可见，进程重启后可审批恢复", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-runtime-tenants-")); roots.push(root);
    let base = await startAgent(root);
    const proxy = () => new AgentProxyService({ agentBaseUrl: base, agentServiceToken: token });
    const started = await runWithTenant(alpha, () => proxy().startWorkflowRun({
      workflow: approvalWorkflow(), mode: "draft", approval_policy_ids: ["policy-1"],
      requestContext: { ownerId: "forged", tenantId: beta.tenantId },
    }));
    expect(started.status).toBe(201);
    const body = started.body as { run: { id: string } };
    const runId = body.run.id;
    let snapshot: { status: string; waiting?: { waiting?: { interruptId: string } } } | undefined;
    await runWithTenant(alpha, async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await proxy().workflowRun(runId);
        expect(result.status).toBe(200);
        snapshot = (result.body as { run: typeof snapshot }).run;
        if (snapshot?.status === "waiting") return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Workflow did not suspend");
    });
    expect(snapshot?.waiting?.waiting?.interruptId).toBeTruthy();

    for (const identity of [beta, { ...alpha, issuer: "https://another-id.example" }]) {
      await runWithTenant(identity, async () => {
        expect((await proxy().workflowRun(runId)).status).toBe(404);
        expect((await proxy().cancelWorkflowRun(runId)).status).toBe(404);
        expect((await proxy().resumeWorkflowRun(runId, { resume_data: {} })).status).toBe(404);
        const events = await proxy().workflowEventStream(runId, "", undefined, AbortSignal.timeout(3_000));
        expect(events.status).toBe(404); await events.body?.cancel();
      });
    }
    const auth = { Authorization: `Bearer ${token}` };
    expect((await fetch(`${base}/workflow-runs/${runId}`, { headers: auth })).status).toBe(401);
    expect((await fetch(`${base}/sessions`, { headers: { ...auth, [SERVICE_TENANT_HEADER]: encodeServiceTenant(alpha) } })).status).toBe(403);

    await stop(children[0]);
    base = await startAgent(root);
    await runWithTenant({ ...alpha, subject: "colleague" }, async () => {
      const restored = await proxy().workflowRun(runId);
      expect(restored.status).toBe(200);
      const interruptId = snapshot!.waiting!.waiting!.interruptId;
      const decision = {
        step_id: "approval", resume_data: { interruptId, action: "approve", data: {} },
        interrupt: { interrupt_id: interruptId, action: "approve", idempotency_key: "decision-1" },
      };
      const resumed = await proxy().resumeWorkflowRun(runId, decision);
      expect(resumed.status).toBe(200);
      expect(resumed.body).toMatchObject({ run: { status: "succeeded" } });
      expect((await proxy().resumeWorkflowRun(runId, decision)).status).toBe(200);
      const events = await proxy().workflowEventStream(runId, "", "0", AbortSignal.timeout(3_000));
      expect(events.status).toBe(200);
      expect(await events.text()).toContain('"status":"succeeded"');
    });
    await runWithTenant(beta, async () => expect((await proxy().workflowRun(runId)).status).toBe(404));
  }, 60_000);
});
