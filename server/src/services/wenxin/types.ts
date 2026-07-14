// ============================================================
// 文心智能体 API — TypeScript 类型定义
// 基于文心智能体平台 API 文档 v2024-06-14
// ============================================================

// ---- 通用 ----

/** Wenxin API 基础 URL */
export const WENXIN_BASE_URL = 'https://agentapi.baidu.com';

/** 统一响应包装（非流式） */
export interface WenxinResponse<T = unknown> {
  status: number;       // 0 成功，非 0 失败
  message: string;      // 错误信息
  logid: string;        // 请求日志 ID
  data?: T;
}

// ---- 认证 ----

/** AccessToken 请求参数 */
export interface AccessTokenRequest {
  grant_type: 'client_credentials';
  client_id: string;      // 智能体 ID
  client_secret: string;  // Secret Key
}

/** AccessToken 响应 */
export interface AccessTokenResponse {
  access_token: string;
  expires_in: number;       // 有效期（秒），默认 30 天
  error?: string;
  error_description?: string;
}

// ---- 消息内容类型 ----

/** 消息内容的 type 取值 */
export type MessageContentType = 'text' | 'image' | 'file' | 'multimodal';

/** 消息内容基础结构 */
export interface MessageContent {
  type: MessageContentType;
  value: TextValue | ImageValue | FileValue | MultimodalValue;
}

/** type=text 时的 value */
export interface TextValue {
  showText: string;              // 文本内容
}

/** type=image 时的 value */
export interface ImageValue {
  imageUrl: string;              // 图片 URL
  imageName?: string;            // 图片名称
  imageType?: string;            // 图片类型（如 png）
  imageSize?: number;            // 图片大小（字节）
}

/** type=file 时的 value */
export interface FileValue {
  fileId: string;                // 文件 ID
  fileUrl: string;               // 文件 URL
  fileName: string;              // 文件名
  fileType: string;              // 文件类型（如 pdf）
  fileSize: number;              // 文件大小（字节）
}

/** type=multimodal 中 type=image 用的 value 字段
 *  注意：文心的多模态 message 要求图片用 file* 前缀字段，而非 image*
 */
export interface MultimodalImageValue {
  fileUrl: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  fileId?: string;
}

/** type=multimodal 时的 value（数组） */
export type MultimodalValue = Array<
  | { type: 'text'; value: { showText?: string; text?: string } }
  | { type: 'image'; value: MultimodalImageValue }
  | { type: 'file'; value: FileValue }
>;

// ---- getAnswer 非流式 ----

/** getAnswer 请求 body */
export interface GetAnswerRequest {
  message: {
    content: MessageContent;
  };
  source: string;     // 智能体 ID
  from: 'openapi';    // 固定值
  openId: string;     // 外部用户 ID（用于上下文串联）
  threadId?: string;  // 会话 ID，续传时必填
}

/** getAnswer 响应 data */
export interface GetAnswerData {
  content: ResponseContent[];
  threadId: string;
  msgId: string;
  referenceList?: ReferenceItem[];
}

/** 响应正文单项 */
export interface ResponseContent {
  dataType: 'text' | 'markdown' | 'uiData';
  data: string | { text: string };
}

/** 溯源信息 */
export interface ReferenceItem {
  text: string;       // 来源描述
  url: string;        // 来源地址
}

// ---- conversation 流式 ----

/** conversation 请求 body（同 getAnswer 一致） */
export interface ConversationRequest {
  message: {
    content: MessageContent;
  };
  source: string;
  from: 'openapi';
  openId: string;
  threadId?: string;  // 首次可不传，续传必填
}

/** SSE 事件类型 */
export type SSEEventType = 'ping' | 'message';

/** SSE data 中的数据包 */
export interface SSEPackage {
  status: number;
  message: string;
  logid: string;
  data: {
    message: {
      msgId: string;
      threadId: string;
      endTurn: boolean;           // 最后一包 true
      content: SSEContentItem[];  // 至少一个
      progress?: ToolProgress;
    };
  };
}

