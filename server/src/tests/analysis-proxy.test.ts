/**
 * ★ M7b：**全仓唯一一处 `fetch` 到第三方**（规格 §3.3 立这条规矩的理由：将来的合规审查
 * 只看这一个函数）。
 *
 * ⚠️ 本文件只验「**不该发的时候一个字节都没发**」。「发出去之后模型说了什么」本机验不了
 * —— 没有平台、没有密钥。**不要为了凑一条绿用例去伪造模型响应**，那是假绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyAIRequest, proxyAnalysisRequest } from '../services/ai-proxy.js';
import { anonymizer } from '../services/anonymizer.js';
import { ChatAPI } from '../services/coze-bot/chat.js';
import type { ChatData, MessageData } from '../services/coze-bot/types.js';

const agentOf = (platform: string) => ({
  id: 'a1', name: 't', platform, apiUrl: null, apiKey: 'k', botId: 'b', extra: null,
}) as unknown as Parameters<typeof proxyAnalysisRequest>[0];

test('🔴 有图 + 非 coze ⇒ 立刻失败，且一句话说清换哪个平台', async () => {
  for (const platform of ['wenxin', 'zhipuai', 'coze-agent']) {
    const r = await proxyAnalysisRequest(agentOf(platform), '消息', [Buffer.from('x')]);
    assert.equal(r.success, false, `${platform} 不该发出去`);
    assert.match(String(r.error), /收不了图|Coze/, '要说清是平台的问题、以及换哪个平台');
  }
});

test('🔴 两次调用都不碰 anonymizer（载荷已经是伪名，且这里没有「那个学生」）', async () => {
  // 为什么这条重要：`proxyAIRequest` 进来第一件事就是 `anonymizer.anonymize(studentName)`，
  // 而分析是**班级级**的、没有学生可脱敏。传一个假名字会往映射表里塞一条不是学生的记录 ——
  // 而 `MAX_ENTRIES = 500`，塞满会**重置**，重置会换掉**正在进行的一段聊天**里同一个学生的伪名。
  const before = anonymizer.size;
  await proxyAnalysisRequest(agentOf('wenxin'), '消息', [Buffer.from('x')]);
  await proxyAnalysisRequest(agentOf('不存在的平台'), '消息', []);
  await proxyAnalysisRequest(agentOf('coze-agent'), '消息', [Buffer.from('y')]);
  assert.equal(anonymizer.size, before, '这一条路一次都不许碰 anonymizer');
});

test('不认识的平台（无图）⇒ 如实失败，不是一个静默的空成功', async () => {
  const r = await proxyAnalysisRequest(agentOf('nonexistent'), '消息', []);
  assert.equal(r.success, false);
  assert.match(String(r.error), /暂不支持/);
  assert.equal(r.content, undefined, '失败时不许带 content —— 那会让调用方以为拿到了解读');
});

test('分析专用轮询等待 90 秒，普通学生对话仍使用默认 30 秒', async (t) => {
  const originalCreate = ChatAPI.prototype.create;
  const originalPoll = ChatAPI.prototype.pollUntilCompleted;
  const originalGetMessages = ChatAPI.prototype.getMessages;
  const receivedTimeouts: Array<number | undefined> = [];
  const chat = {
    id: 'chat-1', conversation_id: 'conv-1', bot_id: 'bot-1',
    status: 'completed', created_at: 1,
  } as ChatData;
  const answer = {
    id: 'message-1', conversation_id: 'conv-1', role: 'assistant', type: 'answer',
    content: '完成', content_type: 'text', created_at: 1, updated_at: 1,
  } as MessageData;

  ChatAPI.prototype.create = async () => chat;
  ChatAPI.prototype.pollUntilCompleted = async (_conversationId, _chatId, timeoutSeconds) => {
    receivedTimeouts.push(timeoutSeconds);
    return chat;
  };
  ChatAPI.prototype.getMessages = async () => [answer];
  t.after(() => {
    ChatAPI.prototype.create = originalCreate;
    ChatAPI.prototype.pollUntilCompleted = originalPoll;
    ChatAPI.prototype.getMessages = originalGetMessages;
  });

  const student = await proxyAIRequest(agentOf('coze'), '你好', '学生甲');
  const analysis = await proxyAnalysisRequest(agentOf('coze'), '分析全班作答', []);

  assert.equal(student.success, true);
  assert.equal(analysis.success, true);
  assert.deepEqual(receivedTimeouts, [undefined, 90], '学生走默认 30 秒，只有分析显式延长到 90 秒');
});

// ⚠️ **coze 那条路的成功路径没有自动化网**：它要真密钥才走得到 `uploadBuffer`，
// 而本机没有。能证的只是「有图 + coze 不会被平台闸门挡下」，而那一条由
// `analysis-agent.test.ts` 的 `analysisGateOf` 用例覆盖 —— 这里**不重复**，
// 更不伪造一个模型响应去凑一条绿用例（那是假绿）。
