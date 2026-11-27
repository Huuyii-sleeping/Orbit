import { createClient } from "@libsql/client";
import { TABLE_WORKFLOW_SNAPSHOT } from "@mastra/core/storage";
import { WORKFLOW_OUTPUT_LIMITS } from "@orbit/workflow-core";

/** 对固定版本 Mastra 的持久化 snapshot 设置数据库硬限制，覆盖整行写入与原子 merge。 */
export async function installWorkflowSnapshotBudget(databaseUrl: string): Promise<void> {
  const client = createClient({ url: databaseUrl, timeout: 10_000 });
  try {
    // 比较解码 JSON 的 UTF-8 大小，不能用 JSONB 的压缩后长度作为执行数据预算。
    for (const operation of ["insert", "update"]) {
      await client.execute(`create trigger if not exists orbit_workflow_snapshot_budget_${operation}
        before ${operation} on ${TABLE_WORKFLOW_SNAPSHOT}
        when length(cast(json(new.snapshot) as blob)) > ${WORKFLOW_OUTPUT_LIMITS.nativeSnapshotBytes}
        begin select raise(abort, 'ORBIT_WORKFLOW_SNAPSHOT_LIMIT'); end`);
    }
  } finally { client.close(); }
}
