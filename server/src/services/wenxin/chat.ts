// ============================================================
// 文心智能体 API — 对话模块
// 非流式（getAnswer）+ 流式（conversation）SSE 解析
// ============================================================
import { WenxinHttpClient } from './client.js';
import type {
  WenxinStreamCallbacks,
  GetAnswerRequest,
  GetAnswerData,
  ConversationRequest,
  SSEContentItem,
  ReferenceItem,
  MessageContent,
  ToolProgress,
} from './types.js';
import { buildTextMessage, buildMultimodalMessage } from './types.js';

type WenxinSseEnvelope = {
  status?: number;
  message?: string;
  data?: {
    message?: {
      msgId?: string;
      threadId?: string;
      endTurn?: boolean;
      content?: SSEContentItem[];
      progress?: ToolProgress;
    };
  };
};

/** 从响应 content[] 中完整提取文本
 *
 * 实际 dataType 值有多种可能：'text' / 'markdown' / 'txt' / 等
 * 不依赖 dataType 过滤，只要 data 字段可提取文本即可
 */
export function extractWenxinContent(content: GetAnswerData['content']): string {
  const parts: string[] = [];
  for (const item of content) {
    // data 为字符串（如 dataType='txt' 或 'markdown' 时）
    if (typeof item.data === 'string') {
      parts.push(item.data);
    }
    // data 为对象时尝试取 text/content 字段
    else if (item.data && typeof item.data === 'object') {
      const obj = item.data as Record<string, unknown>;
      if (typeof obj.text === 'string') {
        parts.push(obj.text);
      } else if (typeof obj.content === 'string') {
        parts.push(obj.content);
      }
    }
  }
  return parts.join('');
}

/** 从流式内容（已累积的片段）中提取引用来源 */
export function extractReferenceList(data: GetAnswerData | { referenceList?: unknown }): ReferenceItem[] {
  if (data?.referenceList && Array.isArray(data.referenceList)) {
    return data.referenceList as ReferenceItem[];
  }
  // getAnswer 非流式的 data.content 可能含 referenceList 在 data 外层
  return [];
}

export class ChatAPI {
  constructor(private client: WenxinHttpClient) {}

  /**
   * 非流式对话（getAnswer）
   *
   * POST /assistant/getAnswer?appId=xxx&secretKey=xxx
   *
   * 适合不需要实时展示打字机效果的场景。
   * 支持 text / multimodal 消息类型，普通文本用 buildTextMessage。
   */
  async getAnswer(
    content: string,
    options: {
      userName: string;       // 用作 openId
      threadId?: string;      // 续传时传入
      fileUrls?: string[];    // 附件 URL 列表
      messageContent?: MessageContent;  // 预构建的消息内容（优先级高于 content + fileUrls）
    }
  ): Promise<{
    content: string;            // 完整回答文本
    threadId: string;           // 会话 ID
    msgId: string;              // 消息 ID
    referenceList?: ReferenceItem[];
    source: string;             // source = appId
  }> {
    const config = this.client.config;
    const appId = config.appId;

    // 构建消息内容（优先使用预构建的 messageContent）
    const mc: MessageContent = options.messageContent
      ?? ((options.fileUrls && options.fileUrls.length > 0)
        ? buildMultimodalMessage(content, options.fileUrls.map(url => ({ url })))
        : buildTextMessage(content));

    const body: GetAnswerRequest = {
      message: { content: mc },
      source: appId,
      from: 'openapi',
      openId: options.userName,
    };

    if (options.threadId) {
      body.threadId = options.threadId;
    }

    const result = await this.client.post<GetAnswerData>(
      '/assistant/getAnswer',
      body
    );

    const data = result.data;

    // 提取文本
    const fullContent = extractWenxinContent(data.content || []);

    // 提取溯源信息
    const referenceList = extractReferenceList(data);

    return {
      content: fullContent,
      threadId: data.threadId,
      msgId: data.msgId,
      referenceList: referenceList.length > 0 ? referenceList : undefined,
      source: appId,
    };
  }

