import { useState } from "react";

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    return <details className="json-branch" open={depth < 3}>
      <summary>{Array.isArray(value) ? `数组 · ${entries.length} 项` : `对象 · ${entries.length} 个字段`}</summary>
      <dl>{entries.map(([key, item]) => <div className="json-entry" key={key}><dt>{key}</dt><dd><JsonValue value={item} depth={depth + 1} /></dd></div>)}</dl>
    </details>;
  }
  return typeof value === "string"
    ? <pre className="json-string">{value || '""'}</pre>
    : <code className="json-scalar">{value === null ? "null" : String(value)}</code>;
}

/** 安全展示模型结果，文本正常换行，复杂结构可折叠，并保留原始 JSON。 */
export function AgentJsonResult({ value }: { value: unknown }) {
  const [notice, setNotice] = useState("");
  let parsed = value;
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) {
    // 仅尝试展开完整 JSON 容器；模型的普通文本始终原样展示。
    try { parsed = JSON.parse(value); } catch { /* 非 JSON 文本保留原文。 */ }
  }
  const raw = JSON.stringify(value, null, 2) ?? String(value);
  async function copy() {
    try { await navigator.clipboard.writeText(raw); setNotice("已复制 JSON。"); }
    catch { setNotice("复制失败，请展开原始 JSON 手动复制。"); }
  }
  return <section className="agent-json-result" aria-label="结构化测试结果">
    <div className="json-result-heading"><strong>输出结果</strong><button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()}>复制 JSON</button></div>
    <JsonValue value={parsed} />
    {notice ? <p role="status" className="draft-sub">{notice}</p> : null}
    <details><summary>原始 JSON</summary><pre>{raw}</pre></details>
  </section>;
}
