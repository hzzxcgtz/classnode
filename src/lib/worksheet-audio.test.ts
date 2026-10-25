import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerValue, draftFromValue, emptyDraftFor, isDraftEmpty, isAudioNode } from './worksheet-answer-value.ts';
import { answerView } from './worksheet-answer-view.ts';
import type { WorksheetQuestionNode } from './types.ts';
const url = '/uploads/classrooms/room/worksheet/chat-550e8400-e29b-41d4-a716-446655440000.ogg';
const node = { id: 'q', type: 'short-answer', inputMode: 'audio', prompt: '说说你的发现', data: {}, children: [] } as WorksheetQuestionNode;
test('audio answers round-trip through drafts, submitted values and review after an input mode change', () => {
  const draft = { kind: 'audio' as const, url, durationMs: 3400 };
  assert.equal(isDraftEmpty(emptyDraftFor(node)), true);
  assert.equal(isDraftEmpty(draft), false);
  const value = buildAnswerValue(node, draft);
  assert.deepEqual(value, { format: 'audio/v1', url, durationMs: 3400 });
  assert.deepEqual(draftFromValue(node, value), draft);
  assert.deepEqual(answerView({ ...node, inputMode: 'keyboard' }, value), draft);
  assert.equal(isAudioNode({ type: 'drawing', inputMode: 'audio' }), false);
});
test('empty, external, malformed and overlong recordings cannot be submitted', () => {
  for (const draft of [
    { kind: 'audio' as const, url: '', durationMs: 0 },
    { kind: 'audio' as const, url: 'https://example.com/audio.ogg', durationMs: 1000 },
    { kind: 'audio' as const, url, durationMs: NaN },
    { kind: 'audio' as const, url, durationMs: 300001 },
  ]) assert.equal(buildAnswerValue(node, draft), null);
  assert.equal(buildAnswerValue({ ...node, type: 'single-choice', inputMode: 'keyboard' }, { kind: 'audio', url, durationMs: 1000 }), null);
});
