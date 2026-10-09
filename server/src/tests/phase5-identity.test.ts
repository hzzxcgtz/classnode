import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Anonymizer } from '../services/anonymizer.js';
import { createStudentToken, verifyStudentToken, revokeAllStudentSessions } from '../middleware/student-auth.js';
import { toAgentConfig } from '../services/agent-config.js';

test('特殊姓名按字面脱敏和还原，不解释正则或替换模板', () => {
  for (const name of ['[张三]', 'A.B', 'a+b', '$&', '$1', '(小明)']) {
    const service = new Anonymizer();
    const text = `你好 ${name}，${name} 今天来了`;
    const anonymous = service.anonymizeMessage(text, name);
    assert.equal(anonymous, '你好 User_001，User_001 今天来了');
    assert.equal(service.deanonymizeMessage(anonymous), text);
  }
});
test('会话替换只撤销同一课堂同一参与者，清零撤销全部', () => {
  const original = createStudentToken('a', 'p');
  const other = createStudentToken('b', 'p');
  const replacement = createStudentToken('a', 'p');
  assert.equal(verifyStudentToken(original), null);
  assert.ok(verifyStudentToken(other));
  assert.ok(verifyStudentToken(replacement));
  revokeAllStudentSessions();
  assert.equal(verifyStudentToken(other), null);
  assert.equal(verifyStudentToken(replacement), null);
});
test('Coze Agent 调用配置传递明确会话标识', () => {
  assert.equal(toAgentConfig({ platform: 'coze-agent', apiUrl: 'http://localhost', apiKey: 'test', botId: null, extra: null }, null, { sessionId: 'classnode_test' }).sessionId, 'classnode_test');
});
