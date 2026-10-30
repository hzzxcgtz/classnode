import test from 'node:test';
import assert from 'node:assert/strict';
import { audioMonitorPreview } from './worksheet-audio-monitor.ts';
import { activeAnswer, worksheetTileState } from './worksheet-tile-state.ts';
import type { WorksheetQuestionNode, WorksheetMaterialSummary } from '../../../lib/types';
const nodes = ['q1', 'q2', 'q3'].map(id => ({ id, type: 'short-answer', inputMode: 'audio', prompt: '说一说', data: {}, children: [] })) as WorksheetQuestionNode[];
const audio = { format: 'audio/v1', url: '/uploads/chat/chat-550e8400-e29b-41d4-a716-446655440000.ogg', durationMs: 4474 };
const rows = [{ questionId: 'q1', value: null, savedAt: '2026-10-29T13:59:55Z' }, { questionId: 'q2', value: audio, savedAt: '2026-10-29T13:59:33Z' }];
test('later clear of first audio does not hide second recorded answer; heading and preview use same question', () => {
  const preview = audioMonitorPreview(nodes, rows, null, 'q1');
  assert.deepEqual(preview, { questionId: 'q2', value: audio });
  const state = worksheetTileState({ worksheet: { id: 'w' } as WorksheetMaterialSummary, nodes, progress: { cells: { q1: 'draft', q2: 'draft' }, lastQuestionId: 'q1', lastAt: 100 }, liveQuestionId: preview?.questionId, online: true, now: 101 });
  assert.equal(state.kind, 'working');
  if (state.kind !== 'working') return;
  assert.equal(state.number, '2');
  assert.equal(activeAnswer(nodes, rows, state.cells, 'q1', preview)?.node.id, 'q2');
});
test('empty live audio uses other saved recording, but never resurrects the cleared recording itself', () => {
  assert.equal(audioMonitorPreview(nodes, rows, { questionId: 'q1', value: null }, 'q1')?.questionId, 'q2');
  assert.equal(audioMonitorPreview(nodes, [{ questionId: 'q2', value: audio }], { questionId: 'q2', value: null }, 'q2')?.value, null);
});
test('new recording and non-audio live edits retain priority', () => {
  const draft = { questionId: 'q3', value: audio };
  assert.equal(audioMonitorPreview(nodes, rows, draft, 'q1'), draft);
  const textNodes = [{ ...nodes[0], inputMode: 'keyboard' }, ...nodes.slice(1)] as WorksheetQuestionNode[];
  const text = { questionId: 'q1', value: null };
  assert.equal(audioMonitorPreview(textNodes, rows, text, 'q1'), text);
});
