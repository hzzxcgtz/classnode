import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generationFor, normalizeGeneration, retainCurrentGeneration } from './worksheet-generation.ts';
import { readQueue, writeQueue, classifyFailure } from './worksheet-queue.ts';

test('清除单题只丢对应离线草稿；整卷清除丢全部旧代际，保留新作答', () => {
  const items = [{ questionId: 'a', generation: '0:0', at: 1, value: null }, { questionId: 'b', at: 2, value: null }];
  assert.deepEqual(retainCurrentGeneration(items, { all: 0, questions: { a: 1 } }), [items[1]]);
  const latest = { questionId: 'a', generation: '1:0', at: 3, value: null };
  assert.deepEqual(retainCurrentGeneration([...items, latest], { all: 1, questions: {} }), [latest]);
  assert.equal(generationFor({ all: 0, questions: {} }, '__proto__'), '0:0');
  assert.deepEqual(normalizeGeneration({ all: 0, questions: [] }), { all: 0, questions: {} });
});
test('离线队列保留作答代际，存储拒绝显式返回失败', () => {
  let raw = '';
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = ''; } };
  const items = [{ questionId: 'a', generation: '3:2', at: 1, value: null }];
  assert.equal(writeQueue(storage, 'queue', items), true);
  assert.deepEqual(readQueue(storage, 'queue'), items);
  assert.equal(writeQueue({ ...storage, setItem: () => { throw new Error('quota'); } }, 'queue', items), false);
  assert.equal(classifyFailure(409, 'classroom-paused'), 'locked');
  assert.equal(classifyFailure(409, 'student-blacklisted'), 'locked');
  assert.equal(classifyFailure(409, 'classroom-ended'), 'permanent');
  assert.equal(classifyFailure(409, 'answers-cleared'), 'permanent');
});
