// ============================================================
// 智谱清言 — 对话模块
// 流式（stream）+ 非流式（stream_sync）+ 追问建议（suggest/prompts）
// ============================================================
import { ZhipuaiHttpClient } from './client.js';
import type {
  SyncResponse,
  ZhipuaiStreamCallbacks,
  SSEResult,
  SuggestPromptsRequest,
  SuggestPromptsResponse,
} from './types.js';
import { extractSyncText } from './types.js';

export class ChatAPI {
  constructor(private client: ZhipuaiHttpClient) {}

  /**
   * 非流式对话（stream_sync）
   *
   * POST /stream_sync
   * 等待完整响应后返回文本、conversationId、historyId
   */
  async sendSync(
    prompt: string,
    options: {
      assistantId: string;
      conversationId?: string;
      fileIds?: string[];
    }
  ): Promise<{
    content: string;
    conversationId?: string;
    historyId?: string;
  }> {
    const body: Record<string, any> = {
      assistant_id: options.assistantId,
      prompt,
    };
    if (options.conversationId) {
      body.conversation_id = options.conversationId;
    }
    if (options.fileIds && options.fileIds.length > 0) {
      body.file_list = options.fileIds.map(id => ({ file_id: id }));
    }

    const data = await this.client.post<SyncResponse>('/stream_sync', body);

    if (data.status !== 0) {
      throw new Error(`清言返回错误: ${data.message || '未知错误'}`);
    }

    const content = extractSyncText(data.result?.output);
    const conversationId = data.result?.conversation_id || options.conversationId;
    const historyId = data.result?.history_id;

    if (!content) {
      const snippet = JSON.stringify(data).slice(0, 200);
      throw new Error(`清言返回为空: ${snippet}`);
    }

    return { content, conversationId, historyId };
  }

  /**
   * 流式对话（stream）
   *
   * POST /stream
   * SSE 流式响应，通过 callbacks 接收文本增量
   * 返回完整文本、conversationId、historyId
   */
  async sendStream(
    prompt: string,
    options: {
      assistantId: string;
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
    const body: Record<string, any> = {
      assistant_id: options.assistantId,
      prompt,
    };
    let streamConvId = options.conversationId || '';
    let streamHistoryId = '';
    if (options.conversationId) {
      body.conversation_id = options.conversationId;
    }
    if (options.fileIds && options.fileIds.length > 0) {
      body.file_list = options.fileIds.map(id => ({ file_id: id }));
    }

    const response = await this.client.postStream(
      '/stream',
      body,
      signal
    );

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    /** 自上次文本事件后是否遇到过非文本事件（如 tool_call 导致的生成阶段切换） */
    let seenNonTextSinceLastText = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;

          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;

          try {
            // 每个 data 行都是一个完整的 SSEResult
            const parsed: SSEResult = JSON.parse(dataStr);

            // 捕获 conversation_id 和 history_id（首次出现后不再覆盖）
            if (parsed.conversation_id && !streamConvId) {
              streamConvId = parsed.conversation_id;
            }
            if (parsed.history_id && !streamHistoryId) {
              streamHistoryId = parsed.history_id;
            }

            // 提取文本内容（type=text 的情况）
            if (parsed.message?.content?.type === 'text' && parsed.message.content.text) {
              const text = parsed.message.content.text;
              // 自上次文本事件后经历了 tool_call / browser_result 等非文本事件，
              // 说明进入了新的文本生成阶段，之前累积的 fullContent 已不适用。
              // 此时如果新文本不以 fullContent 开头，重置累积内容以避免重复累积。
              if (seenNonTextSinceLastText && fullContent && !text.startsWith(fullContent)) {
                fullContent = '';
              }
              seenNonTextSinceLastText = false;
              // API 返回的是累积文本，计算增量
              const delta = text.startsWith(fullContent)
                ? text.slice(fullContent.length)
                : text;
              if (delta) {
                fullContent += delta;
                callbacks.onDelta?.(delta);
              }
            } else if (parsed.message?.content?.type && parsed.message.content.type !== 'text') {
              // 非文本事件（tool_calls / browser_result / quote_result 等），
              // 标记已在生成阶段之间切换，下一段文本应重置累积状态
              seenNonTextSinceLastText = true;
            }
          } catch {
            // 跳过无法解析的行
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        callbacks.onEnd?.(streamConvId);
        return { content: fullContent, conversationId: streamConvId, historyId: streamHistoryId };
      }
      throw e;
    }

    callbacks.onEnd?.(streamConvId);
    return { content: fullContent, conversationId: streamConvId, historyId: streamHistoryId };
  }

  /**
   * 获取下一步问题建议（suggest/prompts）
   *
   * POST /suggest/prompts
   * 使用 conversation 接口返回的 conversation_id 调用，
   * 返回该会话最后一条消息的后续追问建议。
   *
   * @param conversationId 会话 ID
   * @param logId 可选，历史记录 ID，传了会走缓存的问题建议
   * @returns 追问建议列表（最多 3 条）
   */
  async suggestPrompts(
    conversationId: string,
    logId?: string
  ): Promise<string[]> {
    // log_id 的语义是获取"之前某条 log_id 的生成结果，如果未生成过，会返回空"
    // 对于当前刚刚完成的对话，尚未生成过追问，因此只传 conversation_id 让 API 自动生成
    const body: SuggestPromptsRequest = {
      conversation_id: conversationId,
    };

    console.log(`[ZhipuaiSuggest] 请求追问: conversation_id=${conversationId}`);

    const data = await this.client.post<SuggestPromptsResponse>('/suggest/prompts', body);

    console.log(`[ZhipuaiSuggest] 响应: status=${data.status} list=${JSON.stringify(data.result?.list)}`);

    if (data.status !== 0) {
      console.error('[ZhipuaiSuggest] API 返回错误:', data.message);
      return [];
    }

    return data.result?.list?.slice(0, 3) || [];
  }
}
