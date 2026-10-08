import type { ReactNode } from 'react';

import type { MathTool } from '@/lib/worksheet-math-shapes.ts';

/** 数学作图图标直接复刻落笔后的形态，避免学生再猜抽象符号的含义。 */
const TOOL_ICONS: Record<MathTool, ReactNode> = {
  select: <><path d="m6 3.8 10.1 8.3-4.7 1.1-2.2 4.4L6 3.8Z" fill="currentColor" opacity=".12" /><path d="m13.8 14.5 3.1 4.2" /><path d="M17.5 4.3v2.2M16.4 5.4h2.2" opacity=".6" /></>,
  segment: <><path d="M5.2 18.2 18.8 5.8" /><circle cx="5.2" cy="18.2" r="1.15" fill="currentColor" stroke="none" /><circle cx="18.8" cy="5.8" r="1.15" fill="currentColor" stroke="none" /><path d="M7 16.55 17 7.45" opacity=".2" strokeWidth="3.2" /></>,
  arrow: <><path d="M4.5 18.5 19 6M13.7 5.8l5.3.2-.8 5.2" /><path d="M6.2 17 16.8 7.8" opacity=".2" strokeWidth="3.2" /></>,
  circle: <><circle cx="12" cy="12" r="7.8" fill="currentColor" opacity=".08" stroke="none" /><circle cx="12" cy="12" r="7.8" /><circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none" opacity=".55" /></>,
  triangle: <><path d="m12 4.2 8 15.1H4L12 4.2Z" fill="currentColor" opacity=".1" stroke="none" /><path d="m12 4.2 8 15.1H4L12 4.2Z" /></>,
  rectangle: <><rect x="3.8" y="6" width="16.4" height="12" rx=".8" fill="currentColor" opacity=".1" stroke="none" /><rect x="3.8" y="6" width="16.4" height="12" rx=".8" /></>,
  parallelogram: <><path d="M7.2 5.8h13l-3.4 12.4h-13L7.2 5.8Z" fill="currentColor" opacity=".1" stroke="none" /><path d="M7.2 5.8h13l-3.4 12.4h-13L7.2 5.8Z" /></>,
  trapezoid: <><path d="M7.2 5.8h9.6l3.4 12.4H3.8L7.2 5.8Z" fill="currentColor" opacity=".1" stroke="none" /><path d="M7.2 5.8h9.6l3.4 12.4H3.8L7.2 5.8Z" /></>,
  coordinateSystem: <><path d="M4 19V5m0 0-2 2m2-2 2 2M4 15h16m0 0-2-2m2 2-2 2" /><path d="M8 13v4M12 13v4M16 13v4M2 11h4M2 7h4" opacity=".72" /></>,
  numberLine: <><path d="M3 13h18m0 0-3-2.5m3 2.5-3 2.5" /><path d="M6 10.5v5M10 10.5v5M14 10.5v5M18 10.5v5" opacity=".78" /></>,
  free: <><path d="m5 16.8-.7 3 3-.7L18.9 7.5a1.7 1.7 0 0 0 0-2.4 1.7 1.7 0 0 0-2.4 0L5 16.8Z" fill="currentColor" opacity=".1" stroke="none" /><path d="m5 16.8-.7 3 3-.7L18.9 7.5a1.7 1.7 0 0 0 0-2.4 1.7 1.7 0 0 0-2.4 0L5 16.8ZM14.9 6.7l2.4 2.4M4.1 21h7.2" /></>,
  label: <><path d="M5 5h14M12 5v14M8.5 19h7" /><path d="M8.2 8.5h7.6" opacity=".25" strokeWidth="3.2" /></>,
};

export default function MathToolbarIcon({ tool, className }: { tool: MathTool; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TOOL_ICONS[tool]}
    </svg>
  );
}
