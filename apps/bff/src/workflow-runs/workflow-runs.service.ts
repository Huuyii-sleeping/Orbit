import { createHash } from "node:crypto";
import { OrganizationOperationsService } from "../identity/organization-operations.service.js";
import { writeStreamChunk } from "../stream-utils.js";
import { Inject, Injectable } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  assertWorkflowDefinitionBudget,
  assertWorkflowOutputBudget,
  WORKFLOW_OUTPUT_LIMITS,
  isWorkflowOutputLimitError,
  assertWorkflowInputBudget,
  assertWorkflowJsonBudget,
  WORKFLOW_PAYLOAD_LIMITS,
  isWorkflowDraft,
  requiredWorkflowStageECapabilities,
  stableSerialize,
  type AgentVersion,
  type AgentVersionResolver,
  type WorkflowNode,
  type WorkflowDraft,
  type WorkflowRunMode,
  type WorkflowVersion,
} from "@orbit/workflow-core";
import { AgentProxyService, type ProxyResult } from "../runtime-connection/agent-proxy.service.js";
import { AGENT_VERSION_REPOSITORY } from "../agents/agent-version.repository.js";
import { applyCommonHeaders, writeJson } from "../http/http-utils.js";
import { SOPS_REPOSITORY, type SopsRepository } from "../sops/sops.repository.js";
import { SopDatabase } from "../storage/sop-database.js";
import { WorkflowRunControlError } from "./workflow-runs.errors.js";
import { WorkflowSseDecoder } from "./sse-decoder.js";
import { WORKFLOW_RUNS_REPOSITORY, type WorkflowRunsRepository } from "./workflow-runs.types.js";
import type { ResumeWorkflowRunInput, StartWorkflowRunInput, WorkflowRunSnapshot } from "./workflow-runs.types.js";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requireMode(value: unknown): WorkflowRunMode {
  if (value === "node-test" || value === "draft" || value === "production") return value;
  throw new WorkflowRunControlError(400, "WORKFLOW_RUN_INVALID", "mode 必须是 node-test、draft 或 production。");
}

function upstreamError(result: ProxyResult): WorkflowRunControlError {
  const body = asObject(result.body);
  const error = asObject(body.error);
  return new WorkflowRunControlError(
    result.status,
    String(error.code ?? "WORKFLOW_AGENT_ERROR"),
    String(error.message ?? "Agent workflow runtime 请求失败。"),
    result.ok && result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {},
  );
}

function runFrom(result: ProxyResult, expected: { id?: string; workflowId?: string } = {}): WorkflowRunSnapshot {
  if (!result.ok) throw upstreamError(result);
  const body = asObject(result.body);
  if (body.ok === false) throw upstreamError(result);
  const run = asObject(body.run);
  try { assertWorkflowOutputBudget(run, WORKFLOW_OUTPUT_LIMITS.snapshotBytes); }
  catch (error) {
    if (!isWorkflowOutputLimitError(error)) throw error;
    throw new WorkflowRunControlError(502, "WORKFLOW_AGENT_RESPONSE_INVALID", "Agent 返回的运行快照超过资源上限。");
  }
  if (!run.id || !run.workflowId || !run.status || !run.mode || !run.nodeRuns
    || (expected.id !== undefined && run.id !== expected.id) || (expected.workflowId !== undefined && run.workflowId !== expected.workflowId)) {
    throw new WorkflowRunControlError(502, "WORKFLOW_AGENT_RESPONSE_INVALID", "Agent 返回的运行快照不完整。");
  }
  return run as WorkflowRunSnapshot;
}

/** workflow-runs 控制面：解析权威版本、代理 Agent、建立运行索引并转发 SSE。 */
@Injectable()
export class WorkflowRunsService {
  constructor(
    @Inject(AgentProxyService) private readonly agent: Pick<AgentProxyService, "startWorkflowRun" | "workflowRun" | "cancelWorkflowRun" | "resumeWorkflowRun" | "workflowEventStream">,
    @Inject(SOPS_REPOSITORY) private readonly sops: Pick<SopsRepository, "getDraft" | "getVersion">,
    @Inject(WORKFLOW_RUNS_REPOSITORY) private readonly runs: WorkflowRunsRepository,
    @Inject(AGENT_VERSION_REPOSITORY) private readonly agentVersions: AgentVersionResolver,
    @Inject(SopDatabase) private readonly storage: SopDatabase,
    @Inject(OrganizationOperationsService) private readonly operations: OrganizationOperationsService,
  ) {}

