// ============================================================
// Coze 低代码智能体 API — TypeScript 类型定义
// 基于 Coze Bot API v3 完整文档
// ============================================================

// ---- 通用响应结构 ----

/** API 通用响应包装 */
export interface CozeResponse<T = unknown> {
  code: number;       // 0 成功，非 0 失败
  msg: string;        // 错误时含详细错误信息
  data?: T;
  /** 部分消息接口将实体直接放在 message 字段。 */
  message?: T;
  detail?: ResponseDetail;
}

export interface ResponseDetail {
  logid: string;      // 请求日志 ID，用于排查
}

// ---- Conversation ----

/** Conversation 数据 */
export interface ConversationData {
  id: string;
  name: string;
  meta_data?: Record<string, string>;
  creator_id: string;
  created_at: number;       // 10 位 Unix 时间戳（秒）
  updated_at: number;
  last_section_id: string;
  connector_id?: string;    // 渠道 ID，1024=API, 999=ChatSDK
}

/** 创建会话请求 */
export interface CreateConversationRequest {
  bot_id?: string;
  name?: string;                          // 最多 100 字符
  messages?: EnterMessage[];              // 同步创建消息
  connector_id?: string;                  // 默认 1024
  meta_data?: Record<string, string>;     // 最多 16 对键值对
}

/** 查看会话列表请求 */
export interface ListConversationsRequest {
  bot_id: string;
  page_num?: number;      // 默认 1
  page_size?: number;     // 默认 50，最大 50
  sort_order?: 'asc' | 'desc';   // 默认 desc
  connector_id?: string;  // 默认 1024
}

/** 查看会话列表响应 */
export interface ListConversationsData {
  has_more: boolean;
  conversations: ConversationData[];
}

/** 更新会话名称请求 */
export interface UpdateConversationRequest {
  name: string;   // 最多 100 字符
}

/** 清除上下文响应 */
export interface ClearContextData {
  id: string;           // 新的 section_id
  conversation_id: string;
}

// ---- Message ----

/** 消息基础结构 */
export interface MessageData {
  id: string;
  conversation_id: string;
  bot_id?: string;
  chat_id?: string;
  role: 'user' | 'assistant';
  content: string;
  content_type: 'text' | 'object_string' | 'card' | 'audio';
  type: MessageType;
  meta_data?: Record<string, string>;
  created_at: number;
  updated_at: number;
  section_id?: string;
  reasoning_content?: string;   // 深度思考内容
}

/** 消息类型枚举 */
export type MessageType =
  | 'question'          // 用户输入
  | 'answer'            // 智能体回复
  | 'function_call'     // 函数调用中间结果
  | 'tool_output'       // 工具调用输出
  | 'tool_response'     // 工具调用结果
  | 'follow_up'         // 推荐问题（仅响应）
  | 'verbose'           // 多 answer 结束标记（仅响应）
  | 'knowledge';        // 知识库召回（仅响应）

/** EnterMessage — 创建消息/发起对话时传入的消息结构 */
export interface EnterMessage {
  role: 'user' | 'assistant';
  type?: MessageType;            // 默认为 question
  content: string;               // 纯文本 或 object_string JSON
  content_type: 'text' | 'object_string';   // card 仅响应
  meta_data?: Record<string, string>;
}

/** object_string 中的单项 */
export interface ObjectStringItem {
  type: 'text' | 'file' | 'image' | 'audio';
  text?: string;
  file_id?: string;       // 已上传的文件 ID
  file_url?: string;      // 可公开访问的在线地址
}

/** 创建消息请求 */
export interface CreateMessageRequest {
  role: 'user' | 'assistant';
  content: string;
  content_type: 'text' | 'object_string';
  meta_data?: Record<string, string>;
}

/** 消息列表请求 */
export interface ListMessagesRequest {
  order?: 'asc' | 'desc';      // 默认 desc
  chat_id?: string;            // 按 Chat ID 筛选
  before_id?: string;          // 向前翻页
  after_id?: string;           // 向后翻页
  limit?: number;              // 默认 50，1-50
  include_middle_message?: boolean;  // 是否包含中间消息
}

/** 消息列表响应 */
export interface ListMessagesData {
  messages: MessageData[];
  has_more: boolean;
  first_id: string;
  last_id: string;
}

/** 修改消息请求 */
export interface ModifyMessageRequest {
  content?: string;                   // content 和 meta_data 不能同时为空
  content_type?: 'text' | 'object_string';
  meta_data?: Record<string, string>;
}

