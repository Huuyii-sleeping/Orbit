import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SopCanvasShell } from "../editor/components/SopCanvasShell";
import type { SopCanvasProps } from "../editor/sop-editor-types";

/** SOP 编排画布薄入口。 */
export function SopCanvas(props: SopCanvasProps) {
  return <ReactFlowProvider><SopCanvasShell {...props} /></ReactFlowProvider>;
}
