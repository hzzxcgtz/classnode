/** Separate numbered advice joined by semicolons without rewriting AI content. */
export function formatReviewAdvice(text: string): string {
  return text.replace(/[;；][ \t]*(?=\d+[.、．][ \t]*)/g, '\n');
}
export function reviewDurationLabel(milliseconds: number | null | undefined): string | null {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function reviewSourceLabel(source: string): string {
  return source === 'teacher' ? '教师主动评分' : '学生自主评分';
}