  /** 按草稿或发布版本启动运行；客户端不能直接提交生产快照。 */
  async start(input: StartWorkflowRunInput): Promise<WorkflowRunSnapshot> {
    this.operations.require("workflow.run");
    assertWorkflowJsonBudget(input, WORKFLOW_PAYLOAD_LIMITS.commandBytes);
    assertWorkflowInputBudget(input?.inputs);
    assertWorkflowInputBudget(input?.nodeInputs);
    const workflowId = String(input?.workflowId ?? "").trim();
    if (!workflowId) throw new WorkflowRunControlError(400, "WORKFLOW_RUN_INVALID", "workflowId 不能为空。");
    const mode = requireMode(input.mode);
    if (mode === "node-test" && !String(input.targetNodeId ?? "").trim()) {
      throw new WorkflowRunControlError(400, "WORKFLOW_RUN_INVALID", "单节点试运行必须指定 targetNodeId。");
    }
    const workflow = mode === "production"
      ? this.requireVersion(workflowId, input.versionId)
      : this.resolveDraft(workflowId, input.draft);
    assertWorkflowDefinitionBudget(workflow, { workflowVersions: {
      resolvePublishedVersion: (workflowId, versionId) => this.sops.getVersion(workflowId, versionId) ?? undefined,
    } });
    return this.launch(workflow, input, this.agentDependencies(workflow.nodes));
  }

  /** 只允许服务端组装的 Agent 测试快照进入普通草稿执行路径。 */
  async startAgentTest(workflow: WorkflowDraft, version: AgentVersion, inputs: Record<string, unknown>): Promise<WorkflowRunSnapshot> {
    this.operations.require("workflow.run");
    if (this.storage.isTenantScoped) throw new WorkflowRunControlError(403, "SAAS_CAPABILITY_NOT_ISOLATED", "Agent 试跑尚未完成执行隔离。");
    assertWorkflowDefinitionBudget(workflow);
    assertWorkflowInputBudget(inputs);
    return this.launch(workflow, { workflowId: workflow.id, mode: "draft", inputs }, [version]);
  }

  private async launch(workflow: WorkflowDraft | WorkflowVersion, input: StartWorkflowRunInput, agentDependencies: AgentVersion[]) {
    return this.operations.perform("workflow.run", { type: "workflow", id: "workflowId" in workflow ? workflow.workflowId : workflow.id }, async (actor) => {
      const workflowDependencies = this.workflowDependencies(workflow.nodes);
      const command = {
        workflow,
        workflow_dependencies: workflowDependencies,
        agent_dependencies: agentDependencies,
        approval_policy_ids: this.approvalPolicyIds(workflow.nodes),
        required_runtime_capabilities: requiredWorkflowStageECapabilities([
          ...workflow.nodes,
          ...workflowDependencies.flatMap((dependency) => dependency.nodes),
        ]),
        mode: input.mode,
        inputs: asObject(input.inputs),
        target_node_id: input.targetNodeId,
        node_inputs: asObject(input.nodeInputs),
      };
      assertWorkflowJsonBudget(command, WORKFLOW_PAYLOAD_LIMITS.commandBytes);
      const result = await this.agent.startWorkflowRun(command);
      const run = runFrom(result, { workflowId: "workflowId" in workflow ? workflow.workflowId : workflow.id });
      this.runs.saveRun(run, actor?.subject);
      return run;
    });
  }

  /** 读取独立 Agent 试跑的近期索引，状态详情仍以 Runtime 查询为准。 */
  listAgentTests(agentId: string) {
    this.operations.require("workflow.read");
    return this.runs.listByWorkflow(`agent-test-${agentId}`);
  }