/** SSE 中的 content 单项 */
export interface SSEContentItem {
  dataType: string;       // 'markdown' 或 'uiData'
  isFinished: boolean;    // 当前片段是否完成
  data: {
    text: string;
    type?: 'txt';
    antiFlag?: number;
    isIntervene?: boolean;
    showType?: 'append' | 'replace';
    typeData?: unknown[];     // uiData 时可能包含
  };
}

/** 工具调用进度 */
export interface ToolProgress {
  toolsStatus: Array<{
    status: 'ing' | 'finish' | 'error';
    toolName: string;
    title: string;
    description?: string;
  }>;
}

// ---- 错误码 ----

/** Wenxin 业务错误码 */
export const WenxinErrorCodes: Record<number, string> = {
  0: '请求成功',
  1000: '参数错误（invalid input）',
  1001: '服务端内部错误（system error）',
  1002: '请求频率超限（rate limit exceeded）',
  1003: '生成失败（generate failed）',
  1005: '命中昆仑反作弊（hit kunlun）',
  1006: '智能体已下线（agent is offline）',
  1113: '命中 3s 词表（query hit 3s dict）',
  1115: '智能体请求数量超限，每个智能体每日 500 次（agent usage limit exceeded）',
  1116: '密钥校验失败（api access deny）',
};

export function getWenxinErrorMessage(code: number): string {
  return WenxinErrorCodes[code] || `未知错误 (code=${code})`;
}

// ---- 文件类型 ----

/** 文件扩展名 → Wenxin type 映射 */
export const wenxinMimeTypeMap: Record<string, string> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.webp': 'image', '.gif': 'image', '.svg': 'image',
};

// ---- 流式回调 ----

export interface WenxinStreamCallbacks {
  /** 文本增量片段 */
  onDelta?: (chunk: string) => void;
  /** 一条完整 content 完成（含 isFinished 标记） */
  onContentCompleted?: (item: SSEContentItem) => void;
  /** 流结束（endTurn=true） */
  onEnd?: (threadId: string, msgId: string) => void;
  /** 工具调用进度 */
  onToolProgress?: (progress: ToolProgress) => void;
  /** 错误 */
  onError?: (error: { code: number; message: string }) => void;
  /** ping 心跳 */
  onPing?: () => void;
}

// ---- Agent 配置 ----

export interface WenxinAgentConfig {
  /** appId（= 智能体 ID） */
  appId: string;
  /** secretKey（= API Key） */
  secretKey: string;
  /** 可选自定义 base URL */
  baseUrl?: string;
  /** 可选 OAuth Access Token（如果设置则优先使用 Token 认证） */
  accessToken?: string;
  /** 可选 client_id（AccessToken 模式下使用） */
  clientId?: string;
  /** 可选 client_secret（AccessToken 模式下使用） */
  clientSecret?: string;
  /** 当前对话的 threadId */
  threadId?: string;
}

// ---- 工具函数 ----

/** 构建 text 类型的消息内容 */
export function buildTextMessage(text: string): MessageContent {
  return {
    type: 'text',
    value: { showText: text },
  };
}

/** 构建 image 类型的消息内容 */
export function buildImageMessage(
  imageUrl: string,
  imageName?: string,
  imageType?: string,
  imageSize?: number
): MessageContent {
  return {
    type: 'image',
    value: { imageUrl, imageName, imageType, imageSize },
  };
}

/** 构建 multimodal 类型的消息内容 */
export function buildMultimodalMessage(
  text: string,
  imageUrls?: { url: string; name?: string; type?: string }[]
): MessageContent {
  const value: MultimodalValue = [{ type: 'text', value: { showText: text, text } }];
  if (imageUrls) {
    for (const img of imageUrls) {
      const ext = (img.type || (img.url.includes('.') ? img.url.split('.').pop()!.toLowerCase() : ''));
      value.push({
        type: 'image',
        value: {
          fileId: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileUrl: img.url,
          fileName: img.name || img.url.split('/').pop() || 'image',
          fileType: ext || undefined,
        },
      });
    }
  }
  return { type: 'multimodal', value };
}
