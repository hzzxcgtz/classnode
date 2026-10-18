import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualReleaseSheets, releaseUnits, releasedUnitCount } from './worksheet-release-model.ts';
import { groupAnswerable } from '../../../lib/worksheet-questions.ts';
import type { ReleaseSheet } from './worksheet-release-model.ts';
import type { WorksheetQuestionNode } from '../../../lib/types.ts';

const question = (id: string): WorksheetQuestionNode => ({ id, type: 'short-answer', prompt: id, inputMode: 'keyboard', data: {}, children: [] });
const task = (id: string, children: WorksheetQuestionNode[]): WorksheetQuestionNode => ({ ...question(id), type: 'task', children });
const groups = groupAnswerable([task('t1', [question('a'), question('b')]), task('t2', [question('c')])]);

test('仅手动模式且包含可作答题目的学习单进入右侧面板', () => {
  const sheets = ['open', 'task-step', 'question-step', 'manual'].map(answerMode => ({
    id: answerMode, title: answerMode, nodes: [question('a')], settings: { answerMode } as ReleaseSheet['settings'],
  }));
  assert.deepEqual(manualReleaseSheets([...sheets, { ...sheets[3], id: 'empty', nodes: [] }]).map(sheet => sheet.id), ['manual']);
});

test('手动模式初始不开放，跳题开放只计该题，删除题目的残留不计数', () => {
  const units = releaseUnits(groups);
  assert.deepEqual(units.map(unit => unit.id), ['a', 'b', 'c']);
  assert.equal(releasedUnitCount(units, []), 0);
  assert.equal(releasedUnitCount(units, ['c']), 1);
  assert.equal(releasedUnitCount(units, ['deleted']), 0);
});
