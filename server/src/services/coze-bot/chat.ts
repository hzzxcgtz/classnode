// ============================================================
// Coze Chat 模块 — 核心对话 API
// v3/chat 发起对话（流式 + 非流式）
// ============================================================
import { CozeHttpClient } from './client.js';
import type {
  CozeResponse,
  ChatData,
  CreateChatRequest,
  MessageData,
  SubmitToolOutputsRequest,
  CancelChatRequest,
  SSEEvent,
} from './types.js';

/** 流式事件回调 */
export interface StreamCallbacks {
  /** 对话已创建 (conversation.chat.created) */
  onChatCreated?: (chat: ChatData) => void;
  /** 对话处理中 (conversation.chat.in_progress) */
  onChatInProgress?: (chat: ChatData) => void;
  /** 增量消息 (conversation.message.delta, type=answer 的文本片段) */
  onDelta?: (chunk: string, messageId: string) => void;
  /** 单条消息完成 (conversation.message.completed) */
  onMessageCompleted?: (message: MessageData) => void;
  /** 追问建议 (conversation.message.completed, type=follow_up) */
  onFollowUp?: (question: string) => void;
  /** 对话完成 (conversation.chat.completed) */
  onChatCompleted?: (chat: ChatData) => void;
  /** 对话失败 (conversation.chat.failed) */
  onChatFailed?: (error: { code: number; msg: string }) => void;
  /** 需要提交工具执行结果 (conversation.chat.requires_action) */
  onRequiresAction?: (action: ChatData['required_action']) => void;
  /** 流式错误 (error) */
  onError?: (error: { code?: number; msg: string }) => void;
  /** 流结束 (done) */
  onDone?: () => void;
}

export class ChatAPI {
  constructor(private client: CozeHttpClient) {}

  /**
   * 发起对话（非流式）
   * POST /v3/chat?conversation_id=xxx
   *
   * 适合一问一答、无需实时展示打字机效果的场景
   * 返回后需调用 retrieve() 轮询完成状态，再调用 getMessages() 获取回复
   */
  async create(
    conversationId: string | undefined,
    req: CreateChatRequest
  ): Promise<ChatData> {
    const res = await this.client.post<CozeResponse<ChatData>>(
      '/v3/chat',
      req,
      undefined,
      conversationId ? { conversation_id: conversationId } : undefined
    );
    return res.data!;
  }

  /**
   * 发起对话（流式）
   * POST /v3/chat?conversation_id=xxx&stream=true
   *
   * 实时 SSE 推送，通过 callbacks 接收各类事件
   * 返回完整的 ChatData（含 usage）
   */
  async createStream(
    conversationId: string | undefined,
    req: CreateChatRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<ChatData> {
    if (!req.stream) {
      req = { ...req, stream: true };
    }

    const response = await this.client.postStream(
      '/v3/chat',
      req,
      signal,
      conversationId ? { conversation_id: conversationId } : undefined
    );

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    let completedChat: ChatData | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
            continue;
          }

          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr || dataStr === '[DONE]' || dataStr === '"[DONE]"') {
              if (currentEvent === 'done') {
                callbacks.onDone?.();
              }
              currentEvent = '';
              continue;
            }

            let parsed: any;
            try {
              parsed = JSON.parse(dataStr);
            } catch {
              continue;
            }

            this.dispatchEvent(currentEvent, parsed, callbacks);

            // 追踪最终完成的 chat 信息
            if (currentEvent === 'conversation.chat.completed' && parsed) {
              completedChat = parsed as ChatData;
            }

