import type { ReactNode } from 'react';

export type FlowToolbarIconName = 'terminator' | 'process' | 'decision' | 'io' | 'junction';

/** 流程节点图标与画布中的标准形状一一对应。 */
const FLOW_ICONS: Record<FlowToolbarIconName, ReactNode> = {
  terminator: <><rect x="3.5" y="7" width="17" height="10" rx="5" fill="currentColor" opacity=".1" stroke="none" /><rect x="3.5" y="7" width="17" height="10" rx="5" /><path d="M8 12h8" opacity=".35" /></>,
  process: <><rect x="3.5" y="6" width="17" height="12" rx="1.8" fill="currentColor" opacity=".1" stroke="none" /><rect x="3.5" y="6" width="17" height="12" rx="1.8" /><path d="M7.5 10h9M7.5 14h6" opacity=".3" /></>,
  decision: <><path d="m12 3.8 8.7 8.2-8.7 8.2L3.3 12 12 3.8Z" fill="currentColor" opacity=".1" stroke="none" /><path d="m12 3.8 8.7 8.2-8.7 8.2L3.3 12 12 3.8Z" /><path d="M9 12h6" opacity=".3" /></>,
  io: <><path d="M7 5.8h14l-4 12.4H3L7 5.8Z" fill="currentColor" opacity=".1" stroke="none" /><path d="M7 5.8h14l-4 12.4H3L7 5.8Z" /><path d="M8 10h8M7 14h6" opacity=".3" /></>,
  junction: <><circle cx="12" cy="12" r="6" fill="currentColor" opacity=".14" stroke="none" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
};

export default function FlowToolbarIcon({ name, className }: { name: FlowToolbarIconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {FLOW_ICONS[name]}
    </svg>
  );
}
