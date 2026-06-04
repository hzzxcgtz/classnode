/** 检查内容中是否包含屏蔽词，返回过滤后的内容和匹配的屏蔽词列表 */
export function checkShieldWords(content: string, words: string[]): {
  filtered: string;
  matched: string[];
} {
  const matched: string[] = [];
  const seen = new Set<string>();
  let filtered = content;

  for (const word of words) {
    if (!word || seen.has(word)) continue;
    seen.add(word);
    try {
      const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      if (regex.test(content)) {
        matched.push(word);
        filtered = filtered.replace(regex, '*'.repeat(word.length));
      }
    } catch {
      // 忽略无效的正则
    }
  }

  return { filtered, matched };
}
