import type { ReactNode } from 'react';
import styles from './teacher-pending-text.module.css';

/** Shared, text-only halo for teacher operations that are still running. */
export function TeacherPendingText({ children, active = true }: { children: ReactNode; active?: boolean }) {
  return <span className={active ? styles.halo : undefined}>{children}</span>;
}
