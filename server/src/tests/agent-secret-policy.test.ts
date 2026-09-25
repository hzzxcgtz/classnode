import test from 'node:test';
import assert from 'node:assert/strict';
import { maskAgentSecret, shouldPreserveAgentSecret } from '../services/agent-secret-policy.js';

test('agent secret is preserved only while editing the same platform', () => {
  assert.equal(shouldPreserveAgentSecret('zhipuai', undefined), true);
  assert.equal(shouldPreserveAgentSecret('zhipuai', 'zhipuai'), true);
  assert.equal(shouldPreserveAgentSecret('zhipuai', 'coze'), false);
  assert.equal(shouldPreserveAgentSecret('coze', 'zhipuai'), false);
});

test('agent secret mask preserves length and reveals only the first and last four characters', () => {
  // ⊘ 2026-09-25：星号由「按实际长度」改成**固定 6 个**（教师：太多太长，一行显示不下），
  //    顺手也去掉了「数星号就知道密钥多长」那条侧信道。
  assert.equal(maskAgentSecret('pat_1234567890abcd'), 'pat_******abcd');
  assert.equal(maskAgentSecret('a'.repeat(60)), 'aaaa******aaaa', '多长都是 6 个星号');
  assert.equal(maskAgentSecret('12345678'), '********');
  assert.equal(maskAgentSecret('short'), '*****');
  assert.equal(maskAgentSecret(''), '');
});
