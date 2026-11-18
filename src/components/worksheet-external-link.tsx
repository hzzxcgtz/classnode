'use client';

import type { ComponentPropsWithoutRef, MouseEvent } from 'react';

/** Open synchronously within the user gesture, including mobile browser taps. */
export function WorksheetExternalLink({ children, ...props }: ComponentPropsWithoutRef<'a'>) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // Keep native target=_blank as a fallback if popups are blocked.
    const tab = window.open('about:blank', '_blank');
    if (!tab) return;
    try {
      tab.opener = null;
      tab.location.replace(event.currentTarget.href);
      event.preventDefault();
    } catch {
      tab.close();
    }
  };
  return <a {...props} target="_blank" rel="noopener noreferrer" onClick={open}>{children}</a>;
}
