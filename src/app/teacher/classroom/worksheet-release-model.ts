import type { WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
import { groupAnswerable, type AnswerableGroup } from '../../../lib/worksheet-questions.ts';
import { normalizeAnswerMode } from '../../../lib/worksheet-answer-mode.ts';

export interface ReleaseSheet {
  id: string;
  title: string;
  nodes: WorksheetQuestionNode[];
  settings?: WorksheetSettings;
}

export function manualReleaseSheets(worksheets: readonly ReleaseSheet[]) {
  return worksheets.filter(sheet => normalizeAnswerMode(sheet.settings?.answerMode) === 'manual'
    && groupAnswerable(sheet.nodes).some(group => group.items.length > 0));
}

/** 手动开放按题目原有顺序列出，允许单独开放任意一题。 */
export function releaseUnits(groups: AnswerableGroup[]) {
  return groups.flatMap(group => group.items.map(item => ({
    id: item.node.id, title: `第 ${item.label} 题`, items: [item],
  })));
}

export function releasedUnitCount(units: ReturnType<typeof releaseUnits>, openIds: readonly string[]) {
  return units.filter(unit => openIds.includes(unit.id)).length;
}
