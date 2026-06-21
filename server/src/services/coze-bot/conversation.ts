// ============================================================
// Coze Conversation API 模块
// ============================================================
import { CozeHttpClient } from './client.js';
import type {
  CozeResponse,
  ConversationData,
  CreateConversationRequest,
  ListConversationsRequest,
  ListConversationsData,
  UpdateConversationRequest,
  ClearContextData,
} from './types.js';

export class ConversationAPI {
  constructor(private client: CozeHttpClient) {}

  /**
   * 创建会话
   * POST /v1/conversation/create
   */
  async create(
    req: CreateConversationRequest
  ): Promise<ConversationData> {
    const res = await this.client.post<CozeResponse<ConversationData>>(
      '/v1/conversation/create',
      req
    );
    return res.data!;
  }

  /**
   * 查看会话信息
   * GET /v1/conversation/retrieve
   */
  async retrieve(conversationId: string): Promise<ConversationData> {
    const res = await this.client.get<CozeResponse<ConversationData>>(
      '/v1/conversation/retrieve',
      { conversation_id: conversationId }
    );
    return res.data!;
  }

  /**
   * 查看会话列表
   * GET /v1/conversations
   */
  async list(
    req: ListConversationsRequest
  ): Promise<ListConversationsData> {
    const res = await this.client.get<CozeResponse<ListConversationsData>>(
      '/v1/conversations',
      {
        bot_id: req.bot_id,
        page_num: req.page_num,
        page_size: req.page_size,
        sort_order: req.sort_order,
        connector_id: req.connector_id,
      }
    );
    return res.data!;
  }

  /**
   * 更新会话名称
   * PUT /v1/conversations/:conversation_id
   */
  async updateName(
    conversationId: string,
    name: string
  ): Promise<ConversationData> {
    const res = await this.client.put<CozeResponse<ConversationData>>(
      `/v1/conversations/${conversationId}`,
      { name } satisfies UpdateConversationRequest
    );
    return res.data!;
  }

  /**
   * 删除会话
   * DELETE /v1/conversations/:conversation_id
   */
  async delete(conversationId: string): Promise<void> {
    await this.client.delete<CozeResponse<void>>(
      `/v1/conversations/${conversationId}`
    );
  }

  /**
   * 清除会话上下文
   * POST /v1/conversations/:conversation_id/clear
   *
   * 清除后模型不可见历史消息，但消息不会实际删除
   * 系统会创建新的 section 存储后续消息
   */
  async clearContext(conversationId: string): Promise<ClearContextData> {
    const res = await this.client.post<CozeResponse<ClearContextData>>(
      `/v1/conversations/${conversationId}/clear`
    );
    return res.data!;
  }
}
