/**
 * 脱敏转译服务
 * 将学生真实姓名转译为匿名代号，防止未成年人信息外泄
 */

const PREFIX = 'User_';
const MAX_ENTRIES = 500;

export class Anonymizer {
  private nameMap: Map<string, string> = new Map();
  private reverseMap: Map<string, string> = new Map();
  private counter = 1;

  /** 获取当前映射数 */
  get size(): number { return this.nameMap.size; }

  /**
   * 获取或创建一个真实姓名的脱敏ID
   */
  anonymize(realName: string): string {
    const existing = this.nameMap.get(realName);
    if (existing) return existing;

    // 达到上限时自动重置，防止内存持续增长
    if (this.nameMap.size >= MAX_ENTRIES) {
      this.reset();
    }

    const anonId = `${PREFIX}${String(this.counter).padStart(3, '0')}`;
    this.counter++;
    this.nameMap.set(realName, anonId);
    this.reverseMap.set(anonId, realName);
    return anonId;
  }

  /**
   * 将脱敏ID还原为真实姓名
   */
  deanonymize(anonId: string): string | undefined {
    return this.reverseMap.get(anonId);
  }

  /**
   * 在转发AI请求前，替换消息中的真实姓名为脱敏ID
   */
  anonymizeMessage(text: string, realName: string): string {
    const anonId = this.anonymize(realName);
    return text.replace(new RegExp(realName, 'g'), anonId);
  }

  /**
   * 在存储前，将AI回复中的脱敏ID还原为真实姓名
   */
  deanonymizeMessage(text: string): string {
    let result = text;
    for (const [realName, anonId] of this.nameMap) {
      result = result.replace(new RegExp(anonId, 'g'), realName);
    }
    return result;
  }

  /**
   * 重置映射（用于新课堂）
   */
  reset(): void {
    this.nameMap.clear();
    this.reverseMap.clear();
    this.counter = 1;
  }
}

// 单例
export const anonymizer = new Anonymizer();