            currentEvent = '';
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // 被外部 signal 取消，返回当前已收集的数据
        throw e;
      }
      throw e;
    }

    if (!completedChat) {
      throw new Error('Coze 流式响应未返回完成事件');
    }

    return completedChat;
  }

  /** 将 SSE event 分派到对应的回调 */
  private dispatchEvent(eventType: string, data: any, cb: StreamCallbacks): void {
    switch (eventType) {
      case 'conversation.chat.created':
        cb.onChatCreated?.(data as ChatData);
        break;

      case 'conversation.chat.in_progress':
        cb.onChatInProgress?.(data as ChatData);
        break;

      case 'conversation.message.delta':
        if (data.type === 'answer' && data.role === 'assistant' && data.content) {
          cb.onDelta?.(data.content, data.id);
        }
        break;

      case 'conversation.audio.delta':
        // 音频增量消息（输入为音频时返回），本场景暂不处理
        break;

      case 'conversation.message.completed':
        if (data.type === 'follow_up' && data.content) {
          cb.onFollowUp?.(data.content);
        }
        cb.onMessageCompleted?.(data as MessageData);
        // 深度思考内容随 message.completed 返回
        break;

      case 'conversation.chat.completed':
        cb.onChatCompleted?.(data as ChatData);
        break;

      case 'conversation.chat.failed':
        cb.onChatFailed?.({
          code: data.code || data.last_error?.code || -1,
          msg: data.msg || data.last_error?.msg || '对话失败',
        });
        break;

      case 'conversation.chat.requires_action':
        cb.onRequiresAction?.(data.required_action);
        break;

      case 'error':
        cb.onError?.({
          code: data.code,
          msg: data.msg || '流式错误',
        });
        break;
    }
  }

  /**
   * 查看对话详情
   * GET /v3/chat/retrieve?conversation_id=xxx&chat_id=xxx
   *
   * 非流式场景中，调用 create() 后轮询此接口直到 status=completed
   */
  async retrieve(
    conversationId: string,
    chatId: string
  ): Promise<ChatData> {
    const res = await this.client.get<CozeResponse<ChatData>>(
      '/v3/chat/retrieve',
      {
        conversation_id: conversationId,
        chat_id: chatId,
      }
    );
    return res.data!;
  }

  /**
   * 轮询直到对话完成（非流式场景）
   * 每秒轮询一次，最多 retries 次
   */
  async pollUntilCompleted(
    conversationId: string,
    chatId: string,
    maxRetries = 30
  ): Promise<ChatData> {
    for (let i = 0; i < maxRetries; i++) {
      const chat = await this.retrieve(conversationId, chatId);
      if (chat.status === 'completed') return chat;
      if (chat.status === 'failed') {
        throw new Error(
          `对话失败: ${chat.last_error?.msg || '未知错误'} (code=${chat.last_error?.code})`
        );
      }
      if (chat.status === 'canceled') {
        throw new Error('对话已被取消');
      }
      if (chat.status === 'requires_action') {
        // 需要提交工具执行结果
        return chat;
      }
      // 每秒轮询一次
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('对话轮询超时（30秒）');
  }

  /**
   * 查看对话消息详情
   * GET /v3/chat/message/list?conversation_id=xxx&chat_id=xxx
   *
   * 返回指定对话中除 Query 外的所有消息：
   * answer, function_call, tool_response, follow_up, verbose
   * 可用于非流式场景获取完整回复
   */
  async getMessages(
    conversationId: string,
    chatId: string
  ): Promise<MessageData[]> {
    const res = await this.client.get<CozeResponse<MessageData[]>>(
      '/v3/chat/message/list',
      {
        conversation_id: conversationId,
        chat_id: chatId,
      }
    );
    return res.data || [];
  }

  /**
   * 提交工具执行结果
   * POST /v3/chat/submit_tool_outputs?conversation_id=xxx&chat_id=xxx
   *
   * 当对话状态为 requires_action 时调用
   */
  async submitToolOutputs(
    conversationId: string,
    chatId: string,
    req: SubmitToolOutputsRequest
  ): Promise<ChatData> {
    const res = await this.client.post<CozeResponse<ChatData>>(
      '/v3/chat/submit_tool_outputs',
      { ...req, conversation_id: conversationId, chat_id: chatId }
    );
    return res.data!;
  }

  /**
   * 提交工具执行结果（流式）
   */
  async submitToolOutputsStream(
    conversationId: string,
    chatId: string,
    req: SubmitToolOutputsRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<ChatData> {
    const body = {
      ...req,
      stream: true,
      conversation_id: conversationId,
      chat_id: chatId,
    };

    const response = await this.client.postStream(
      '/v3/chat/submit_tool_outputs',
      body,
      signal
    );

    // 复用流式解析逻辑
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    let completedChat: ChatData | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
            continue;
          }
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr || dataStr === '[DONE]' || dataStr === '"[DONE]"') {
              if (currentEvent === 'done') callbacks.onDone?.();
              currentEvent = '';
              continue;
            }
            try {
              const parsed = JSON.parse(dataStr);
              this.dispatchEvent(currentEvent, parsed, callbacks);
              if (currentEvent === 'conversation.chat.completed') {
                completedChat = parsed as ChatData;
              }
              currentEvent = '';
            } catch {}
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') throw e;
      throw e;
    }

    if (!completedChat) throw new Error('Coze 流式响应未返回完成事件');
    return completedChat;
  }

  /**
   * 取消进行中的对话
   * POST /v3/chat/cancel
   */
  async cancel(conversationId: string, chatId: string): Promise<ChatData> {
    const res = await this.client.post<CozeResponse<ChatData>>(
      '/v3/chat/cancel',
      { conversation_id: conversationId, chat_id: chatId } satisfies CancelChatRequest
    );
    return res.data!;
  }
}
