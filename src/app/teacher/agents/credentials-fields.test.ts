import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canFetchCozeAgentInfo } from './agent-info-preview.ts';

const base = {
  platform: 'coze' as const,
  botId: '7691197735609221174',
  credentialId: '',
  apiKey: '',
  hasSavedApiKey: false,
};

test('选择已有共享令牌后，可以自动获取 Coze 智能体资料', () => {
  assert.equal(canFetchCozeAgentInfo({ ...base, credentialId: 'credential-1' }), true);
});

test('手动输入令牌或编辑时沿用已保存令牌，也可以自动获取资料', () => {
  assert.equal(canFetchCozeAgentInfo({ ...base, apiKey: 'pat_custom' }), true);
  assert.equal(canFetchCozeAgentInfo({ ...base, hasSavedApiKey: true }), true);
});

test('缺少 Bot ID、缺少任一凭据或平台不匹配时不可获取', () => {
  assert.equal(canFetchCozeAgentInfo(base), false);
  assert.equal(canFetchCozeAgentInfo({ ...base, credentialId: 'credential-1', botId: '  ' }), false);
  assert.equal(canFetchCozeAgentInfo({ ...base, credentialId: 'credential-1', platform: 'coze-agent' }), false);
});
