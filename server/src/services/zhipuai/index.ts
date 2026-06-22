// ============================================================
// ZhipuaiBot — 智谱清言智能体 API 主入口
//
// 使用方式:
//   import { ZhipuaiBot } from '../services/zhipuai/index.js';
//   const bot = new ZhipuaiBot({ assistantId: 'xxx', apiKey: 'xxx', apiSecret: 'xxx' });
//   await bot.sendMessage('你好', { userName: 'student_123' });
// ============================================================
import { ZhipuaiHttpClient } from './client.js';
import { ChatAPI } from './chat.js';
import type { ZhipuaiAgentConfig, ZhipuaiStreamCallbacks } from './types.js';

export type { ZhipuaiAgentConfig, ZhipuaiStreamCallbacks };
export { ZhipuaiClientError } from './client.js';
export { extractSyncText } from './types.js';

/**
 * ZhipuaiBot — 智谱清言智能体 API 封装
 *
 * 提供基于智谱清言 Assistant API 的完整对接：
 * - sendMessage（非流式对话 stream_sync）
 * - sendMessageStream（流式对话 stream SSE）
 * - 文件上传（file_upload）
 * - AccessToken 自动管理（两步鉴权 + 缓存续期）
 */
export class ZhipuaiBot {
  /** HTTP 客户端 */
  readonly client: ZhipuaiHttpClient;

  /** 对话 API */
  readonly chat: ChatAPI;

  /** assistantId */
  readonly assistantId: string;

  constructor(config: ZhipuaiAgentConfig) {
    this.assistantId = config.assistantId;
    this.client = new ZhipuaiHttpClient(config);
    this.chat = new ChatAPI(this.client);
  }

  /**
   * 非流式对话（stream_sync）
   *
   * @param prompt 用户消息文本
   * @param options.conversationId 对话上下文 ID（可选，续传时传入）
   * @param options.fileIds 已上传的文件 ID 列表（可选）
   * @returns { content, conversationId }
   */
  async sendMessage(
    prompt: string,
    options: {
      conversationId?: string;
      fileIds?: string[];
    }
  ): Promise<{
    content: string;
    conversationId?: string;
    historyId?: string;
  }> {
    return await this.chat.sendSync(prompt, {
      assistantId: this.assistantId,
      conversationId: options.conversationId,
      fileIds: options.fileIds,
    });
  }

  /**
   * 流式对话（stream SSE）
   *
   * @param prompt 用户消息文本
   * @param options.conversationId 对话上下文 ID（可选）
   * @param options.fileIds 已上传的文件 ID 列表（可选）
   * @param callbacks 流式回调
   * @param signal 取消信号（可选）
   * @returns { content, conversationId, historyId }
   */
  async sendMessageStream(
    prompt: string,
    options: {
      conversationId?: string;
      fileIds?: string[];
    },
    callbacks: ZhipuaiStreamCallbacks,
    signal?: AbortSignal
  ): Promise<{
    content: string;
    conversationId: string;
    historyId: string;
  }> {
    return await this.chat.sendStream(prompt, {
      assistantId: this.assistantId,
      conversationId: options.conversationId,
      fileIds: options.fileIds,
    }, callbacks, signal);
  }

  /**
   * 获取下一步问题建议（追问）
   *
   * 使用对话返回的 conversation_id 调用原生 suggest/prompts API，
   * 返回该会话最后一条消息的后续追问建议。
   *
   * @param conversationId 会话 ID
   * @param logId 可选，历史记录 ID（传了会走缓存）
   * @returns 追问建议列表（最多 3 条）
   */
  async suggestPrompts(
    conversationId: string,
    logId?: string
  ): Promise<string[]> {
    return this.chat.suggestPrompts(conversationId, logId);
  }

  /**
   * 上传文件获取 file_id
   */
  async uploadFile(
    filePath: string,
    fileName: string,
    mimeType: string
  ): Promise<string | null> {
    const fs = await import('fs');
    const fileBuffer = fs.readFileSync(filePath);
    return this.client.uploadFile(fileBuffer, fileName, mimeType);
  }
}
