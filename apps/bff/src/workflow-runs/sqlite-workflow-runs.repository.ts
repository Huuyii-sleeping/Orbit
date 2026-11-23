import { Inject, Injectable, Optional } from "@nestjs/common";
import { applyWorkflowRuntimeEventToSnapshot, type WorkflowRuntimeEvent } from "@orbit/workflow-core";
import { SopDatabase } from "../sops/sop-database.js";
import type { WorkflowNodeRunSnapshot, WorkflowRunSnapshot, WorkflowRunsRepository } from "./workflow-runs.types.js";

type RunRow = {
  id: string;
  workflow_id: string;
  version_id: string | null;
  content_hash: string | null;
  mode: WorkflowRunSnapshot["mode"];
  status: WorkflowRunSnapshot["status"];
  input_json: string;
  output_json: string | null;
  error_json: string | null;
  node_instances_json: string | null;
  child_runs_json: string | null;
  waiting_json: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
};

type NodeRunRow = {
  node_id: string;
  status: WorkflowNodeRunSnapshot["status"];
  attempt: number;
  input_json: string | null;
  output_json: string | null;
  error_json: string | null;
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
};

function parseObject(value: string | null): Record<string, unknown> | undefined {
  return value ? JSON.parse(value) as Record<string, unknown> : undefined;
}

const DEFAULT_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

/** SQLite 运行索引；所有状态事实均来自 Agent 快照和事件。 */
@Injectable()
export class SqliteWorkflowRunsRepository implements WorkflowRunsRepository {
  private readonly now: () => number;
  private readonly terminalRetentionMs: number;

  constructor(
    @Inject(SopDatabase) private readonly storage: SopDatabase,
    @Optional() options?: { now?: () => number; terminalRetentionMs?: number },
  ) {
    this.now = options?.now ?? Date.now;
    this.terminalRetentionMs = options?.terminalRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS;
  }

  saveRun(run: WorkflowRunSnapshot): void {
    this.cleanupExpired();
    this.storage.database.transaction(() => {
      const current = this.storage.database.prepare("select status from workflow_runs where id = ?").get(run.id) as { status: string } | undefined;
      if (current && ["succeeded", "failed", "cancelled"].includes(current.status) && current.status !== run.status) return;
      this.storage.database.prepare(`
        insert into workflow_runs(id, workflow_id, version_id, content_hash, mode, status, input_json, output_json, error_json, node_instances_json, child_runs_json, waiting_json, created_at, started_at, finished_at)
        values (@id, @workflowId, @versionId, @contentHash, @mode, @status, @inputs, @output, @error, @nodeInstances, @childRuns, @waiting, @createdAt, @startedAt, @finishedAt)
        on conflict(id) do update set
          status = excluded.status,
          output_json = excluded.output_json,
          error_json = excluded.error_json,
          node_instances_json = excluded.node_instances_json,
          child_runs_json = excluded.child_runs_json,
          waiting_json = excluded.waiting_json,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at
      `).run({
        id: run.id,
        workflowId: run.workflowId,
        versionId: run.versionId ?? null,
        contentHash: run.contentHash ?? null,
        mode: run.mode,
        status: run.status,
        inputs: JSON.stringify(run.inputs),
        output: run.output === undefined ? null : JSON.stringify(run.output),
        error: run.error === undefined ? null : JSON.stringify(run.error),
        nodeInstances: run.nodeInstances === undefined ? null : JSON.stringify(run.nodeInstances),
        childRuns: run.childRuns === undefined ? null : JSON.stringify(run.childRuns),
        waiting: run.waiting === undefined ? null : JSON.stringify(run.waiting),
        createdAt: run.createdAt,
        startedAt: run.startedAt ?? null,
        finishedAt: run.finishedAt ?? null,
      });
      for (const node of Object.values(run.nodeRuns)) this.saveNode(run.id, node);
    })();
  }

  getRun(runId: string): WorkflowRunSnapshot | null {
    this.cleanupExpired();
    const run = this.storage.database.prepare("select * from workflow_runs where id = ?").get(runId) as RunRow | undefined;
    if (!run) return null;
    const nodes = this.storage.database.prepare("select * from workflow_node_runs where run_id = ? order by node_id").all(runId) as NodeRunRow[];
    return {
      id: run.id,
      workflowId: run.workflow_id,
      versionId: run.version_id ?? undefined,
      contentHash: run.content_hash ?? undefined,
      mode: run.mode,
      status: run.status,
      inputs: parseObject(run.input_json) ?? {},
      output: parseObject(run.output_json),
      error: parseObject(run.error_json) as WorkflowRunSnapshot["error"],
      nodeInstances: parseObject(run.node_instances_json) as WorkflowRunSnapshot["nodeInstances"],
      childRuns: parseObject(run.child_runs_json) as WorkflowRunSnapshot["childRuns"],
      waiting: parseObject(run.waiting_json) as WorkflowRunSnapshot["waiting"],
      createdAt: run.created_at,
      startedAt: run.started_at ?? undefined,
      finishedAt: run.finished_at ?? undefined,
      nodeRuns: Object.fromEntries(nodes.map((node) => [node.node_id, {
        nodeId: node.node_id,
        status: node.status,
        attempt: node.attempt,
        input: parseObject(node.input_json),
        output: parseObject(node.output_json),
        error: parseObject(node.error_json) as WorkflowNodeRunSnapshot["error"],
        startedAt: node.started_at ?? undefined,
        finishedAt: node.finished_at ?? undefined,
        durationMs: node.duration_ms ?? undefined,
      }])),
    };
  }

