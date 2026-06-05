/**
 * Aho-Corasick 自动机 + Intl.Segmenter 词边界校验
 *
 * 解决"屏蔽词出现在非目标词中"的误报问题（如"妈的"不匹配"妈妈的衣服"）
 *
 * 匹配策略:
 *   1. AC 自动机快速扫描出所有子串匹配
 *   2. 对每个匹配位置，用 Intl.Segmenter 判断是否对齐到词边界
 *   3. 匹配必须完整覆盖一个或多个词，才算有效命中
 */

interface Match {
  start: number;
  end: number;
  word: string;
}

/** 模块级缓存，避免每次调用都创建 segmenter 实例 */
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

/**
 * 获取文本中所有词边界位置（每个 segment 的起始位置 + text.length）
 * 用于后续判断 AC 匹配是否对齐到词边界
 */
function getWordBoundaries(text: string): Set<number> {
  const bounds = new Set<number>();
  bounds.add(0);
  for (const seg of segmenter.segment(text)) {
    bounds.add(seg.index + seg.segment.length);
  }
  return bounds;
}

class AhoCorasick {
  private gotoFn: Record<string, number>[];
  private failureLink: number[];
  private output: string[][];
  private stateCount: number;

  constructor(patterns: string[]) {
    this.gotoFn = [{}];
    this.failureLink = [0];
    this.output = [[]];
    this.stateCount = 1;

    // 1. 构建 Trie
    const seen = new Set<string>();
    for (const pattern of patterns) {
      if (!pattern || seen.has(pattern)) continue;
      seen.add(pattern);
      let state = 0;
      for (const char of pattern) {
        if (this.gotoFn[state][char] === undefined) {
          this.gotoFn[state][char] = this.stateCount;
          this.gotoFn.push({});
          this.failureLink.push(0);
          this.output.push([]);
          this.stateCount++;
        }
        state = this.gotoFn[state][char];
      }
      this.output[state].push(pattern);
    }

    // 2. 构建失败指针（BFS）
    const queue: number[] = [];
    for (const char in this.gotoFn[0]) {
      const state = this.gotoFn[0][char];
      this.failureLink[state] = 0;
      queue.push(state);
    }

    while (queue.length > 0) {
      const r = queue.shift()!;
      for (const char in this.gotoFn[r]) {
        const s = this.gotoFn[r][char];
        queue.push(s);
        let f = this.failureLink[r];
        while (f !== 0 && this.gotoFn[f][char] === undefined) {
          f = this.failureLink[f];
        }
        this.failureLink[s] = this.gotoFn[f][char] ?? 0;
        if (this.output[this.failureLink[s]].length > 0) {
          this.output[s] = [...this.output[s], ...this.output[this.failureLink[s]]];
        }
      }
    }
  }

  /** 搜索 text 中所有匹配的模式，返回匹配结果 */
  search(text: string): {
    matched: string[];
    positions: Match[];
  } {
    const matchedSet = new Set<string>();
    const positions: Match[] = [];
    let state = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      while (state !== 0 && this.gotoFn[state][char] === undefined) {
        state = this.failureLink[state];
      }
      state = this.gotoFn[state][char] ?? 0;

      for (const word of this.output[state]) {
        if (!matchedSet.has(word)) {
          matchedSet.add(word);
        }
        positions.push({ start: i - word.length + 1, end: i, word });
      }
    }

    return { matched: [...matchedSet], positions };
  }
}

/** 对指定位置区间进行 * 替换 */
function mask(text: string, positions: { start: number; end: number }[]): string {
  if (positions.length === 0) return text;

  // 按 start 排序，相同 start 取最长
  const sorted = [...positions].sort((a, b) => a.start - b.start || (b.end - a.end));

  // 合并重叠/相邻区间
  const merged: { start: number; end: number }[] = [];
  for (const p of sorted) {
    if (merged.length === 0 || p.start > merged[merged.length - 1].end + 1) {
      merged.push({ start: p.start, end: p.end });
    } else if (p.end > merged[merged.length - 1].end) {
      merged[merged.length - 1].end = p.end;
    }
  }

  const chars = text.split('');
  for (const m of merged) {
    for (let i = m.start; i <= m.end; i++) {
      chars[i] = '*';
    }
  }
  return chars.join('');
}

/**
 * 检查内容中是否包含屏蔽词，返回过滤后的内容和匹配的屏蔽词列表
 *
 * 结合 AC 自动机（多模式匹配）和 Intl.Segmenter（中文分词边界）：
 * - 高效：一次扫描 O(|text| + ∑|pattern|)
 * - 准确：减少"妈的"匹配"妈妈的衣服"这类误报
 */
export function checkShieldWords(content: string, words: string[]): {
  filtered: string;
  matched: string[];
} {
  if (!content || words.length === 0) {
    return { filtered: content || '', matched: [] };
  }

  const ac = new AhoCorasick(words);
  const { positions } = ac.search(content);
  if (positions.length === 0) {
    return { filtered: content, matched: [] };
  }

  // 词边界校验：只保留对齐到词边界的匹配
  const boundaries = getWordBoundaries(content);
  const valid = positions.filter(p =>
    boundaries.has(p.start) && boundaries.has(p.end + 1),
  );

  if (valid.length === 0) {
    return { filtered: content, matched: [] };
  }

  const matched = [...new Set(valid.map(p => p.word))];
  const filtered = mask(content, valid);
  return { filtered, matched };
}

/**
 * 预构建过滤器（当词库固定且需要频繁调用时使用）
 * 避免每次调用都重新构建自动机
 */
export function buildShieldFilter(words: string[]): (content: string) => {
  filtered: string;
  matched: string[];
} {
  const ac = new AhoCorasick(words);
  return (content: string) => {
    const { positions } = ac.search(content);
    if (positions.length === 0) return { filtered: content, matched: [] };

    const boundaries = getWordBoundaries(content);
    const valid = positions.filter(p =>
      boundaries.has(p.start) && boundaries.has(p.end + 1),
    );

    if (valid.length === 0) return { filtered: content, matched: [] };

    const matched = [...new Set(valid.map(p => p.word))];
    return { filtered: mask(content, valid), matched };
  };
}
