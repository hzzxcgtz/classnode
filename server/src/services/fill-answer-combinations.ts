/** Additional complete answers are keyed by stable blank IDs. The ordinary answers form combination 1. */
export interface FillAnswerCombination {
  id: string;
  answers: Record<string, string[]>;
}

export const MAX_FILL_ANSWER_COMBINATIONS = 20;

export function readFillAnswerCombinations(value: unknown): FillAnswerCombination[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.answers
      || typeof item.answers !== 'object' || Array.isArray(item.answers)) return [];
    const answers = Object.fromEntries(Object.entries(item.answers).map(([id, values]) => [id,
      Array.isArray(values) ? values.filter((text): text is string => typeof text === 'string') : [],
    ]));
    return [{ id: item.id, answers }];
  });
}

/**
 * 填空题的文本归一化。
 *
 * 🔴 **刻意不做大小写不敏感**（规格 §3-T）：化学式 / 英文填空的大小写是语义的一部分，
 * 把 `CO2` 判成 `co2` 正确比不判更糟。英文题请教师在 `answers` 里多列几个写法。
 */

export function normalizeFillText(raw: string): string {
  return raw.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\s+/g, ' ').trim();
}

/** Compare whole combinations. A tie prefers more correct blanks, then the first configured combination. */
export function bestFillCombination<T>(candidates: T[], weights: number[], matches: (candidate: T, index: number) => boolean): T {
  let best = candidates[0];
  let bestScore = -1;
  let bestHits = -1;
  for (const candidate of candidates) {
    let score = 0;
    let hits = 0;
    weights.forEach((weight, index) => {
      if (weight > 0 && matches(candidate, index)) { score += weight; hits++; }
    });
    if (score > bestScore || (score === bestScore && hits > bestHits)) {
      best = candidate;
      bestScore = score;
      bestHits = hits;
    }
  }
  return best;
}
