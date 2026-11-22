import type { SVGProps } from "react";

type BrandMarkProps = SVGProps<SVGSVGElement> & { size?: number };

/** Orbit 单色轨道标识：偏轴 O 形环与一颗轨道点，继承主题文字颜色。 */
export function BrandMark({ size = 20, ...props }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="Orbit"
      {...props}
    >
      <ellipse cx="12" cy="12" rx="7" ry="9" transform="rotate(35 12 12)" stroke="currentColor" strokeWidth="2" />
      <circle cx="18.5" cy="7" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}
