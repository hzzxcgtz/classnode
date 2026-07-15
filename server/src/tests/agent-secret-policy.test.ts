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
  assert.equal(maskAgentSecret('pat_1234567890abcd'), 'pat_**********abcd');
  assert.equal(maskAgentSecret('12345678'), '********');
  assert.equal(maskAgentSecret('short'), '*****');
  assert.equal(maskAgentSecret(''), '');
});
