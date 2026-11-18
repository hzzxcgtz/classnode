export const RECENT_TEXT_COLOR_LIMIT = 8;
export function recentTextColors(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).map(c => c.toLowerCase()))].slice(0, RECENT_TEXT_COLOR_LIMIT) : [];
}
export function pushRecentTextColor(previous: readonly string[], color: string): string[] {
  return recentTextColors([color, ...previous]);
}
