import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatAPI, CozeStreamError } from '../services/coze-bot/chat.js';
import { CozeHttpClient } from '../services/coze-bot/client.js';

function api(body: string, contentType = 'text/event-stream') {
  const bytes = new TextEncoder().encode(body);
  // Split every three bytes, including inside UTF-8 Chinese and SSE field names.
  const response = () => new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
    controller.close();
  } }), { headers: { 'content-type': contentType, 'x-tt-logid': 'test-trace' } });
  return new ChatAPI({ postStream: async () => response() } as unknown as CozeHttpClient);
}
const request = { bot_id: 'test', user_id: 'test', stream: true };
const failed = 'event: conversation.chat.created\ndata: {"id":"chat-test","conversation_id":"conv-test"}\n\nevent: conversation.chat.failed\ndata: {"last_error":{"code":730001,"msg":"测试：没有识别到语音"}}';
for (const method of ['chat', 'tools']) {
  test(`${method} preserves upstream failure code, reason, trace and IDs without final newline`, async () => {
    const chats = api(failed);
    const run = () => method === 'chat' ? chats.createStream(undefined, request, {}) : chats.submitToolOutputsStream('conv-test', 'chat-test', { tool_outputs: [] }, {});
    await assert.rejects(run, error => {
      assert.ok(error instanceof CozeStreamError);
      assert.equal(error.code, 730001); assert.equal(error.msg, '测试：没有识别到语音');
      assert.equal(error.logid, 'test-trace'); assert.equal(error.chatId, 'chat-test');
      assert.equal(error.conversationId, 'conv-test');
      assert.doesNotMatch(error.message, /未返回完成/); return true;
    });
  });
}
test('error events and HTTP 200 JSON business errors retain their original code', async () => {
  for (const [body, type] of [
    ['event: error\ndata: {"code":4011,"msg":"余额不足"}\n\n', 'text/event-stream'],
    ['{"code":4011,"msg":"余额不足"}', 'application/json'],
  ]) await assert.rejects(() => api(body, type).createStream(undefined, request, {}), error => error instanceof CozeStreamError && error.code === 4011 && error.msg === '余额不足');
});
test('valid final event without trailing newline completes and multiline data is supported', async () => {
  let output = '';
  const result = await api('event: conversation.message.delta\r\ndata: {"type":"answer","role":"assistant",\r\ndata: "content":"你好"}\r\n\r\nevent: conversation.chat.completed\r\ndata: {"id":"chat","conversation_id":"conv"}')
    .createStream(undefined, request, { onDelta: chunk => { output += chunk; } });
  assert.equal(output, '你好'); assert.equal(result.id, 'chat');
});
test('truncated streams are distinguished from actual upstream business failures', async () => {
  await assert.rejects(() => api('event: conversation.chat.in_progress\ndata: {"id":"chat"}\n\n').createStream(undefined, request, {}), error => error instanceof CozeStreamError && error.event === 'incomplete_stream' && error.message.includes('conversation.chat.in_progress'));
});
test('malformed JSON in tool events is not swallowed', async () => {
  await assert.rejects(() => api('event: error\ndata: {broken}\n\n').submitToolOutputsStream('conv', 'chat', { tool_outputs: [] }, {}), /无法解析/);
});
test('HTTP failures preserve business code rather than replacing it with HTTP status', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 4011, msg: 'test quota' }, { status: 429, headers: { 'x-tt-logid': 'http-trace' } });
  try {
    await assert.rejects(() => new CozeHttpClient('unused-test-token').postStream('/v3/chat', {}), error => {
      assert.ok(error instanceof Error);
      const detail = error as Error & { code: number; statusCode: number; logid: string };
      return detail.code === 4011 && detail.statusCode === 429 && detail.logid === 'http-trace' && detail.message.includes('test quota');
    });
  } finally { globalThis.fetch = original; }
});
