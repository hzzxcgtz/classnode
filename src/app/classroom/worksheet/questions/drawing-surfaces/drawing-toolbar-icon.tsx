import type { ReactNode } from 'react';

/** 三种画板共用的手绘操作图标：清楚的主轮廓加一层克制的轻填色。 */
const ACTION_ICONS = {
  undo: <><path d="M5 8.5h8.1a5.4 5.4 0 0 1 0 10.8H10" /><path d="m8 5.5-3 3 3 3" /><path d="M12.4 12.3h2.4a2.2 2.2 0 0 1 0 4.4h-1.3" opacity=".28" /></>,
  redo: <><path d="M19 8.5h-8.1a5.4 5.4 0 0 0 0 10.8H14" /><path d="m16 5.5 3 3-3 3" /><path d="M11.6 12.3H9.2a2.2 2.2 0 0 0 0 4.4h1.3" opacity=".28" /></>,
  restore: <><path d="M7.2 3.8h7.1l3.5 3.5v4" /><path d="M14.3 3.8v3.6h3.5" /><path d="M6 12.5V5.8a2 2 0 0 1 2-2" opacity=".35" /><path d="M18.5 16.2a5.2 5.2 0 1 1-2.2-4.3" /><path d="m17.1 9.9-.8 2.2-2.3-.7" /></>,
  delete: <><path d="M7.2 8.2h9.6l-.7 11.1H7.9L7.2 8.2Z" fill="currentColor" opacity=".1" stroke="none" /><path d="M5.7 6.5h12.6M9.1 6.5l.6-2h4.6l.6 2M7.2 8.2l.7 11.1h8.2l.7-11.1M10 10.8v5.8M14 10.8v5.8" /></>,
  clear: <><path d="m5 15.3 7.8-9.7a1.8 1.8 0 0 1 2.6-.2l3.1 2.7a1.8 1.8 0 0 1 .2 2.6l-7.1 8.1H7.9L5 16.4a.8.8 0 0 1 0-1.1Z" fill="currentColor" opacity=".1" stroke="none" /><path d="m5 15.3 7.8-9.7a1.8 1.8 0 0 1 2.6-.2l3.1 2.7a1.8 1.8 0 0 1 .2 2.6l-7.1 8.1H7.9L5 16.4a.8.8 0 0 1 0-1.1ZM10.2 9l5.7 5" /><path d="M14.9 19h4.5M18.7 4.1v-1M20.8 5.6l.8-.6" opacity=".55" /></>,
  zoomIn: <><circle cx="10.5" cy="10.5" r="6.4" fill="currentColor" opacity=".08" stroke="none" /><circle cx="10.5" cy="10.5" r="6.4" /><path d="M15.1 15.1 20 20M7.8 10.5h5.4M10.5 7.8v5.4" /></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="6.4" fill="currentColor" opacity=".08" stroke="none" /><circle cx="10.5" cy="10.5" r="6.4" /><path d="M15.1 15.1 20 20M7.8 10.5h5.4" /></>,
  fit: <><rect x="8" y="8" width="8" height="8" rx="1.8" fill="currentColor" opacity=".12" stroke="none" /><path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /><rect x="8" y="8" width="8" height="8" rx="1.8" opacity=".65" /></>,
  tidy: <><rect x="9" y="3.5" width="6" height="4" rx="1.2" fill="currentColor" opacity=".14" stroke="none" /><rect x="3.5" y="16.5" width="5.5" height="4" rx="1.2" fill="currentColor" opacity=".1" stroke="none" /><rect x="15" y="16.5" width="5.5" height="4" rx="1.2" fill="currentColor" opacity=".1" stroke="none" /><rect x="9" y="3.5" width="6" height="4" rx="1.2" /><rect x="3.5" y="16.5" width="5.5" height="4" rx="1.2" /><rect x="15" y="16.5" width="5.5" height="4" rx="1.2" /><path d="M12 7.5v4.2M6.25 16.5v-2.2c0-1.4 1.1-2.6 2.6-2.6h6.3c1.5 0 2.6 1.2 2.6 2.6v2.2" /></>,
  close: <><circle cx="12" cy="12" r="8" fill="currentColor" opacity=".1" stroke="none" /><path d="m8.5 8.5 7 7M15.5 8.5l-7 7" /></>,
  fullscreen: <><path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /><rect x="8" y="8" width="8" height="8" rx="2" fill="currentColor" opacity=".1" stroke="none" /></>,
  fullscreenExit: <><path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M20 15h-4a1 1 0 0 0-1 1v4M4 15h4a1 1 0 0 1 1 1v4" /><rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".1" stroke="none" /></>,
} satisfies Record<string, ReactNode>;

export type DrawingActionIconName = keyof typeof ACTION_ICONS;

export default function DrawingToolbarIcon({
  name,
  className,
}: {
  name: DrawingActionIconName;
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ACTION_ICONS[name]}
    </svg>
  );
}
