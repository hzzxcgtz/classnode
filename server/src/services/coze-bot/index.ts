// ============================================================
// CozeBot — 扣子低代码智能体 API 主入口
//
// 使用方式:
//   import { CozeBot } from '../services/coze-bot/index.js';
//   const coze = new CozeBot({ apiKey: 'pat_xxx', botId: 'xxx' });
//   await coze.chat('你好', { userName: 'student_123' });
// ============================================================
import { CozeHttpClient, ClientOptions } from './client.js';
import { ConversationAPI } from './conversation.js';
import { MessageAPI } from './message.js';
import { ChatAPI, StreamCallbacks } from './chat.js';
import { FileAPI } from './file.js';
import type {
  CozeAgentConfig,
  EnterMessage,
  CreateChatRequest,
  MessageData,
  ChatData,
  SSEEvent,
} from './types.js';

type CozeMessageItem =
  | { type: 'text'; text: string }
  | { type: 'image'; file_id?: string; file_url?: string };

export type {
  CozeAgentConfig,
  EnterMessage,
  MessageData,
  ChatData,
  SSEEvent,
  StreamCallbacks,
  CreateChatRequest,
};

/**
 * CozeBot — 扣子低代码智能体 API 封装
 *
 * 提供基于官方 v3 API 的完整对接：
 * - Conversation 管理（创建/查询/列表/清除上下文）
 * - Message 管理（创建/列表/详情/修改/删除/评价）
 * - Chat 对话（流式 + 非流式）
 * - 文件上传
 */
export class CozeBot {
  /** 底层 HTTP 客户端（各子模块共享） */
  readonly client: CozeHttpClient;

  /** Conversation CRUD */
  readonly conversation: ConversationAPI;

  /** Message CRUD */
  readonly message: MessageAPI;

  /** Chat 对话（底层 API，需要更细粒度控制时使用） */
  readonly chats: ChatAPI;

  /** 文件上传 */
  readonly file: FileAPI;

  /** 智能体 ID */
  readonly botId: string;

  /** 可选的 base URL */
  readonly baseUrl: string;

  constructor(config: CozeAgentConfig) {
    this.botId = config.botId;
    this.baseUrl = config.baseUrl || 'https://api.coze.cn';

    const opts: ClientOptions = {
      baseUrl: this.baseUrl,
    };

    this.client = new CozeHttpClient(config.apiKey, opts);
    this.conversation = new ConversationAPI(this.client);
    this.message = new MessageAPI(this.client);
    this.chats = new ChatAPI(this.client);
    this.file = new FileAPI(this.client);
  }

  /**
   * 便捷方法：发起一次对话并获取完整回复（非流式）
   *
   * @param content 用户消息
   * @param options.userName 用户标识（必填）
   * @param options.conversationId 会话 ID（可选，不传则自动创建新会话）
   * @param options.history 历史消息（可选）
   * @param options.additionalMessages 额外消息（可选，替代 history + content）
   * @returns { content, conversationId, chatId }
   */
  async chat(
    content: string,
    options: {
      userName: string;
      conversationId?: string;
      history?: EnterMessage[];
    }
  ): Promise<{ content: string; conversationId: string; chatId: string }> {
    const messages: EnterMessage[] = [];

    // 历史消息
    if (options.history) {
      messages.push(...options.history);
    }

    // 当前消息（仅在 history 末尾不是 user 消息时添加，避免调用方已构造好完整消息时重复）
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role !== 'user') {
      messages.push({
        role: 'user',
        content,
        content_type: 'text',
      });
    }

    const req: CreateChatRequest = {
      bot_id: this.botId,
      user_id: options.userName,
      additional_messages: messages,
      auto_save_history: true,
      stream: false,
    };

    const chat = await this.chats.create(options.conversationId, req);

    // 轮询直到完成
    const completed = await this.chats.pollUntilCompleted(
      chat.conversation_id,
      chat.id
    );

    // 获取回复消息
    const chatMessages = await this.chats.getMessages(
      completed.conversation_id,
      completed.id
    );

    // 提取最后的 answer
    const answer = chatMessages
      .filter(m => m.type === 'answer' && m.role === 'assistant')
      .map(m => m.content)
      .join('');

    return {
      content: answer,
      conversationId: completed.conversation_id,
      chatId: completed.id,
    };
  }

  /**
   * 便捷方法：发起流式对话
   *
   * @param content 用户消息
   * @param options.userName 用户标识
   * @param callbacks 流式回调
   * @param options.conversationId 会话 ID（可选）
   * @param options.history 历史消息（可选）
   * @param signal 取消信号（可选）
   */
  async chatStream(
    content: string,
    options: {
      userName: string;
      conversationId?: string;
      history?: EnterMessage[];
      fileUrls?: string[];
    },
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<{ conversationId: string; chatId: string }> {
    const messages: EnterMessage[] = [];

    // 历史消息（仅当有 conversationId 时不传历史，避免双倍消耗）
    if (!options.conversationId && options.history) {
      messages.push(...options.history);
    }

    // 构造当前消息（仅在 history 末尾不是 user 消息时添加，避免调用方已构造好完整消息时重复）
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role !== 'user') {
      if (options.fileUrls && options.fileUrls.length > 0) {
        const textItems: CozeMessageItem[] = [{ type: 'text', text: content }];
        for (const url of options.fileUrls) {
          textItems.push({ type: 'image' as const, file_url: url });
        }
        messages.push({
          role: 'user',
          content: JSON.stringify(textItems),
          content_type: 'object_string',
        });
      } else {
        messages.push({
          role: 'user',
          content,
          content_type: 'text',
        });
      }
    }

    const req: CreateChatRequest = {
      bot_id: this.botId,
      user_id: options.userName,
      additional_messages: messages,
      auto_save_history: true,
      stream: true,
    };

    const chat = await this.chats.createStream(
      options.conversationId,
      req,
      callbacks,
      signal
    );

    return {
      conversationId: chat.conversation_id,
      chatId: chat.id,
    };
  }

  /**
   * 构建带多模态附加消息
   */
  static buildMultimodalMessage(
    text: string,
    imageFileIds?: string[],
    imageUrls?: string[]
  ): EnterMessage {
    const items: CozeMessageItem[] = [{ type: 'text', text }];
    if (imageFileIds) {
      for (const fid of imageFileIds) {
        items.push({ type: 'image', file_id: fid });
      }
    }
    if (imageUrls) {
      for (const url of imageUrls) {
        items.push({ type: 'image', file_url: url });
      }
    }
    return {
      role: 'user',
      content: JSON.stringify(items),
      content_type: 'object_string',
    };
  }

  /**
   * 将本地消息记录转为 Coze EnterMessage 数组（用于 additional_messages）
   * Coze 接受的历史消息类型：autoSaveHistory=true 时只支持 question / answer
   */
  static buildHistoryMessages(
    history: { role: string; content: string }[]
  ): EnterMessage[] {
    return history.map(h => ({
      role: h.role as 'user' | 'assistant',
      type: h.role === 'assistant' ? 'answer' as const : 'question' as const,
      content: h.content,
      content_type: 'text' as const,
    }));
  }
}
