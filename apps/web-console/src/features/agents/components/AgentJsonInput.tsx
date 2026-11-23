import { useState } from "react";

/** 试跑只接受非空 JSON 对象，编辑器校验与执行入口共用同一规则。 */
export function parseAgentTestInput(input: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(input); }
  catch (cause) { throw new Error(`JSON 格式错误：${cause instanceof Error ? cause.message : String(cause)}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Object.keys(parsed).length)
    throw new Error("测试输入必须是非空 JSON 对象。");
  return parsed as Record<string, unknown>;
}

/** JSON 试跑输入：显式格式化、压缩和校验，失败时保留用户原文。 */
export function AgentJsonInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [notice, setNotice] = useState("");
  const [invalid, setInvalid] = useState(false);
  function process(action: "format" | "compact" | "validate") {
    try {
      const parsed = parseAgentTestInput(value);
      if (action !== "validate") onChange(JSON.stringify(parsed, null, action === "format" ? 2 : undefined));
      setInvalid(false);
      setNotice(action === "validate" ? "校验通过，可以试跑。" : action === "format" ? "已格式化。" : "已压缩。");
    } catch (cause) {
      setInvalid(true);
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <div className="field agent-json-input">
      <label htmlFor="agent-test-input">测试输入 · JSON</label>
      <div className="json-toolbar" role="group" aria-label="JSON 输入操作">
        <button type="button" data-action="format" onClick={() => process("format")}>格式化</button>
        <button type="button" data-action="compact" onClick={() => process("compact")}>压缩</button>
        <button type="button" data-action="validate" onClick={() => process("validate")}>校验</button>
        <button type="button" data-action="clear" onClick={() => { onChange(""); setNotice(""); setInvalid(false); }}>清空</button>
      </div>
      <textarea id="agent-test-input" className="input agent-code-input" rows={10} value={value} spellCheck={false}
        placeholder={'{\n  "task": "输入要交给 Agent 的任务"\n}'}
        aria-invalid={invalid} aria-describedby="agent-json-notice"
        onChange={(event) => { onChange(event.target.value); setNotice(""); setInvalid(false); }}
        onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); process("format"); } }} />
      <p id="agent-json-notice" className={invalid ? "agent-field-error" : "draft-sub"} role={invalid ? "alert" : "status"}>{notice || "输入非空 JSON 对象。⌘ / Ctrl + Shift + F 格式化。"}</p>
    </div>
  );
}
