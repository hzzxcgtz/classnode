import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPreserveAgentSecret } from '../services/agent-secret-policy.js';

test('agent secret is preserved only while editing the same platform', () => {
  assert.equal(shouldPreserveAgentSecret('zhipuai', undefined), true);
  assert.equal(shouldPreserveAgentSecret('zhipuai', 'zhipuai'), true);
  assert.equal(shouldPreserveAgentSecret('zhipuai', 'coze'), false);
  assert.equal(shouldPreserveAgentSecret('coze', 'zhipuai'), false);
});
