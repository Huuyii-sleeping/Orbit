import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { ModelConnectionSummary } from "../../../api/model-connections";
import { ModelConnectionForm } from "./ModelConnectionForm";

/** 原生模态框约束焦点与 Escape 关闭，添加连接时保留外层 Agent 草稿。 */
export function ModelConnectionDialog({
  onSaved,
  onClose,
  connection,
}: {
  connection?: ModelConnectionSummary;
  onSaved: (connection: ModelConnectionSummary) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="model-connection-dialog"
      aria-labelledby="model-dialog-title"
      onCancel={onClose}
    >
      <header className="model-dialog-heading">
        <div>
          <h2 id="model-dialog-title">{connection ? "编辑模型配置" : "添加模型配置"}</h2>
          <p>选择接口格式，填写模型与访问凭据。</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label="关闭模型配置"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <ModelConnectionForm connection={connection} onSaved={onSaved} onCancel={onClose} />
    </dialog>
  );
}