  /** 查询 Agent 最新快照并同步本地索引。 */
  async get(runId: string): Promise<WorkflowRunSnapshot> {
    this.operations.require("workflow.read");
    this.requireOwnedRun(runId);
    const run = runFrom(await this.agent.workflowRun(runId), { id: runId });
    this.runs.saveRun(run);
    return run;
  }

  /** 取消请求由 Agent 传播到 executor AbortSignal。 */
  async cancel(runId: string): Promise<WorkflowRunSnapshot> {
    return this.operations.perform("workflow.cancel", { type: "run", id: runId }, async () => {
      this.requireOwnedRun(runId);
      const run = runFrom(await this.agent.cancelWorkflowRun(runId), { id: runId });
      this.runs.saveRun(run);
      return run;
    });
  }

  /** 验证当前 run waiting identity，并将决定薄代理到同一个 Agent Runtime run。 */
  async resume(runId: string, input: ResumeWorkflowRunInput): Promise<WorkflowRunSnapshot> {
    this.operations.require("workflow.approve");
    assertWorkflowJsonBudget(input, WORKFLOW_PAYLOAD_LIMITS.inputBytes);
    assertWorkflowInputBudget(input?.data);
    const interruptId = typeof input?.interruptId === "string" ? input.interruptId.trim() : "";
    const idempotencyKey = typeof input?.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
    if (!interruptId || !idempotencyKey || (input.action !== "approve" && input.action !== "reject")) {
      throw new WorkflowRunControlError(400, "WORKFLOW_RUN_RESUME_INVALID", "interruptId、approve/reject action 和 idempotencyKey 均为必填。");
    }
    return this.operations.perform("workflow.approve", { type: "run", id: runId }, async (actor) => {
      this.requireOwnedRun(runId);
      if (actor) {
        const initiator = this.runs.getInitiator(runId);
        if (!initiator) throw new WorkflowRunControlError(403, "WORKFLOW_RUN_INITIATOR_REQUIRED", "运行缺少可信发起人，不能审批。");
        if (initiator === actor.subject) throw new WorkflowRunControlError(403, "WORKFLOW_SELF_APPROVAL_FORBIDDEN", "运行发起人不能审批自己的运行。");
      }
      const current = await this.get(runId);
      const waiting = current.waiting?.waiting;
      // Runtime 持有 run-scoped 幂等回执；终态和处理中重试必须交给它判断。
      if (current.status === "waiting" && (waiting?.kind !== "approval" || (waiting.interruptId !== interruptId && waiting.approvalRequestId !== interruptId))) {
        throw new WorkflowRunControlError(
          409, "WORKFLOW_RUN_RESUME_CONFLICT", "interruptId 不属于当前 Workflow run。", { runId, interruptId },
        );
      }
      const result = await this.agent.resumeWorkflowRun(runId, {
        step_id: current.waiting?.nodeId,
        resume_data: {
          interruptId,
          approvalRequestId: interruptId,
          action: input.action,
          data: asObject(input.data),
        },
        interrupt: {
          interrupt_id: interruptId,
          action: input.action,
          idempotency_key: idempotencyKey,
        },
      });
      const run = runFrom(result, { id: runId });
      this.runs.saveRun(run);
      return run;
    }, {
      interruptId, decision: input.action,
      idempotencyKeyHash: createHash("sha256").update(idempotencyKey).digest("hex"),
    });
  }

