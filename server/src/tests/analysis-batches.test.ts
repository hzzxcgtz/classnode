import test from 'node:test';
import assert from 'node:assert/strict';
import { splitClassBatches } from '../services/analysis-batches.js';
import type { AnalyzeEntry } from '../services/analysis-payload.js';

const texts = (count: number, length = 100): AnalyzeEntry[] => Array.from({ length: count }, (_, i) => ({ studentId: `s${i}`, kind: 'text', text: '文'.repeat(length) }));

test('30份文字作答分为12、12、6，顺序、内容完整且无重复', () => {
  const entries = texts(30);
  const batches = splitClassBatches(entries);
  assert.deepEqual(batches.map(b => b.length), [12, 12, 6]);
  assert.deepEqual(batches.flat(), entries);
  assert.equal(new Set(batches.flat().map(e => e.studentId)).size, 30);
  assert.deepEqual(splitClassBatches([]), []);
  assert.deepEqual(splitClassBatches(texts(12)).map(b => b.length), [12]);
  assert.deepEqual(splitClassBatches(texts(13)).map(b => b.length), [12, 1]);
});

test('长文字仍优先按字符预算拆分，单份超长作答不会丢失', () => {
  assert.deepEqual(splitClassBatches(texts(8, 4000)).map(b => b.length), [4, 4]);
  const entries = texts(2, 20000);
  assert.deepEqual(splitClassBatches(entries).map(b => b.length), [1, 1]);
  assert.deepEqual(splitClassBatches(entries).flat(), entries);
});

test('图片和录音继续遵循原有附件数量与时长限制', () => {
  const photos: AnalyzeEntry[] = texts(7).map(e => ({ ...e, kind: 'photo', photoUrl: '/test.png' }));
  assert.deepEqual(splitClassBatches(photos).map(b => b.length), [6, 1]);
  const audio: AnalyzeEntry[] = texts(6).map(e => ({ ...e, kind: 'audio', durationMs: 10000 }));
  assert.deepEqual(splitClassBatches(audio).map(b => b.length), [5, 1]);
  assert.deepEqual(splitClassBatches(audio.slice(0, 3).map(e => ({ ...e, durationMs: 90000 }))).map(b => b.length), [2, 1]);
});
