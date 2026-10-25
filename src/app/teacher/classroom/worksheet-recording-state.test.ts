import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecording, expireRecordings } from './worksheet-recording-state.ts';
const event = { participantId: 'p1', worksheetId: 'w1', questionId: 'q1', recording: true };
test('录音开始、心跳续期、结束恢复；其他学生不受影响', () => {
  let state = applyRecording({}, event, 1000);
  state = applyRecording(state, { ...event, participantId: 'p2' }, 2000);
  state = applyRecording(state, event, 6000);
  assert.equal(expireRecordings(state, 14000).p1.questionId, 'q1');
  state = applyRecording(state, { ...event, recording: false }, 7000);
  assert.equal(state.p1, undefined);
  assert.ok(state.p2);
});
test('断网收不到结束事件时，心跳过期自动清除提示', () => {
  const state = applyRecording({}, event, 1000);
  assert.equal(expireRecordings(state, 12999), state);
  assert.deepEqual(expireRecordings(state, 13000), {});
});
test('旧题目的结束事件不清掉新题或另一学习单的录音', () => {
  const state = applyRecording({}, { ...event, worksheetId: 'w2', questionId: 'q2' }, 1000);
  assert.equal(applyRecording(state, { ...event, recording: false }, 2000), state);
});