  saveEvent(event: WorkflowRuntimeEvent): boolean {
    this.cleanupExpired();
    return this.storage.database.transaction(() => {
      const inserted = this.storage.database.prepare(`
        insert or ignore into workflow_events(run_id, event_id, type, event_json, created_at)
        values (?, ?, ?, ?, ?)
      `).run(event.runId, event.id, event.type, JSON.stringify(event), event.at);
      if (inserted.changes === 0) return false;
      const current = this.getRun(event.runId);
      if (!current) return true;
      const newer = this.storage.database.prepare("select event_json from workflow_events where run_id = ? and event_id > ?")
        .all(event.runId, event.id) as Array<{ event_json: string }>;
      const later = newer.map((row) => JSON.parse(row.event_json) as WorkflowRuntimeEvent);
      const runState = (item: WorkflowRuntimeEvent) => item.type === "run.status" || item.type === "run.waiting";
      if (runState(event) && (later.some(runState) || ["succeeded", "failed", "cancelled"].includes(current.status))) return true;
      if (event.type === "run.output" && later.some((item) => item.type === "run.output")) return true;
      // Runtime 已返回终态时，历史节点状态只归档，不覆盖权威快照。
      if (event.type === "node.status" && ["succeeded", "failed", "cancelled"].includes(current.status)) return true;
      let projected = applyWorkflowRuntimeEventToSnapshot(current, event);
      if (event.type === "node.status" || event.type === "node.output") {
        const nodeEvent = event;
        const sameNode = later.filter((item) => (item.type === "node.status" || item.type === "node.output") && item.nodeId === nodeEvent.nodeId);
        const sameField = sameNode.filter((item) => item.type === nodeEvent.type);
        if (sameField.length > 0) projected = { ...projected, nodeRuns: current.nodeRuns };
        if (sameField.some((item) => (item.type === "node.status" || item.type === "node.output") && item.instanceId === nodeEvent.instanceId)) {
          projected = { ...projected, nodeInstances: current.nodeInstances, childRuns: current.childRuns };
        }
      }
      this.saveRun(projected);
      return true;
    })();
  }

  listEvents(runId: string, sinceId = 0): WorkflowRuntimeEvent[] {
    this.cleanupExpired();
    const rows = this.storage.database.prepare("select event_json from workflow_events where run_id = ? and event_id > ? order by event_id").all(runId, sinceId) as Array<{ event_json: string }>;
    return rows.map((row) => JSON.parse(row.event_json) as WorkflowRuntimeEvent);
  }

  /** 按终态 retention 删除 BFF 的 run-scoped 快照投影、节点和事件。 */
  cleanupExpired(now = this.now(), terminalRetentionMs = this.terminalRetentionMs): string[] {
    const rows = this.storage.database.prepare(`
      select id from workflow_runs
      where status in ('succeeded', 'failed', 'cancelled')
        and finished_at is not null
        and finished_at <= ?
      order by id
    `).all(now - terminalRetentionMs) as Array<{ id: string }>;
    if (rows.length === 0) return [];
    this.storage.database.transaction(() => {
      const remove = this.storage.database.prepare("delete from workflow_runs where id = ?");
      for (const row of rows) remove.run(row.id);
    })();
    return rows.map((row) => row.id);
  }

  private saveNode(runId: string, node: WorkflowNodeRunSnapshot): void {
    this.storage.database.prepare(`
      insert into workflow_node_runs(run_id, node_id, status, attempt, input_json, output_json, error_json, started_at, finished_at, duration_ms)
      values (@runId, @nodeId, @status, @attempt, @input, @output, @error, @startedAt, @finishedAt, @durationMs)
      on conflict(run_id, node_id) do update set
        status = excluded.status,
        attempt = excluded.attempt,
        input_json = excluded.input_json,
        output_json = excluded.output_json,
        error_json = excluded.error_json,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        duration_ms = excluded.duration_ms
    `).run({
      runId,
      nodeId: node.nodeId,
      status: node.status,
      attempt: node.attempt,
      input: node.input === undefined ? null : JSON.stringify(node.input),
      output: node.output === undefined ? null : JSON.stringify(node.output),
      error: node.error === undefined ? null : JSON.stringify(node.error),
      startedAt: node.startedAt ?? null,
      finishedAt: node.finishedAt ?? null,
      durationMs: node.durationMs ?? null,
    });
  }
}
