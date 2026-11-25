import { useEffect, useRef, useState } from "react";
import {
  applyWorkflowRuntimeEventToSnapshot,
  isTerminalWorkflowRunStatus,
  type WorkflowRunSnapshot,
} from "@orbit/workflow-core";
import {
  cancelWorkflowRun,
  createWorkflowRunEventStream,
  fetchAgentTests,
  fetchAgentVersions,
  fetchWorkflowRun,
  publishAgentVersion,
  startAgentTest,
  type AgentTestRun,
  type AgentVersionCatalogItem,
} from "../../../api/index";

/** 管理固定配置试跑、运行观察和发布目录；不创建第二套执行器。 */
export function useAgentWorkbench(
  agentId: string,
  onTestStatus: (status: WorkflowRunSnapshot["status"]) => void,
) {
  const [versions, setVersions] = useState<AgentVersionCatalogItem[]>([]);
  const [history, setHistory] = useState<AgentTestRun[]>([]);
  const [current, setCurrent] = useState<AgentTestRun | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const latestRunId = useRef<string>();
  const terminalRun = useRef<WorkflowRunSnapshot>();
  const statusCallback = useRef(onTestStatus);
  statusCallback.current = onTestStatus;

  useEffect(() => {
    let disposed = false;
    void Promise.allSettled([
      fetchAgentVersions(agentId),
      fetchAgentTests(agentId),
    ]).then(([versionResult, historyResult]) => {
      if (disposed) return;
      if (versionResult.status === "fulfilled")
        setVersions(versionResult.value);
      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value);
        const latest = historyResult.value[0];
        if (latest) {
          latestRunId.current = latest.run.id;
          setCurrent(latest);
          statusCallback.current(latest.run.status);
        }
      }
      const failed = [versionResult, historyResult].find(
        (result) => result.status === "rejected",
      );
      if (failed?.status === "rejected")
        setError(
          failed.reason instanceof Error
            ? failed.reason.message
            : String(failed.reason),
        );
      setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [agentId]);

  const runId = current?.run.id;
  useEffect(() => {
    if (!runId) return;
    let disposed = false;
    let fetching = false;
    async function refresh() {
      if (fetching || disposed) return;
      fetching = true;
      try {
        const run = await fetchWorkflowRun(runId!);
        if (!disposed) {
          // 取消响应先返回时，丢弃取消前发出的旧查询与后续旧状态事件。
          const final = terminalRun.current;
          if (final?.id === run.id && !isTerminalWorkflowRunStatus(run.status)) return;
          if (isTerminalWorkflowRunStatus(run.status)) terminalRun.current = run;
          setCurrent((item) =>
            item?.run.id === run.id ? { ...item, run } : item,
          );
          if (latestRunId.current === run.id)
            statusCallback.current(run.status);
          if (isTerminalWorkflowRunStatus(run.status)) {
            stream.close();
            clearInterval(timer);
          }
        }
      } catch (cause) {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        fetching = false;
      }
    }
    const stream = createWorkflowRunEventStream({
      runId,
      onEvent: (event) => {
        if (disposed) return;
        if (terminalRun.current?.id === event.runId && (event.type === "run.status" || event.type === "run.waiting")) return;
        setCurrent((item) =>
          item?.run.id === event.runId
            ? {
                ...item,
                run: applyWorkflowRuntimeEventToSnapshot(item.run, event),
              }
            : item,
        );
        if (event.type === "node.log")
          setLogs((items) => [...items.slice(-199), event.message]);
        if (event.type === "node.output" && event.delta)
          setText((previous) => previous + event.delta);
        if (event.type === "run.status" && latestRunId.current === event.runId && terminalRun.current?.id !== event.runId)
          statusCallback.current(event.status);
      },
      onTerminal: () => {
        void refresh();
      },
    });
    const timer = setInterval(() => {
      void refresh();
    }, 1500);
    void refresh();
    return () => {
      disposed = true;
      clearInterval(timer);
      stream.close();
    };
  }, [runId]);

  useEffect(() => {
    if (current && isTerminalWorkflowRunStatus(current.run.status))
      setHistory((items) =>
        [current, ...items.filter((item) => item.run.id !== current.run.id)]
          .sort((left, right) => right.run.createdAt - left.run.createdAt)
          .slice(0, 10),
      );
  }, [current]);

  async function test(inputs: Record<string, unknown>, versionId?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await startAgentTest(agentId, inputs, versionId);
      setLogs([]);
      setText("");
      latestRunId.current = result.run.id;
      setCurrent(result);
      statusCallback.current(result.run.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!current) return;
    setBusy(true);
    try {
      const run = await cancelWorkflowRun(current.run.id);
      if (isTerminalWorkflowRunStatus(run.status)) terminalRun.current = run;
      setCurrent({ ...current, run });
      statusCallback.current(run.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function publish(releaseNotes: string) {
    setPublishing(true);
    setError("");
    try {
      const version = await publishAgentVersion(agentId, { releaseNotes });
      setVersions((items) => [version, ...items]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPublishing(false);
    }
  }

  function selectTest(item: AgentTestRun) {
    setLogs([]);
    setText("");
    setCurrent(item);
  }
  const running = Boolean(
    current && !isTerminalWorkflowRunStatus(current.run.status),
  );
  return {
    versions,
    history,
    current,
    logs,
    text,
    error,
    setError,
    loading,
    busy,
    publishing,
    running,
    test,
    cancel,
    publish,
    selectTest,
  };
}
