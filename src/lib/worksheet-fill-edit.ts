import type { WorksheetQuestionNode } from './types';
import { blankSlots, fillSettingsFor, writeFillSettings } from './worksheet-fill-modes.ts';
import { blankRuns, isPlainRuns, type PromptRun } from './worksheet-prompt-marks.ts';
import { TABLE_MARK_TEXT } from './worksheet-table.ts';

/** 展示用横线仍由稳定 ID 标识；读写保持旧题面协议，答案按完整阅读顺序映射。 */
export function fillPromptPatch(node: WorksheetQuestionNode, previous: PromptRun[], text: string, runs: PromptRun[], answers: string[][], inserted?: { id: string; answer: string }, table: unknown = node.data.table): Record<string, unknown> {
  const before = blankSlots(node, previous);
  const removesTable = node.prompt.includes(TABLE_MARK_TEXT) && !text.includes(TABLE_MARK_TEXT);
  const afterNode = { ...node, prompt: text, data: { ...node.data, promptRuns: runs, table: removesTable ? undefined : table } };
  const after = blankSlots(afterNode, runs);
  const byId = new Map(before.map((slot, index) => [slot.id, answers[index] ?? []]));
  if (inserted) byId.set(inserted.id, inserted.answer.trim() ? [inserted.answer.trim()] : []);
  const settings = fillSettingsFor(node, previous);
  const settingsById = new Map(before.map((slot, index) => [slot.id, settings[index]]));
  return {
    ...(removesTable ? { table: undefined } : {}),
    promptRuns: isPlainRuns(runs) ? undefined : runs,
    answers: after.map(slot => byId.get(slot.id) ?? []),
    blanks: undefined,
    fillBlankSettings: writeFillSettings(afterNode, runs, after.map(slot => settingsById.get(slot.id) ?? { mode: node.type === 'choice-blank' ? 'pool' : 'text', choices: [] })),
  };
}

/** 退格 / Delete 命中横线时整块删除，保留普通文字和换行的原生行为。 */
export function atomicPromptDeletion(text: string, runs: PromptRun[], from: number, to: number, direction: 'backward' | 'forward'): { from: number; to: number } | null {
  const atoms = blankRuns(runs).map(run => ({ from: run.start, to: run.end }));
  const table = text.indexOf(TABLE_MARK_TEXT);
  if (table >= 0) atoms.push({ from: table, to: table + TABLE_MARK_TEXT.length });
  const hits = atoms.filter(atom => from < to ? atom.from < to && atom.to > from : direction === 'backward' ? atom.from < from && atom.to >= from : atom.from <= from && atom.to > from);
  return hits.length ? { from: Math.min(from, ...hits.map(atom => atom.from)), to: Math.max(to, ...hits.map(atom => atom.to)) } : null;
}

/** 移动整个填空分段，不重新识别标记；文字样式与 blank ID 均保留。 */
export function movePromptBlank(text: string, runs: PromptRun[], id: string, target: number): { text: string; runs: PromptRun[]; from: number } {
  const blank = blankRuns(runs).find(run => run.blank === id);
  if (!blank || !Number.isFinite(target)) return { text, runs, from: blank?.start ?? 0 };
  let at = Math.min(text.length, Math.max(0, Math.trunc(target)));
  const atoms = blankRuns(runs).map(run => ({ start: run.start, end: run.end }));
  const table = text.indexOf(TABLE_MARK_TEXT);
  if (table >= 0) atoms.push({ start: table, end: table + TABLE_MARK_TEXT.length });
  for (const atom of atoms) if (at > atom.start && at < atom.end) at = at - atom.start < atom.end - at ? atom.start : atom.end;
  if (at >= blank.start && at <= blank.end) return { text, runs, from: blank.start };
  const pieces = at < blank.start
    ? [[0, at], [blank.start, blank.end], [at, blank.start], [blank.end, text.length]]
    : [[0, blank.start], [blank.end, at], [blank.start, blank.end], [at, text.length]];
  let offset = 0; const moved: PromptRun[] = [];
  for (const [from, to] of pieces) {
    for (const run of runs) {
      const start = Math.max(from, run.start); const end = Math.min(to, run.end);
      if (end > start) moved.push({ ...run, start: offset + start - from, end: offset + end - from });
    }
    offset += to - from;
  }
  return { text: pieces.map(([from, to]) => text.slice(from, to)).join(''), runs: moved, from: at < blank.start ? at : at - (blank.end - blank.start) };
}

export function blankStepTarget(text: string, runs: PromptRun[], id: string, direction: -1 | 1): number {
  const blank = blankRuns(runs).find(run => run.blank === id);
  if (!blank) return 0;
  const neighbors = blankRuns(runs).map(run => ({ start: run.start, end: run.end }));
  const table = text.indexOf(TABLE_MARK_TEXT);
  if (table >= 0) neighbors.push({ start: table, end: table + TABLE_MARK_TEXT.length });
  const neighbor = neighbors.find(run => direction < 0 ? run.end === blank.start : run.start === blank.end);
  if (neighbor) return direction < 0 ? neighbor.start : neighbor.end;
  return direction < 0 ? Math.max(0, blank.start - (Array.from(text.slice(0, blank.start)).pop()?.length ?? 0))
    : Math.min(text.length, blank.end + (Array.from(text.slice(blank.end))[0]?.length ?? 0));
}

/** 单次左右移动跨过整个对象，零宽光标落点不参与计步，避免在横线边缘停顿。 */
export function promptCaretStep(text: string, runs: PromptRun[], from: number, direction: -1 | 1): number {
  const at = Math.max(0, Math.min(text.length, Number.isFinite(from) ? Math.trunc(from) : 0));
  const atoms = blankRuns(runs).map(run => ({start:run.start,end:run.end}));
  const table = text.indexOf(TABLE_MARK_TEXT);
  if (table >= 0) atoms.push({start:table,end:table+TABLE_MARK_TEXT.length});
  const atom = atoms.find(item => direction > 0 ? at >= item.start && at < item.end : at > item.start && at <= item.end);
  if (atom) return direction > 0 ? atom.end : atom.start;
  const length = direction > 0 ? Array.from(text.slice(at))[0]?.length ?? 0 : Array.from(text.slice(0,at)).pop()?.length ?? 0;
  return direction > 0 ? Math.min(text.length,at+length) : Math.max(0,at-length);
}
