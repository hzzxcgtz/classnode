// ============================================================
// WenxinBot — 文心智能体 API 主入口
//
// 使用方式:
//   import { WenxinBot } from '../services/wenxin/index.js';
//   const bot = new WenxinBot({ appId: 'xxx', secretKey: 'xxx' });
//   await bot.chat('你好', { userName: 'student_123' });
// ============================================================
import { WenxinHttpClient } from './client.js';
import { ChatAPI } from './chat.js';
import { ConversationAPI, makeOpenId } from './conversation.js';
import { FileAPI } from './file.js';
import type {
  WenxinAgentConfig,
  WenxinStreamCallbacks,
  ReferenceItem,
  MessageContent,
} from './types.js';
import { buildTextMessage, buildMultimodalMessage } from './types.js';

export type {
  WenxinAgentConfig,
  WenxinStreamCallbacks,
  ReferenceItem,
  MessageContent,
};

export { WenxinClientError } from './client.js';
export { makeOpenId } from './conversation.js';
export { buildTextMessage, buildMultimodalMessage } from './types.js';

/**
 * WenxinBot — 文心智能体 API 封装
 *
 * 提供基于文心智能体平台官方 API 的完整对接：
 * - getAnswer（非流式对话）
 * - conversation（流式对话 SSE）
 * - OAuth AccessToken 可选支持
 * - 多模态消息（text + image）
 * - 溯源信息提取（referenceList）
 */
export class WenxinBot {
  /** HTTP 客户端 */
  readonly client: WenxinHttpClient;

  /** 对话 API */
  readonly chat: ChatAPI;

  /** 会话管理 */
  readonly conversation: ConversationAPI;

  /** 文件/多模态 */
  readonly file: FileAPI;

  /** appId */
  readonly appId: string;

  constructor(config: WenxinAgentConfig) {
    this.appId = config.appId;
    this.client = new WenxinHttpClient(config);
    this.chat = new ChatAPI(this.client);
    this.conversation = new ConversationAPI();
    this.file = new FileAPI();
  }

  /**
   * 非流式对话（getAnswer）
   *
   * @param content 用户消息文本
   * @param options.userName 学生用户名（用作 openId）
   * @param options.threadId 对话 threadId（可选，续传时传入）
   * @param options.fileUrls 附件 URL 列表（可选）
   * @returns { content, threadId, referenceList }
   */
  async sendMessage(
    content: string,
    options: {
      userName: string;
      threadId?: string;
      fileUrls?: string[];
    }
  ): Promise<{
    content: string;
    threadId: string;
    msgId: string;
    referenceList?: ReferenceItem[];
  }> {
    const openId = makeOpenId(options.userName);
    const messageContent = options.fileUrls?.length
      ? await this.file.buildMultimodalContent(content, options.fileUrls)
      : undefined;

    return await this.chat.getAnswer(content, {
      userName: openId,
      threadId: options.threadId,
      fileUrls: options.fileUrls,
      messageContent,
    });
  }

  /**
   * 流式对话（conversation SSE）
   *
   * @param content 用户消息文本
   * @param options.userName 学生用户名（用作 openId）
   * @param options.threadId 对话 threadId（可选）
   * @param options.fileUrls 附件 URL 列表（可选）
   * @param callbacks 流式回调
   * @param signal 取消信号（可选）
   * @returns { threadId }
   */
  async sendMessageStream(
    content: string,
    options: {
      userName: string;
      threadId?: string;
      fileUrls?: string[];
    },
    callbacks: WenxinStreamCallbacks,
    signal?: AbortSignal
  ): Promise<{
    content: string;
    threadId: string;
    msgId: string;
  }> {
    const openId = makeOpenId(options.userName);
    const messageContent = options.fileUrls?.length
      ? await this.file.buildMultimodalContent(content, options.fileUrls)
      : undefined;

    return await this.chat.conversation(
      content,
      {
        userName: openId,
        threadId: options.threadId,
        fileUrls: options.fileUrls,
        messageContent,
      },
      callbacks,
      signal
    );
  }

  /**
   * 获取 OAuth AccessToken
   *
   * 可选认证方式。默认使用 appId+secretKey 认证。
   * 调用前需要在 config 中提供 clientId / clientSecret。
   */
  async getAccessToken(): Promise<string> {
    return await this.client.getAccessToken();
  }

  /**
   * 构建文本消息内容
   */
  static buildTextMessage(text: string): MessageContent {
    return buildTextMessage(text);
  }

  /**
   * 构建多模态消息内容（文本 + 图片）
   */
  static buildMultimodalMessage(
    text: string,
    imageUrls?: { url: string; name?: string; type?: string }[]
  ): MessageContent {
    return buildMultimodalMessage(text, imageUrls);
  }
}
