import type { WorkflowDraft } from "@orbit/workflow-core";
import type { ThemeMode } from "../../../theme";

/** 编辑器显示真实保存状态，不用本地修改次数代替保存结果。 */
export type SopSaveState = "idle" | "saving" | "saved" | "error" | "conflict";

/** 正式工作流画布与宿主工作台的契约。 */
export interface SopCanvasProps {
  initial: WorkflowDraft;
  legacyBackup: string | null;
  theme: ThemeMode;
  onThemeToggle: () => void;
  saveState: SopSaveState;
  saveMessage: string;
  onSave: (draft: WorkflowDraft) => void | Promise<void>;
  onAutoSave?: (draft: WorkflowDraft) => void | Promise<void>;
  onRecoveryChange?: (draft: WorkflowDraft) => void;
  onBack: () => void;
  onOpenLifecycle: () => void;
}
