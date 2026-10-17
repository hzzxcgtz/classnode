import test from 'node:test';
import assert from 'node:assert/strict';
import { CozeBot, type ChatData } from '../services/coze-bot/index.js';

test('停止非流式分析会取消远端会话，停止等待且不读取最终消息', async () => {
  const bot = new CozeBot({ apiKey: 'unused', botId: 'test' });
  const chat: ChatData = { id: 'chat', conversation_id: 'conversation', bot_id: 'test', created_at: 0, status: 'in_progress' };
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  bot.chats.create = async () => chat;
  bot.chats.pollUntilCompleted = async (_conversation, _chat, _timeout, signal) => {
    ready();
    return new Promise<ChatData>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
  };
  let cancelled = 0;
  bot.chats.cancel = async (conversationId, chatId) => {
    assert.equal(conversationId, chat.conversation_id); assert.equal(chatId, chat.id);
    cancelled++; return { ...chat, status: 'canceled' };
  };
  bot.chats.getMessages = async () => { assert.fail('停止后不应再取回复'); };
  const controller = new AbortController();
  const pending = bot.chat('分析作品', { userName: 'analysis', signal: controller.signal });
  await started;
  controller.abort(new Error('教师停止'));
  await assert.rejects(pending, /教师停止/);
  assert.equal(cancelled, 1);
});

test('调用前已停止时不创建远端会话', async () => {
  const bot = new CozeBot({ apiKey: 'unused', botId: 'test' });
  bot.chats.create = async () => { assert.fail('不应向远端发起调用'); };
  const controller = new AbortController(); controller.abort(new Error('已停止'));
  await assert.rejects(bot.chat('分析作品', { userName: 'analysis', signal: controller.signal }), /已停止/);
});
