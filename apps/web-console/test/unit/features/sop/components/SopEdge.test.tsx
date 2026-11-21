import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Position } from "@xyflow/react";
import { SopEdge } from "../../../../../src/features/sop/components/SopEdge";

describe("SopEdge", () => {
  it("把箭头绑定在实际 SVG 路径上，不用 React Flow 的另一套端点坐标定位", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <SopEdge
          id="arrow-test"
          source="s"
          target="t"
          sourceX={0}
          sourceY={0}
          targetX={190}
          targetY={80}
          sourcePosition={Position.Right}
          targetPosition={Position.Left}
          data={{
            status: "valid",
            route: {
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
              ],
              length: 100,
              blocked: false,
            },
          }}
        />
      </svg>,
    );
    expect(markup).toContain('marker-end="url(#');
    expect(markup).toMatch(
      /<marker[^>]*>[\s\S]*?<path[^>]*d="M 1,1 L 7,4 L 1,7 Z"[^>]*fill="var\(--text-muted\)"[^>]*stroke="none"/,
    );
    expect(markup).toContain("L 100,0");
    expect(markup).not.toContain("translate(190,80)");
  });
});
