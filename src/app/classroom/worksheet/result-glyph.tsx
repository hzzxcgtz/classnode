'use client';

import type { WorksheetGradeState } from '@/lib/types';
import { WorksheetStatusIcon } from '@/components/worksheet-status-icon';

/** 学生端判分结果的兼容入口；实际图形统一由全系统状态图标组件提供。 */
export function ResultGlyph({ state }: { state: WorksheetGradeState }) {
  const icon = state === 'correct' ? 'correct' : state === 'partial' ? 'partial' : 'retry';
  return <WorksheetStatusIcon name={icon} size={18} />;
}
