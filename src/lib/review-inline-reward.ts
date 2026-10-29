import { REWARD_STYLE_OPTIONS, pointsUnitLabel } from './worksheet-reward.ts';

/** Match only the generated per-blank score header, never numbers inside a student's prose. */
export function inlineReviewReward(line: string) {
  const match = /^(\s*第\s*\d+\s*空)\s*[（(](\d+)\s*([^（）()]+)[）)]([：:].*)$/.exec(line);
  if (!match) return null;
  const count = Number(match[2]);
  if (!Number.isSafeInteger(count)) return null;
  const kind = REWARD_STYLE_OPTIONS.find(option => option.value !== 'points' && pointsUnitLabel(option.value) === match[3].trim())?.value;
  return kind ? { prefix:match[1], count, kind, suffix:match[4], label:`${count} ${match[3].trim()}` } : null;
}
