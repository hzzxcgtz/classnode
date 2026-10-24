import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proxyAIRequestStream } from '../services/ai-proxy.js';
import { detectSafeChatFile, detectSafeImage } from '../services/upload-security.js';
import { ATTACHMENT_URL, ATTACHMENT_IMAGE_URL } from '../services/upload-paths.js';
import { validateStudentMessagePayload } from '../socket/index.js';

const audioUrl = '/uploads/chat/chat-550e8400-e29b-41d4-a716-446655440000.ogg';
const imageUrl = audioUrl.replace('.ogg', '.png');

test('audio uploads require Ogg Opus content and stay outside image operations', () => {
  const bytes = Buffer.alloc(47);
  bytes.write('OggS'); bytes[5] = 2; bytes[26] = 1; bytes[27] = 19;
  bytes.write('OpusHead', 28); bytes[36] = 1; bytes[37] = 1;
  assert.equal(detectSafeChatFile(bytes, 'voice.ogg'), 'ogg');
  assert.equal(detectSafeImage(bytes), null);
  bytes.write('vorbis!!', 28);
  assert.equal(detectSafeChatFile(bytes, 'voice.ogg'), null);
  assert.equal(detectSafeChatFile(Buffer.from('not audio'), 'voice.ogg'), null);
  assert.equal(ATTACHMENT_URL.test(audioUrl), true);
  assert.equal(ATTACHMENT_IMAGE_URL.test(audioUrl), false);
  assert.ok(validateStudentMessagePayload({ classroomCode: 'ABC123', studentId: 'test', content: '(语音)', fileUrls: [audioUrl] }));
});

test('Coze streams audio file IDs, preserves image type and fails closed on upload errors', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-audio-test-'));
  const previousDirectory = process.env.CLASSNODE_DATA_DIR;
  const originalFetch = globalThis.fetch;
  process.env.CLASSNODE_DATA_DIR = directory;
  fs.mkdirSync(path.join(directory, 'uploads/chat'), { recursive: true });
  for (const url of [audioUrl, imageUrl]) fs.writeFileSync(path.join(directory, url.slice(1)), 'test-file');
  let uploads = 0;
  let chats = 0;
  let failUpload = false;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/v1/files/upload')) {
      if (failUpload) return Response.json({ code: 4000, msg: 'test upload failure' }, { status: 400 });
      uploads++;
      const file = (init!.body as FormData).get('file') as File;
      assert.equal(file.type, uploads === 1 ? 'audio/ogg' : 'image/png');
      return Response.json({ code: 0, data: { id: `file-${uploads}`, file_name: file.name, bytes: file.size } });
    }
    chats++;
    const request = JSON.parse(String(init!.body));
    assert.equal(request.stream, true);
    const last = request.additional_messages[request.additional_messages.length - 1];
    assert.equal(last.content_type, 'object_string');
    assert.deepEqual(JSON.parse(last.content), [{ type: 'audio', file_id: 'file-1' }, { type: 'image', file_id: 'file-2' }]);
    return new Response('event: conversation.message.delta\ndata: {"role":"assistant","type":"answer","content":"听到了"}\n\nevent: conversation.chat.completed\ndata: {"id":"chat","conversation_id":"conversation","status":"completed"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const config = { platform: 'coze', apiKey: 'unused', botId: 'test' };
    let streamed = '';
    const result = await proxyAIRequestStream(config, '(语音)', 'synthetic-test', chunk => { streamed += chunk; }, [], [audioUrl, imageUrl]);
    assert.equal(result.success, true);
    assert.equal(result.content, '听到了');
    assert.equal(streamed, '听到了');
    failUpload = true;
    const failed = await proxyAIRequestStream(config, '(语音)', 'synthetic-test', () => assert.fail('must not stream after failed upload'), [], [audioUrl]);
    assert.equal(failed.success, false);
    assert.match(failed.error!, /附件上传到扣子失败/);
    assert.equal(chats, 1);
    const controller = new AbortController(); controller.abort();
    const cancelled = await proxyAIRequestStream(config, '(语音)', 'synthetic-test', () => {}, [], [audioUrl], controller.signal);
    assert.equal(cancelled.aborted, true);
    assert.equal(uploads, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDirectory === undefined) delete process.env.CLASSNODE_DATA_DIR;
    else process.env.CLASSNODE_DATA_DIR = previousDirectory;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Coze proxy returns the original upstream code and trace to the local caller', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('event: conversation.chat.failed\ndata: {"last_error":{"code":730001,"msg":"synthetic ASR failure"}}\n\n', { headers: { 'Content-Type': 'text/event-stream', 'x-tt-logid': 'proxy-test-trace' } });
  try {
    const result = await proxyAIRequestStream({ platform: 'coze', apiKey: 'unused', botId: 'test' }, 'synthetic test', 'test', () => {});
    assert.equal(result.success, false);
    assert.match(result.error!, /730001/);
    assert.match(result.error!, /synthetic ASR failure/);
    assert.match(result.error!, /proxy-test-trace/);
    assert.doesNotMatch(result.error!, /未返回完成事件/);
  } finally { globalThis.fetch = originalFetch; }
});
