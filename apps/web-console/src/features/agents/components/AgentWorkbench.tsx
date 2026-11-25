import { AgentJsonInput, parseAgentTestInput } from "./AgentJsonInput";
import { AgentJsonResult } from "./AgentJsonResult";
import { useState } from "react";
import type { WorkflowRunSnapshot } from "@orbit/workflow-core";
import { useAgentWorkbench } from "../hooks/use-agent-workbench";
import { agentRunErrorMessage } from "../lib/agent-run-error";

const STATUS_LABELS = {
  queued: "排队中",
  running: "运行中",
  waiting: "等待中",
  succeeded: "通过",
  failed: "失败",
  cancelled: "已取消",
};

/** Agent 的独立测试与版本区，始终展示本次运行固定的配置身份。 */
export function AgentWorkbench({
  agentId,
  view,
  dirty,
  disabled,
  onTestStatus,
}: {
  agentId: string;
  view: "test" | "versions";
  dirty: boolean;
  disabled: boolean;
  onTestStatus: (status: WorkflowRunSnapshot["status"]) => void;
}) {
  const workbench = useAgentWorkbench(agentId, onTestStatus);
  const [input, setInput] = useState("");
  const [versionId, setVersionId] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const { current } = workbench;
  const error = current?.run.error ?? current?.run.nodeRuns.agent?.error;
  const duration =
    current?.run.nodeRuns.agent?.durationMs ??
    (current?.run.finishedAt && current.run.startedAt
      ? current.run.finishedAt - current.run.startedAt
      : undefined);
  const nodeOutput = current?.run.nodeRuns.agent?.output;
  const output =
    nodeOutput?.result ?? current?.run.output?.result ?? current?.run.output;
  const blocked =
    disabled || workbench.busy || workbench.publishing || workbench.loading;

  function runTest() {
    try {
      const parsed = parseAgentTestInput(input);
      void workbench.test(
        parsed,
        versionId || undefined,
      );
    } catch (cause) {
      workbench.setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }

  return (
    <section className="agent-workbench" aria-label="Agent 试跑与版本">
      {workbench.loading ? <p role="status">加载版本与测试记录…</p> : null}
      {workbench.error ? (
        <p className="agent-field-error" role="alert">
          {workbench.error}
        </p>
      ) : null}
      <div
        role="tabpanel"
        id="agent-panel-test"
        aria-labelledby="agent-tab-test"
        hidden={view !== "test"}
      >
        <header className="agent-workspace-heading">
          <h2>独立试跑</h2>
          <p>使用已保存的配置执行任务，检查结果与能力调用。</p>
        </header>
        <div className="agent-test-layout">
          <div className="agent-test-inputs">
            <div className="field">
              <label htmlFor="agent-test-version">测试配置</label>
              <select
                id="agent-test-version"
                className="input"
                value={versionId}
                onChange={(event) => setVersionId(event.target.value)}
                disabled={workbench.running}
              >
                <option value="">已保存草稿</option>
                {workbench.versions.map((version) => (
                  <option value={version.id} key={version.id}>
                    v{version.version} · {version.name}
                  </option>
                ))}
              </select>
              {dirty && !versionId ? (
                <p className="draft-sub">配置已修改，请先保存再测试。</p>
              ) : (
                <p className="draft-sub">
                  每次试跑使用独立上下文，结果按输出格式校验。
                </p>
              )}
            </div>
            <AgentJsonInput value={input} onChange={setInput} />
            <div className="ag-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={blocked || workbench.running || (!versionId && dirty)}
                onClick={runTest}
              >
                {workbench.running ? "正在试跑…" : "开始试跑"}
              </button>
              {workbench.running ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={workbench.busy}
                  onClick={() => void workbench.cancel()}
                >
                  取消运行
                </button>
              ) : null}
            </div>
            {workbench.history.length ? (
              <div className="field">
                <label htmlFor="agent-test-history">最近测试</label>
                <select
                  id="agent-test-history"
                  className="input"
                  value={current?.run.id ?? ""}
                  disabled={workbench.running}
                  onChange={(event) => {
                    const item = workbench.history.find(
                      (test) => test.run.id === event.target.value,
                    );
                    if (item) workbench.selectTest(item);
                  }}
                >
                  {!workbench.history.some(
                    (test) => test.run.id === current?.run.id,
                  ) ? (
                    <option value={current?.run.id ?? ""}>当前试跑</option>
                  ) : null}
                  {workbench.history.map((test) => (
                    <option key={test.run.id} value={test.run.id}>
                      {new Date(test.run.createdAt).toLocaleString("zh-CN")} ·{" "}
                      {test.configuration.label} ·{" "}
                      {STATUS_LABELS[test.run.status]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <div className="agent-test-result" aria-live="polite">
            {current ? (
              <>
                <div className="agent-run-heading">
                  <b>{STATUS_LABELS[current.run.status]}</b>
                  {duration !== undefined ? (
                    <span>{(duration / 1000).toFixed(2)} 秒</span>
                  ) : null}
                </div>
                <p className="draft-sub">
                  {current.configuration.label} ·{" "}
                  {current.configuration.modelId || "系统模型策略"} ·{" "}
                  {current.configuration.contentHash.slice(0, 10)}
                </p>
                <details>
                  <summary>本次配置与输入</summary>
                  <pre>
                    {JSON.stringify(
                      {
                        ...current.configuration,
                        inputs: current.run.inputs.testInputs,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                {error ? (
                  <div className="agent-field-error" role="alert">
                    <p>{agentRunErrorMessage(error.message)}</p>
                    <details>
                      <summary>原始错误详情</summary>
                      <pre>{JSON.stringify(error, null, 2)}</pre>
                    </details>
                  </div>
                ) : null}
                {output !== undefined ? (
                  <AgentJsonResult key={current.run.id} value={output} />
                ) : (
                  <pre className="agent-output">
                    {workbench.text ||
                      (workbench.running ? "等待 Agent 输出…" : "暂无输出")}
                  </pre>
                )}
                {workbench.logs.length ? (
                  <details open>
                    <summary>工具调用与运行日志</summary>
                    <pre>{workbench.logs.join("\n")}</pre>
                  </details>
                ) : null}
              </>
            ) : (
              <div className="agent-test-empty">
                <b>给 Agent 一个真实任务</b>
                <p>
                  检查职责是否生效、工具是否按授权执行，以及结果是否符合预期。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      <div
        role="tabpanel"
        id="agent-panel-versions"
        aria-labelledby="agent-tab-versions"
        hidden={view !== "versions"}
      >
        <header className="agent-workspace-heading">
          <h2>发布版本</h2>
          <p>将已保存的配置固定为版本，供工作流引用。</p>
        </header>
        <div className="agent-version-panel agent-config-card">
          <div className="field">
            <label htmlFor="agent-release-notes">发布说明</label>
            <input
              id="agent-release-notes"
              className="input"
              maxLength={500}
              value={releaseNotes}
              onChange={(event) => setReleaseNotes(event.target.value)}
              placeholder="这次版本调整了什么"
            />
          </div>
          <div className="ag-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={blocked || dirty}
              onClick={() => void workbench.publish(releaseNotes)}
            >
              {workbench.publishing ? "发布中…" : "发布已保存配置"}
            </button>
          </div>
          <p className="draft-sub">
            {dirty
              ? "请先保存修改，再发布版本。"
              : "发布版本可在 SOP 的 Agent 节点中选择；后续修改草稿不会改变该版本。"}
          </p>
          {!workbench.versions.length ? (
            <p>尚未发布版本。建议先完成独立试跑。</p>
          ) : (
            workbench.versions.map((version) => (
              <details className="agent-version" key={version.id}>
                <summary>
                  <b>v{version.version}</b> ·{" "}
                  {new Date(version.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {version.releaseNotes || "无发布说明"}
                </summary>
                <pre>
                  {JSON.stringify(
                    {
                      instructions: version.instructions,
                      modelId: version.modelId || "系统模型策略",
                      toolPolicy: version.toolPolicy,
                      skillPolicy: version.skillPolicy,
                      outputSchema: version.outputSchema,
                      contentHash: version.contentHash,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