  /** 原样转发 Agent SSE，同时按事件 id 幂等落库。 */
  async stream(runId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.operations.require("workflow.read");
    this.requireOwnedRun(runId);
    const requestUrl = new URL(req.url ?? "", "http://127.0.0.1");
    const lastEventId = typeof req.headers["last-event-id"] === "string" ? req.headers["last-event-id"] : undefined;
    const controller = new AbortController();
    let completed = false;
    const close = () => { if (!completed) controller.abort(); };
    res.once("close", close);
    try {
      const upstream = await this.agent.workflowEventStream(runId, requestUrl.search, lastEventId, controller.signal);
      if (!upstream.ok) {
        const raw = await upstream.text();
        const retryAfter = Number(upstream.headers.get("retry-after"));
        if (upstream.status === 429 && Number.isSafeInteger(retryAfter) && retryAfter > 0) res.setHeader("Retry-After", Math.min(retryAfter, 3_600));
        writeJson(res, upstream.status, raw.trim() ? JSON.parse(raw) as unknown : { ok: false });
        return;
      }
      applyCommonHeaders(res);
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      if (!upstream.body) {
        completed = true;
        res.end();
        return;
      }
      const reader = upstream.body.getReader();
      const text = new TextDecoder();
      const decoder = new WorkflowSseDecoder();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const frame of decoder.push(text.decode(chunk.value, { stream: true }))) {
            if (!this.persistFrame(frame)) continue;
            if (!await writeStreamChunk(res, frame)) return;
          }
        }
        for (const frame of decoder.push(text.decode())) {
          if (!this.persistFrame(frame)) continue;
          if (!await writeStreamChunk(res, frame)) return;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      completed = true;
      res.end();
    } catch (error) {
      if (controller.signal.aborted || res.headersSent) {
        res.end();
        return;
      }
      throw new WorkflowRunControlError(502, "WORKFLOW_AGENT_UNAVAILABLE", error instanceof Error ? error.message : String(error));
    } finally { res.off("close", close); controller.abort(); }
  }

  /** 测试和后续运行历史页面可读取已持久化索引。 */
  persisted(runId: string): WorkflowRunSnapshot | null {
    this.operations.require("workflow.read");
    return this.runs.getRun(runId);
  }

  private requireOwnedRun(runId: string): void {
    // 本地模式继续允许访问 Agent 已有运行；SaaS 必须先找到当前租户的持久化归属。
    if (this.storage.tenantScope().issuer && !this.runs.getRun(runId)) {
      throw new WorkflowRunControlError(404, "WORKFLOW_RUN_NOT_FOUND", `Workflow run ${runId} 不存在。`);
    }
  }

  private resolveDraft(workflowId: string, inlineDraft: StartWorkflowRunInput["draft"]) {
    if (this.storage.isTenantScoped && !this.sops.getDraft(workflowId)) {
      throw new WorkflowRunControlError(404, "SOP_NOT_FOUND", `草稿 ${workflowId} 不存在。`);
    }
    if (inlineDraft !== undefined) {
      if (!isWorkflowDraft(inlineDraft) || inlineDraft.id !== workflowId) {
        throw new WorkflowRunControlError(400, "WORKFLOW_RUN_INVALID", "试运行草稿必须是当前 workflowId 对应的 workflow v2 数据。");
      }
      return inlineDraft;
    }
    const draft = this.sops.getDraft(workflowId);
    if (!draft) throw new WorkflowRunControlError(404, "SOP_NOT_FOUND", `草稿 ${workflowId} 不存在。`);
    return draft;
  }

  private requireVersion(workflowId: string, versionId: string | undefined) {
    if (!versionId) throw new WorkflowRunControlError(400, "WORKFLOW_RUN_INVALID", "production 运行必须指定 versionId。");
    const version = this.sops.getVersion(workflowId, versionId);
    if (!version) throw new WorkflowRunControlError(404, "SOP_VERSION_NOT_FOUND", `版本 ${versionId} 不存在。`);
    return version;
  }

  private workflowDependencies(nodes: readonly WorkflowNode[]): WorkflowVersion[] {
    const dependencies = new Map<string, WorkflowVersion>();
    const visiting = new Set<string>();
    const visitNodes = (currentNodes: readonly WorkflowNode[]): void => {
      for (const node of currentNodes) {
        if (node.kind !== "builtin") continue;
        if (node.type === "iteration" || node.type === "loop") visitNodes(node.config.body.nodes);
        if (node.type !== "subworkflow") continue;
        const key = `${node.config.workflowId}:${node.config.versionId}`;
        if (visiting.has(key)) {
          throw new WorkflowRunControlError(409, "WORKFLOW_DEPENDENCY_RECURSIVE", `Subworkflow 依赖存在递归：${key}。`);
        }
        const version = this.sops.getVersion(node.config.workflowId, node.config.versionId);
        if (!version) {
          throw new WorkflowRunControlError(404, "SOP_VERSION_NOT_FOUND", `Subworkflow 版本 ${node.config.versionId} 不存在。`);
        }
        if (version.contentHash !== node.config.contentHash) {
          throw new WorkflowRunControlError(409, "WORKFLOW_DEPENDENCY_MISMATCH", `Subworkflow 版本 ${node.config.versionId} 的 contentHash 不匹配。`);
        }
        if (dependencies.has(key)) continue;
        dependencies.set(key, version);
        visiting.add(key);
        visitNodes(version.nodes);
        visiting.delete(key);
      }
    };
    visitNodes(nodes);
    return [...dependencies.values()];
  }

  private agentDependencies(nodes: readonly WorkflowNode[]): AgentVersion[] {
    const dependencies = new Map<string, AgentVersion>();
    const visitedWorkflows = new Set<string>();
    const visitNodes = (currentNodes: readonly WorkflowNode[]): void => {
      for (const node of currentNodes) {
        if (node.kind !== "builtin") continue;
        if (node.type === "iteration" || node.type === "loop") visitNodes(node.config.body.nodes);
        if (node.type === "agent") {
          const version = this.agentVersions.resolvePublishedVersion(
            node.config.agentProfileId,
            node.config.agentVersionId,
          );
          if (!version) {
            throw new WorkflowRunControlError(
              404,
              "AGENT_VERSION_NOT_FOUND",
              `AgentVersion ${node.config.agentVersionId} 不存在或 profile 不匹配。`,
            );
          }
          if (stableSerialize(version.outputSchema) !== stableSerialize(node.config.outputSchema)) {
            throw new WorkflowRunControlError(
              409,
              "AGENT_VERSION_OUTPUT_SCHEMA_MISMATCH",
              `AgentVersion ${node.config.agentVersionId} 的 outputSchema 与 Workflow 节点不一致。`,
            );
          }
          dependencies.set(`${version.agentProfileId}:${version.id}`, version);
          continue;
        }
        if (node.type !== "subworkflow") continue;
        const key = `${node.config.workflowId}:${node.config.versionId}`;
        if (visitedWorkflows.has(key)) continue;
        const version = this.sops.getVersion(node.config.workflowId, node.config.versionId);
        if (!version || version.contentHash !== node.config.contentHash) {
          throw new WorkflowRunControlError(
            version ? 409 : 404,
            version ? "WORKFLOW_DEPENDENCY_MISMATCH" : "SOP_VERSION_NOT_FOUND",
            version
              ? `Subworkflow 版本 ${node.config.versionId} 的 contentHash 不匹配。`
              : `Subworkflow 版本 ${node.config.versionId} 不存在。`,
          );
        }
        visitedWorkflows.add(key);
        visitNodes(version.nodes);
      }
    };
    visitNodes(nodes);
    return [...dependencies.values()];
  }

  private approvalPolicyIds(nodes: readonly WorkflowNode[]): string[] {
    const policyIds = new Set<string>();
    const visitedWorkflows = new Set<string>();
    const visitNodes = (currentNodes: readonly WorkflowNode[]): void => {
      for (const node of currentNodes) {
        if (node.kind !== "builtin") continue;
        if (node.type === "iteration" || node.type === "loop") visitNodes(node.config.body.nodes);
        if (node.type === "human-approval") policyIds.add(node.config.policyId);
        if (node.type !== "subworkflow") continue;
        const key = `${node.config.workflowId}:${node.config.versionId}`;
        if (visitedWorkflows.has(key)) continue;
        const version = this.sops.getVersion(node.config.workflowId, node.config.versionId);
        if (!version || version.contentHash !== node.config.contentHash) continue;
        visitedWorkflows.add(key);
        visitNodes(version.nodes);
      }
    };
    visitNodes(nodes);
    return [...policyIds].sort();
  }

  private persistFrame(frame: string): boolean {
    const event = WorkflowSseDecoder.runtimeEvent(frame);
    if (!event) return false;
    this.runs.saveEvent(event);
    return true;
  }
}
