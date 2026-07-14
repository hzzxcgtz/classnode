// ============================================================
// Coze Message API 模块
// 包含：消息 CRUD + 评价
// ============================================================
import { CozeHttpClient } from './client.js';
import type {
  CozeResponse,
  MessageData,
  CreateMessageRequest,
  ListMessagesRequest,
  ModifyMessageRequest,
  SubmitFeedbackRequest,
} from './types.js';

export class MessageAPI {
  constructor(private client: CozeHttpClient) {}

  /**
   * 创建消息（添加到指定会话）
   * POST /v1/conversation/message/create?conversation_id=xxx
   */
  async create(
    conversationId: string,
    req: CreateMessageRequest
  ): Promise<MessageData> {
    const res = await this.client.post<CozeResponse<MessageData>>(
      `/v1/conversation/message/create`,
      req,
      undefined, // extraHeaders
      { conversation_id: conversationId }
    );
    return res.data!;
  }

  /**
   * 查看消息列表（游标分页）
   * POST /v1/conversation/message/list?conversation_id=xxx
   *
   * 返回会话中所有消息，包括手动插入 + 对话产生的 answer
   * 不包括 function_call、tool_response、follow_up 等中间态消息
   */
  async list(
    conversationId: string,
    options?: ListMessagesRequest
  ): Promise<{
    messages: MessageData[];
    has_more: boolean;
    first_id: string;
    last_id: string;
  }> {
    const res = await this.client.post<CozeResponse<{
      messages?: MessageData[];
      has_more: boolean;
      first_id: string;
      last_id: string;
    }>>(
      `/v1/conversation/message/list`,
      options || {},
      undefined,
      { conversation_id: conversationId }
    );

    const data = res.data!;
    return {
      messages: data.messages || [],
      has_more: data.has_more,
      first_id: data.first_id,
      last_id: data.last_id,
    };
  }

  /**
   * 查看消息详情
   * GET /v1/conversation/message/retrieve?conversation_id=xxx&message_id=xxx
   */
  async retrieve(
    conversationId: string,
    messageId: string
  ): Promise<MessageData> {
    const res = await this.client.get<CozeResponse<MessageData>>(
      '/v1/conversation/message/retrieve',
      {
        conversation_id: conversationId,
        message_id: messageId,
      }
    );
    return res.data!;
  }

  /**
   * 修改消息
   * POST /v1/conversation/message/modify?conversation_id=xxx&message_id=xxx
   */
  async modify(
    conversationId: string,
    messageId: string,
    req: ModifyMessageRequest
  ): Promise<MessageData> {
    const res = await this.client.post<CozeResponse<MessageData>>(
      `/v1/conversation/message/modify`,
      req,
      undefined,
      { conversation_id: conversationId, message_id: messageId }
    );
    // 注意：该接口响应中 data 字段可能以 message 字段返回
    // 处理兼容性
    return res.message || res.data!;
  }

  /**
   * 删除消息
   * POST /v1/conversation/message/delete?conversation_id=xxx&message_id=xxx
   *
   * 删除 answer 消息时会同步删除关联的 function_call 等中间态消息
   */
  async delete(
    conversationId: string,
    messageId: string
  ): Promise<MessageData> {
    const res = await this.client.post<CozeResponse<MessageData>>(
      `/v1/conversation/message/delete`,
      undefined,
      undefined,
      { conversation_id: conversationId, message_id: messageId }
    );
    return res.data!;
  }

  /**
   * 提交消息评价（点赞/点踩）
   * POST /v1/conversations/:conversation_id/messages/:message_id/feedback
   */
  async submitFeedback(
    conversationId: string,
    messageId: string,
    req: SubmitFeedbackRequest
  ): Promise<void> {
    await this.client.post<CozeResponse<void>>(
      `/v1/conversations/${conversationId}/messages/${messageId}/feedback`,
      req
    );
  }

  /**
   * 删除消息评价
   * DELETE /v1/conversations/:conversation_id/messages/:message_id/feedback
   */
  async deleteFeedback(
    conversationId: string,
    messageId: string
  ): Promise<void> {
    await this.client.delete<CozeResponse<void>>(
      `/v1/conversations/${conversationId}/messages/${messageId}/feedback`
    );
  }
}
