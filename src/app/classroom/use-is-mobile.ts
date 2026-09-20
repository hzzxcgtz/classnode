import { useSyncExternalStore } from 'react';

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const media = window.matchMedia('(max-width: 640px)');
      // iPadOS 15 and older WebKit builds still expose the legacy listener API
      // in some embedded/browser configurations.
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onStoreChange);
        return () => media.removeEventListener('change', onStoreChange);
      }
      media.addListener(onStoreChange);
      return () => media.removeListener(onStoreChange);
    },
    () => window.matchMedia('(max-width: 640px)').matches,
    () => false,
  );
}