  /**
   * 流式对话（conversation）
   *
   * POST /assistant/conversation?appId=xxx&secretKey=xxx
   *
   * SSE 流式响应，通过 callbacks 接收各类事件。
   * 如果流式响应为空，自动回退调用非流式 getAnswer。
   */
  async conversation(
    content: string,
    options: {
      userName: string;
      threadId?: string;
      fileUrls?: string[];
      messageContent?: MessageContent;  // 预构建的消息内容（优先级高于 content + fileUrls）
    },
    callbacks: WenxinStreamCallbacks,
    signal?: AbortSignal
  ): Promise<{
    content: string;      // 完整回复文本
    threadId: string;     // 对话 threadId
    msgId: string;        // 消息 ID
  }> {
    const config = this.client.config;
    const appId = config.appId;

    // 构建消息内容（优先使用预构建的 messageContent）
    const mc: MessageContent = options.messageContent
      ?? ((options.fileUrls && options.fileUrls.length > 0)
        ? buildMultimodalMessage(content, options.fileUrls.map(url => ({ url })))
        : buildTextMessage(content));

    const body: ConversationRequest = {
      message: { content: mc },
      source: appId,
      from: 'openapi',
      openId: options.userName,
    };

    if (options.threadId) {
      body.threadId = options.threadId;
    }

    const response = await this.client.postStream(
      '/assistant/conversation',
      body,
      signal
    );

    // 读取 SSE 流
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let currentEvent = '';
    let resolvedThreadId = options.threadId || '';
    let resolvedMsgId = '';
    const dataLines: string[] = []; // 记录所有 data 行，备用回退

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === '[DONE]') continue;

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
            continue;
          }

          if (!trimmed.startsWith('data:')) continue;

          const dataStr = trimmed.slice(5).trim();
          if (!dataStr) continue;

          // 缓存所有 data 行，流为空时用于诊断
          dataLines.push(dataStr);

          if (currentEvent === 'ping') {
            callbacks.onPing?.();
            currentEvent = '';
            continue;
          }

          if (currentEvent !== 'message') {
            // 如果没有 event 前缀，也尝试解析（兼容某些实现）
          }

          let parsed: WenxinSseEnvelope;
          try {
            parsed = JSON.parse(dataStr) as WenxinSseEnvelope;
          } catch {
            continue;
          }

          // 检查业务状态
          if (parsed.status !== undefined && parsed.status !== 0) {
            callbacks.onError?.({
              code: parsed.status,
              message: parsed.message || '流式响应错误',
            });
            currentEvent = '';
            continue;
          }

          const message = parsed.data?.message;

          if (!message) {
            currentEvent = '';
            continue;
          }

          resolvedMsgId = message.msgId || resolvedMsgId;
          if (message.threadId) {
            resolvedThreadId = message.threadId;
          }

          // 处理 progress（工具调用进度）
          if (message.progress) {
            callbacks.onToolProgress?.(message.progress as ToolProgress);
          }

          // 处理 content 数组
          if (message.content && Array.isArray(message.content)) {
            for (const item of message.content) {
              const contentItem = item as SSEContentItem;
              const text = contentItem.data?.text || '';
              if (text) {
                fullContent += text;
                callbacks.onDelta?.(text);
              }
              if (contentItem.isFinished) {
                callbacks.onContentCompleted?.(contentItem);
              }
            }
          }

          // endTurn 标记流结束
          if (message.endTurn) {
            callbacks.onEnd?.(resolvedThreadId, resolvedMsgId);
          }

          currentEvent = '';
        }
      }
    } catch (error: unknown) {
      // 🔴 **中止不许被吞成「一次成功的部分回答」**（★ 2026-10-09 审计修的）。
      //
      //    从前这里在 `AbortError` 时 `return` 已累积的文本 ⇒ 上游
      //    （`ai-proxy.ts` 的 `proxyWenxinStream`）拿到非空 `fullContent` ⇒ 回
      //    `{success:true}` 而**永远不是 `aborted:true`** ⇒ `socket/index.ts:2047`
      //    不丢弃 ⇒ 半截回答被当作完整回答**落库**、推给教师看板、并成为下一轮 history。
      //    `ai-proxy` 里那处 `if (AbortError) return {success:false, aborted:true}`
      //    本来是对的 —— 被这一吞变成了**死代码**。
      //
      //    ⚠️ 对照组是 coze（`coze-bot/chat.ts` 一直 rethrow）。四个平台里只有
      //    文心与智谱不一致，而这条中止链路（`activeStreams`）是 2.0 才接通的
      //    ⇒ 是 2.0 把这段老代码从死代码变成了活缺陷。
      throw error;
    }

    // 流为空时自动回退到非流式 getAnswer
    if (!fullContent) {
      const fallback = await this.getAnswer(content, options);
      return {
        content: fallback.content,
        threadId: fallback.threadId,
        msgId: fallback.msgId,
      };
    }

    return {
      content: fullContent,
      threadId: resolvedThreadId,
      msgId: resolvedMsgId,
    };
  }
}
