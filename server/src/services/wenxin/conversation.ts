// ============================================================
// 文心智能体 API — 会话管理
//
// Wenxin 的会话管理相对简单：threadId 纯透传（服务端维护上下文）。
// 本模块负责 openId 的生成/管理和 threadId 的存储协调。
// ============================================================

/**
 * 从 userName 生成合法的 openId
 *
 * 文心 API 对 openId 的要求：
 * - 唯一性：每个用户唯一
 * - 格式：数字、下划线、大小写字母，长度 ≤100 字符
 * - 可追溯：接入方可追溯到用户
 */
export function makeOpenId(userName: string): string {
  // 只保留合法字符
  let cleaned = userName.replace(/[^a-zA-Z0-9_]/g, '_');
  // 限制长度
  if (cleaned.length > 100) {
    cleaned = cleaned.slice(0, 100);
  }
  // 确保不为空
  if (!cleaned) {
    cleaned = `user_${Date.now()}`;
  }
  return cleaned;
}

/**
 * 会话上下文管理（轻量级，可按需扩展）
 *
 * 注：实际的 threadId 存储由上层（socket/index.ts 的 platformConversations Map）负责。
 * 这里只提供辅助函数，不维护全局状态。
 */
export class ConversationAPI {
  /**
   * 生成新的 thread lookup key
   * 格式：classroomId:studentId:agentId
   */
  static makeThreadKey(classroomId: string, studentId: string, agentId: string): string {
    return `${classroomId}:${studentId}:${agentId}`;
  }

  /**
   * 解析 thread lookup key
   */
  static parseThreadKey(key: string): { classroomId: string; studentId: string; agentId: string } | null {
    const parts = key.split(':');
    if (parts.length < 3) return null;
    return {
      classroomId: parts[0],
      studentId: parts[1],
      agentId: parts.slice(2).join(':'), // agentId 可能含冒号
    };
  }
}
