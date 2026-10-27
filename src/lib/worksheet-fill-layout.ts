import type { WorksheetQuestionNode } from './types';
import { blankRuns, readPromptRuns, removePromptRange, type PromptRun } from './worksheet-prompt-marks.ts';
import { readTableFor, TABLE_MARK_TEXT } from './worksheet-table.ts';


export type FillLayout = 'text' | 'table';
/** 旧混合题保留原顺序；纯表格旧题可直接使用独立表格编辑器。 */
export function fillEditorKind(node: WorksheetQuestionNode): FillLayout | 'mixed' {
  const table = Boolean(readTableFor(node)) || node.prompt.includes(TABLE_MARK_TEXT);
  const text = blankRuns(readPromptRuns(node.data.promptRuns, node.prompt)).length > 0;
  return table ? (text ? 'mixed' : 'table') : node.data.fillLayout === 'table' && !text ? 'table' : 'text';
}

/** 表格题的描述只投影文字；保存时将历史表格标记放回末尾，评分协议不变。 */
export function tableDescription(node: WorksheetQuestionNode): { text: string; runs: PromptRun[] } {
  const at = node.prompt.indexOf(TABLE_MARK_TEXT);
  return at < 0 ? { text: node.prompt, runs: readPromptRuns(node.data.promptRuns, node.prompt) }
    : removePromptRange(readPromptRuns(node.data.promptRuns, node.prompt), node.prompt, at, at + TABLE_MARK_TEXT.length);
}
export function withTableDescription(text: string, runs: PromptRun[]): { text: string; runs: PromptRun[] } {
  return { text: text + TABLE_MARK_TEXT, runs: [...runs, { ...readPromptRuns(undefined, TABLE_MARK_TEXT)[0], start: text.length, end: text.length + TABLE_MARK_TEXT.length }] };
}
