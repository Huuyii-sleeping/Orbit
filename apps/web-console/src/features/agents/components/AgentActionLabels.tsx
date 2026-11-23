import { useState } from "react";
import { Plus, X } from "lucide-react";

/** 独立编辑展示标签；标签不授权工具，也不创建可执行流程。 */
export function AgentActionLabels({
  value,
  onChange,
}: {
  value: string[];
  onChange: (labels: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  function add() {
    const label = text.trim();
    if (!label) return;
    if (value.includes(label)) {
      setError("这个标签已存在。");
      return;
    }
    if (value.length >= 24) {
      setError("最多添加 24 个标签。");
      return;
    }
    onChange([...value, label]);
    setText("");
    setError("");
  }
  return (
    <details className="ag-section agent-labels">
      <summary>操作标签 · {value.length}</summary>
      <p className="draft-sub">
        用于描述 Agent 的常见任务，仅作展示，不执行工具或流程。
      </p>
      <ul className="agent-label-list" aria-label="操作标签">
        {value.map((label, index) => (
          <li key={`${index}-${label}`}>
            <span>{label}</span>
            <button
              type="button"
              aria-label={`移除标签 ${label}`}
              onClick={() => {
                onChange(value.filter((_, i) => i !== index));
                setError("");
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div className="agent-label-entry">
        <input
          className="input"
          aria-label="新操作标签"
          maxLength={80}
          value={text}
          placeholder="输入标签，按回车添加"
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={!text.trim() || value.length >= 24}
          onClick={add}
        >
          <Plus aria-hidden="true" />
          添加
        </button>
      </div>
      {error ? (
        <p role="alert" className="agent-field-error">
          {error}
        </p>
      ) : null}
    </details>
  );
}
