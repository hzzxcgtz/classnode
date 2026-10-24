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
} from './types.js';
import type { RequiredAction } from './types.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Structured upstream failure; never includes request headers or audio payloads. */
export class CozeStreamError extends Error {
  constructor(public code: number | string, public msg: string,
    public event: string, public logid?: string,
    public conversationId?: string, public chatId?: string) {
    super(`扣子对话失败（code=${code}）：${msg}${logid ? ` [logid=${logid}]` : ''}`);
    this.name = 'CozeStreamError';
  }
}

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

    return this.readStream(response, callbacks, signal);
  }

  /** Both chat and tool-output streams use the same framing and error handling. */
  private async readStream(response: Response, callbacks: StreamCallbacks, signal?: AbortSignal): Promise<ChatData> {
    const logid = response.headers.get('x-tt-logid') || response.headers.get('x-coze-logid') || undefined;
    let conversationId: string | undefined;
    let chatId: string | undefined;
    let lastEvent = '';
    let completed: ChatData | null = null;
    const failure = (event: string, value: unknown) => {
      const record = asRecord(value);
      const detail = asRecord(record?.last_error) || asRecord(record?.error) || record;
      const rawCode = detail?.code ?? detail?.error_code ?? -1;
      const code = typeof rawCode === 'number' || typeof rawCode === 'string' ? rawCode : -1;
      const rawMessage = detail?.msg ?? detail?.message ?? detail?.error_message;
      const msg = typeof rawMessage === 'string' && rawMessage ? rawMessage.slice(0, 1500) : '上游未提供具体错误说明';
      const trace = asRecord(record?.detail)?.logid;
      return new CozeStreamError(code, msg, event, typeof trace === 'string' ? trace : logid, conversationId, chatId);
    };
    if (response.headers.get('content-type')?.includes('application/json')) {
      throw failure('json_error', await response.json());
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取扣子响应流');
    const decoder = new TextDecoder();
    let buffer = '';
    let event = '';
    let data: string[] = [];
    const dispatch = () => {
      const type = event;
      const raw = data.join('\n').trim();
      event = ''; data = [];
      if (!raw) return;
      if (raw === '[DONE]' || raw === '"[DONE]"') { callbacks.onDone?.(); return; }
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { throw new CozeStreamError(-1, '扣子返回了无法解析的事件数据', type || 'invalid_json', logid, conversationId, chatId); }
      const record = asRecord(parsed);
      lastEvent = type || 'data';
      if (typeof record?.conversation_id === 'string') conversationId = record.conversation_id;
      if (type.startsWith('conversation.chat.') && typeof record?.id === 'string') chatId = record.id;
      const isError = type === 'error' || type === 'conversation.chat.failed'
        || (!type && record?.code !== undefined && record.code !== 0 && record.code !== '0');
      const upstreamError = isError ? failure(type || 'error', parsed) : null;
      this.dispatchEvent(type, parsed, callbacks);
      if (upstreamError) throw upstreamError;
      if (type === 'conversation.chat.completed') completed = parsed as ChatData;
    };
    const line = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) { dispatch(); return; }
      if (trimmed.startsWith('event:')) {
        // Also tolerate providers omitting the blank separator between events.
        if (data.length) dispatch();
        event = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) data.push(trimmed.slice(5).trimStart());
    };
    try {
      while (true) {
        signal?.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          line(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        }
      }
      buffer += decoder.decode();
      if (buffer) line(buffer);
      dispatch();
      signal?.throwIfAborted();
    } catch (problem) {
      await reader.cancel().catch(() => {});
      throw problem;
    } finally { reader.releaseLock(); }
    if (!completed) throw new CozeStreamError(-1,
      `响应流提前结束，未收到对话完成事件（最后事件：${lastEvent || '无'}）`,
      'incomplete_stream', logid, conversationId, chatId);
    return completed;
  }

  /** 将 SSE event 分派到对应的回调 */
  private dispatchEvent(eventType: string, data: unknown, cb: StreamCallbacks): void {
    const record = asRecord(data);
    switch (eventType) {
      case 'conversation.chat.created':
        cb.onChatCreated?.(data as ChatData);
        break;

      case 'conversation.chat.in_progress':
        cb.onChatInProgress?.(data as ChatData);
        break;

      case 'conversation.message.delta':
        if (record?.type === 'answer' && record.role === 'assistant' && typeof record.content === 'string') {
          cb.onDelta?.(record.content, typeof record.id === 'string' ? record.id : '');
        }
        break;

      case 'conversation.audio.delta':
        // 音频增量消息（输入为音频时返回），本场景暂不处理
        break;

      case 'conversation.message.completed':
        if (record?.type === 'follow_up' && typeof record.content === 'string') {
          cb.onFollowUp?.(record.content);
        }
        cb.onMessageCompleted?.(data as MessageData);
        // 深度思考内容随 message.completed 返回
        break;

      case 'conversation.chat.completed':
        cb.onChatCompleted?.(data as ChatData);
        break;

      case 'conversation.chat.failed':
        {
        const lastError = asRecord(record?.last_error);
        cb.onChatFailed?.({
          code: typeof record?.code === 'number' ? record.code : (typeof lastError?.code === 'number' ? lastError.code : -1),
          msg: typeof record?.msg === 'string' ? record.msg : (typeof lastError?.msg === 'string' ? lastError.msg : '对话失败'),
        });
        }
        break;

      case 'conversation.chat.requires_action':
        cb.onRequiresAction?.(record?.required_action as RequiredAction | undefined);
        break;

      case 'error':
        cb.onError?.({
          code: typeof record?.code === 'number' ? record.code : -1,
          msg: typeof record?.msg === 'string' ? record.msg : '流式错误',
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
   * 每秒轮询一次，默认最多等待 30 秒；调用方可为耗时任务单独延长。
   */
  async pollUntilCompleted(
    conversationId: string,
    chatId: string,
    timeoutSeconds = 30,
    signal?: AbortSignal,
  ): Promise<ChatData> {
    for (let i = 0; i < timeoutSeconds; i++) {
      signal?.throwIfAborted();
      const chat = await this.retrieve(conversationId, chatId);
      signal?.throwIfAborted();
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
    throw new Error(`对话轮询超时（${timeoutSeconds}秒）`);
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

    return this.readStream(response, callbacks, signal);
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