/** 提交反馈请求 */
export interface SubmitFeedbackRequest {
  feedback_type: 'like' | 'unlike';
  reason_types?: string[];      // 最多 10 个标签，每个 ≤30 字符
  comment?: string;             // 最多 250 字符
}

// ---- Chat (对话) ----

/** Chat 状态 */
export type ChatStatus =
  | 'created'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'requires_action'
  | 'canceled';

/** Chat 对象 — 对话的基本信息 */
export interface ChatData {
  id: string;               // Chat ID，对话唯一标识
  conversation_id: string;
  bot_id: string;
  created_at: number;
  completed_at?: number;
  failed_at?: number;
  meta_data?: Record<string, string>;
  last_error?: LastError | null;
  status: ChatStatus;
  required_action?: RequiredAction;
  usage?: ChatUsage;
  section_id?: string;
}

export interface LastError {
  code: number;
  msg: string;
}

export interface ChatUsage {
  token_count: number;
  output_count: number;
  input_count: number;
}

export interface RequiredAction {
  type: 'submit_tool_outputs';
  submit_tool_outputs: SubmitToolOutputs;
}

export interface SubmitToolOutputs {
  tool_calls: InterruptPlugin[];
}

export interface InterruptPlugin {
  id: string;
  type: 'function' | 'reply_message';
  function: InterruptFunction;
}

export interface InterruptFunction {
  name: string;
  arguments: string;    // JSON 字符串
}

/** 发起对话请求 */
export interface CreateChatRequest {
  bot_id: string;
  user_id: string;
  additional_messages?: EnterMessage[];     // 最多 100 条
  stream?: boolean;                         // 默认 false
  auto_save_history?: boolean;              // 默认 true
  custom_variables?: Record<string, string>; // Prompt 变量
  meta_data?: Record<string, string>;
  extra_params?: Record<string, string>;    // latitude / longitude 等
  shortcut_command?: ShortcutCommand;
  parameters?: Record<string, unknown>;         // 对话流自定义参数
  enable_card?: boolean;                    // 默认 false
  publish_status?: 'published_online' | 'unpublished_draft';  // 默认 published_online
  bot_version?: string;                     // 指定智能体版本号
}

export interface ShortcutCommand {
  command_id: string;
  parameters?: Record<string, string>;  // 组件参数
}

/** 提交工具执行结果请求 */
export interface SubmitToolOutputsRequest {
  stream?: boolean;
  tool_outputs: ToolOutput[];
}

export interface ToolOutput {
  tool_call_id: string;
  output: string;     // 工具执行结果 JSON
}

/** 取消对话请求 */
export interface CancelChatRequest {
  chat_id: string;
  conversation_id: string;
}

// ---- 流式响应事件 ----

/** SSE 事件名称 */
export type SSEEvent =
  | 'conversation.chat.created'
  | 'conversation.chat.in_progress'
  | 'conversation.chat.completed'
  | 'conversation.chat.failed'
  | 'conversation.chat.requires_action'
  | 'conversation.message.delta'
  | 'conversation.message.completed'
  | 'conversation.audio.delta'
  | 'done'
  | 'error';

/** SSE 数据包 */
export interface SSEPackage {
  event: SSEEvent;
  data: unknown;  // ChatData | MessageData 取决于 event
}

// ---- 文件 ----

/** 文件信息 */
export interface FileData {
  id: string;           // file_id
  bytes: number;
  file_name: string;
  created_at: number;
}

// ---- Agent 配置 ----

/** Coze 智能体配置 */
export interface CozeAgentConfig {
  apiKey: string;
  botId: string;
  baseUrl?: string;     // 默认 https://api.coze.cn
  conversationId?: string;
}

// ---- 工具函数 ----

/** 构建 object_string 序列化内容 */
export function buildObjectString(items: ObjectStringItem[]): string {
  return JSON.stringify(items);
}

/** 构建文本+图片的多模态消息 */
export function buildMultimodalMessage(
  text: string,
  fileIds?: string[],
  fileUrls?: string[]
): { content: string; content_type: 'object_string' } {
  const items: ObjectStringItem[] = [{ type: 'text', text }];
  if (fileIds) {
    for (const fid of fileIds) {
      items.push({ type: 'image', file_id: fid });
    }
  }
  if (fileUrls) {
    for (const furl of fileUrls) {
      items.push({ type: 'image', file_url: furl });
    }
  }
  return {
    content: buildObjectString(items),
    content_type: 'object_string',
  };
}
