import assert from 'node:assert/strict';
import test from 'node:test';
import { studentAIErrorMessage } from '../services/student-ai-error.js';
const audio = ['/uploads/chat/test.ogg'];

test('unknown internal audio failures do not claim silence or expose diagnostic details', () => {
  const original = '扣子对话失败（code=5000）：Internal server error [logid=private-trace]';
  const message = studentAIErrorMessage(original, audio);
  assert.equal(message, '这次语音没能处理成功，请再说一次，或改用文字发送。');
  assert.doesNotMatch(message, /5000|Internal|logid|private-trace|没有听清/);
  assert.equal(original, '扣子对话失败（code=5000）：Internal server error [logid=private-trace]');
});
test('only explicit speech recognition failures are translated to not hearing the student', () => {
  for (const error of ['识别结果为空', 'ASR returned empty', 'No speech detected']) {
    assert.match(studentAIErrorMessage(error, audio), /没有听清/);
    assert.doesNotMatch(studentAIErrorMessage(error), /没有听清/);
  }
});
test('quota, credentials, busy, limits, timeout and network failures have actionable messages', () => {
  for (const [error, expected] of [
    ['Coze API Error: code=4011 msg=quota', '告诉老师'],
    ['Coze API Error: code=401 msg=unauthorized', '告诉老师'],
    ['扣子对话失败（code=4016）：chat in progress', '上一条消息'],
    ['HTTP 429', '有点忙'],
    ['code=4008', '有点忙'],
    ['code=4009', '有点忙'],
    ['code=4020', '有点忙'],
    ['code=4100', '告诉老师'],
    ['code=4028', '告诉老师'],
    ['code=4010', '内容有点多'],
    ['code=4014', '换个说法'],
    ['code=4302', '分成几段'],
    ['code=4304', '重新录一段'],
    ['request timed out', '时间有点长'],
    ['fetch failed', '连接暂时不稳定'],
  ]) assert.ok(studentAIErrorMessage(error, audio).includes(expected));
});
test('ordinary failures and absent details never expose raw upstream responses', () => {
  for (const error of [undefined, '', 'Coze 流式响应未返回完成事件', 'unexpected provider response']) {
    assert.equal(studentAIErrorMessage(error), '小助手暂时没能回复，请稍后再试。');
  }
});
