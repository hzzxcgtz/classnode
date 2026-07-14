import test from 'node:test';
import assert from 'node:assert/strict';
import { asJsonRecord, extractContent, getCozeMessageEndError, resolveLocalPath } from '../services/ai-proxy.js';

test('extractContent only combines text payloads from nested SSE values', () => {
  assert.equal(extractContent('课堂反馈'), '课堂反馈');
  assert.equal(extractContent([{ text: '做得' }, { content: [{ text: '很好' }] }]), '做得很好');
  assert.equal(extractContent({ type: 'message', id: 'metadata-only' }), '');
  assert.equal(extractContent(null), '');
});

test('Coze message_end errors are exposed only for non-zero error codes', () => {
  assert.equal(getCozeMessageEndError({ type: 'message_end', content: { message_end: { code: '0' } } }), null);
  assert.equal(
    getCozeMessageEndError({ type: 'message_end', content: { message_end: { code: 'invalid_request', message: '参数错误' } } }),
    'Coze Agent 返回错误: code=invalid_request 参数错误',
  );
  assert.equal(getCozeMessageEndError({ type: 'message_delta', content: {} }), null);
});

test('asJsonRecord rejects arrays and primitive values from external responses', () => {
  assert.deepEqual(asJsonRecord({ code: '0' }), { code: '0' });
  assert.equal(asJsonRecord([]), null);
  assert.equal(asJsonRecord('response'), null);
});

test('AI attachment resolver refuses paths outside the application uploads directory', () => {
  assert.match(resolveLocalPath('/uploads/chat/chat-550e8400-e29b-41d4-a716-446655440000.png'), /uploads[\\/]chat[\\/]chat-/);
  assert.throws(() => resolveLocalPath('/uploads/../../settings.db'), /超出应用上传目录/);
  assert.throws(() => resolveLocalPath('/etc/passwd'), /仅允许读取应用上传目录/);
});
