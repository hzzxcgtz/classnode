import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClassroomHistoryItem } from '@/lib/types';
import { emptyHistoryFilters, filterHistory } from './history-records.ts';

function record(id: string, overrides: Partial<ClassroomHistoryItem> = {}): ClassroomHistoryItem {
  return { id, title: '活动小调查', classes: [{ classId: 'c1', class: { id: 'c1', name: '301班' } }], createdAt: '2026-10-18T09:00:00', endedAt: '2026-10-20T23:59:59', worksheetTotal: 1, worksheetSubmitted: 0, webappUsageCount: 0, totalRounds: 0, totalChars: 0, ...overrides } as ClassroomHistoryItem;
}
test('history search combines words, exact class selection and saved module records', () => {
  const records = [record('a'), record('b', { classes: [{ classId: 'c2', class: { id: 'c2', name: '301班' } }], webappUsageCount: 1 }), record('c', { title: '阅读', totalChars: 4 })];
  assert.deepEqual(filterHistory(records, { ...emptyHistoryFilters, search: '301 活动', classId: 'c1', module: 'worksheet' }).map(r => r.id), ['a']);
  assert.deepEqual(filterHistory(records, { ...emptyHistoryFilters, module: 'explorer' }).map(r => r.id), ['b']);
  assert.deepEqual(filterHistory(records, { ...emptyHistoryFilters, module: 'companion' }).map(r => r.id), ['c']);
  assert.equal(filterHistory(records, { ...emptyHistoryFilters, search: '不存在' }).length, 0);
});
test('history calendar range includes both boundaries and uses creation day for old missing end times', () => {
  const records = [record('a'), record('b', { endedAt: '2026-10-21T00:00:00' }), record('c', { endedAt: null, createdAt: '2026-10-20T00:00:00' })];
  assert.deepEqual(filterHistory(records, { ...emptyHistoryFilters, from: '2026-10-20', to: '2026-10-20' }).map(r => r.id), ['a', 'c']);
  assert.equal(filterHistory(records, { ...emptyHistoryFilters, from: '2026-10-21', to: '2026-10-20' }).length, 0);
});
test('history sorting does not mutate the source records', () => {
  const records = [record('new'), record('old', { endedAt: '2026-10-19T09:00:00' })];
  assert.deepEqual(filterHistory(records, { ...emptyHistoryFilters, sort: 'oldest' }).map(r => r.id), ['old', 'new']);
  assert.deepEqual(records.map(r => r.id), ['new', 'old']);
});
