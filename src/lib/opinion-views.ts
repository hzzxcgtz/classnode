export type OpinionPhrase = { phrase: string; studentIds: string[] };
export const OPINION_CLOUD_LIMIT = 10;
/** Frequency counts people once; ordering expresses prevalence, never quality. */
export function rankedOpinions(phrases: readonly OpinionPhrase[]): OpinionPhrase[] {
  const merged = new Map<string, OpinionPhrase>();
  for (const item of phrases) {
    const phrase = item.phrase.trim().replace(/\s+/g, ' ');
    if (!phrase) continue;
    const key = phrase.toLowerCase();
    const previous = merged.get(key);
    const studentIds = [...new Set([...(previous?.studentIds ?? []), ...item.studentIds])];
    if (studentIds.length) merged.set(key, { phrase: previous?.phrase ?? phrase, studentIds });
  }
  return [...merged.values()].sort((a, b) => b.studentIds.length - a.studentIds.length);
}
