// ============================================================
// 智谱清言 Assistant API — TypeScript 类型定义
// 基于官方文档: POST /stream, /stream_sync, /suggest/prompts
// ============================================================

// ---- 通用 ----

/** 清言 API 基础 URL */
export const ZHIPUAI_BASE_URL = 'https://chatglm.cn/chatglm/assistant-api/v1';

/** AccessToken 响应 */
export interface TokenResponse {
  status: number;           // 0 成功
  message?: string;
  result?: {
    access_token: string;
    expires_in: number;     // 过期秒数（10天 = 864000）
  };
}

// ---- SSE 流式输出（POST /stream） ----

/**
 * SSE 每一行 data: 的完整 Result 结构
 *
 * 文档说明：SSE 流式输出每个 data 行都是一个完整的 JSON 对象，
 * status 字段标识状态流转：init → processing → finish/error
 */
export interface SSEResult {
  history_id: string;          // 历史记录 ID（用于 suggest 接口的 log_id）
  conversation_id: string;     // 对话上下文 ID
  message: SSEMessage;         // 输出消息体
  status: 'init' | 'processing' | 'finish' | 'error';
  created_at: string;          // "2023-11-23 18:00:00"
  last_error?: {
    error_code: string;
    error_msg: string;
  };
  meta_data?: Record<string, unknown>;
}

/** SSE 返回的 Message 结构 */
export interface SSEMessage {
  role: 'assistant' | 'tool';
  content: SSEContent;
  status: 'init' | 'processing' | 'finish' | 'error';
  created_at: string;
  meta_data?: Record<string, unknown>;
}

/** SSE Content 结构 — 根据不同的 Tool 调用情况返回不同格式 */
export interface SSEContent {
  type: 'text' | 'image' | 'code' | 'execution_output' | 'system_error'
      | 'tool_calls' | 'browser_result' | 'function_result'
      | 'quote_result' | 'rag_slices';
  text?: string;
  image?: Array<{ image_url: string }>;
  code?: string;
  content?: string;
  tool_calls?: { name: string; arguments: string };
}

// ---- stream_sync 非流式响应（POST /stream_sync） ----

export interface SyncResponse {
  status: number;
  message?: string;
  result?: {
    history_id: string;
    conversation_id: string;
    output: SyncOutputItem[];
    status: string;           // init/processing/finish/error
  };
}

export interface SyncOutputItem {
  role: 'assistant' | 'tool';
  content: SSEContent | SSEContent[];
  status: string;
  created_at: string;
  meta_data?: Record<string, unknown>;
}

// ---- 下一步问题建议（POST /suggest/prompts） ----

export interface SuggestPromptsRequest {
  conversation_id: string;
  log_id?: string;           // 获取指定历史记录的缓存结果
}

export interface SuggestPromptsResponse {
  status: number;
  message?: string;
  result?: {
    list: string[];           // 追问建议列表
  };
}

// ---- file_upload 文件上传（POST form-data /file_upload） ----

export interface FileUploadResponse {
  status: number;
  message?: string;
  result?: {
    file_id: string;
    file_name: string;
  };
}

// ---- 流式回调 ----

export interface ZhipuaiStreamCallbacks {
  /** 文本增量片段 */
  onDelta?: (chunk: string) => void;
  /** 流结束 */
  onEnd?: (conversationId?: string) => void;
  /** 错误 */
  onError?: (error: { code?: number; message: string }) => void;
}

// ---- 智能体配置 ----

export interface ZhipuaiAgentConfig {
  /** Assistant ID */
  assistantId: string;
  /** API Key */
  apiKey: string;
  /** API Secret */
  apiSecret: string;
  /** 可选自定义 base URL */
  baseUrl?: string;
  /** 当前对话上下文 ID */
  conversationId?: string;
}

// ---- 工具函数 ----

/** 从同步响应的 output 中提取完整文本 */
export function extractSyncText(output?: SyncOutputItem[]): string {
  if (!output) return '';
  const parts: string[] = [];
  for (const item of output) {
    const contents = Array.isArray(item.content) ? item.content : (item.content ? [item.content] : []);
    for (const c of contents) {
      if (c.type === 'text' && c.text) {
        parts.push(c.text);
      }
    }
  }
  return parts.join('');
}
