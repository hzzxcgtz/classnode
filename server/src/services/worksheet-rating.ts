/** Generic rating collection. Stars express opinions and never award points. */
export interface RatingTextRun {
  start: number; end: number; blank: string;
  bold: boolean; italic: boolean; underline: boolean; emphasis: boolean; color: string;
}
/** Keep text formatting declarative; no HTML, links or layout objects enter rating labels. */
export function readRatingTextRuns(value: unknown, text: string): RatingTextRun[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    if (!Number.isInteger(row.start) || !Number.isInteger(row.end)) return [];
    const start = Math.max(0, Math.min(Number(row.start), text.length));
    const end = Math.max(start, Math.min(Number(row.end), text.length));
    return end > start ? [{ start, end, blank: '', bold: row.bold === true, italic: row.italic === true,
      underline: row.underline === true, emphasis: row.emphasis === true,
      color: typeof row.color === 'string' && /^#[0-9a-f]{6}$/i.test(row.color) ? row.color : '#1e293b' }] : [];
  });
}
export interface RatingConfig {
  maxStars: number;
  dimensions: Array<{ id: string; text: string; runs?: RatingTextRun[]; parentId?: string }>;
  commentEnabled: boolean;
  commentPrompt: string;
  commentPromptRuns?: RatingTextRun[];
  minCommentLength: number;
}
export interface RatingAnswer {
  format: 'rating/v1';
  maxStars: number;
  ratings: Record<string, number>;
  text: string;
}
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const RATING_DIMENSION_LIMIT = 60;
export function ratingConfig(data: Record<string, unknown>): RatingConfig {
  const raw = record(data.rating);
  const dimensions: RatingConfig['dimensions'] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(raw.dimensions) ? raw.dimensions.slice(0, RATING_DIMENSION_LIMIT) : []) {
    const item = record(value);
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const text = typeof item.text === 'string' ? item.text.slice(0, 100) : '';
    const runs = readRatingTextRuns(item.runs, text);
    dimensions.push({ id: item.id, text, ...(typeof item.parentId === 'string' && item.parentId ? { parentId: item.parentId } : {}), ...(runs.length ? { runs } : {}) });
  }
  // Invalid links become roots on read; the save validator rejects malformed trees.
  const byId = new Map(dimensions.map(d => [d.id, d]));
  const invalid = dimensions.filter(d => {
    const visited = new Set([d.id]);
    let current = d;
    let depth = 1;
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent || visited.has(parent.id) || ++depth > 3) return true;
      visited.add(parent.id);
      current = parent;
    }
    return false;
  });
  invalid.forEach(d => { delete d.parentId; });
  const commentPrompt = typeof raw.commentPrompt === 'string' ? raw.commentPrompt.slice(0, 500) : '';
  const commentPromptRuns = readRatingTextRuns(raw.commentPromptRuns, commentPrompt);
  return {
    maxStars: typeof raw.maxStars === 'number' && Number.isInteger(raw.maxStars) && raw.maxStars >= 1 && raw.maxStars <= 5 ? raw.maxStars : 3,
    dimensions,
    commentEnabled: raw.commentEnabled !== false,
    minCommentLength: typeof raw.minCommentLength === 'number' && Number.isInteger(raw.minCommentLength) && raw.minCommentLength >= 1 && raw.minCommentLength <= 10000 ? raw.minCommentLength : 1,
    commentPrompt,
    ...(commentPromptRuns.length ? { commentPromptRuns } : {}),
  };
}
/** Preorder rows shared by editing, answering, statistics and exports. */
export function ratingDimensionRows(config: RatingConfig) {
  type Dimension = RatingConfig['dimensions'][number];
  const rows: Array<Dimension & { depth: number; isLeaf: boolean; path: string }> = [];
  function visit(parentId: string | undefined, depth: number, path: string[]) {
    for (const dimension of config.dimensions.filter(d => d.parentId === parentId)) {
      const names = [...path, dimension.text];
      rows.push({ ...dimension, depth, isLeaf: !config.dimensions.some(d => d.parentId === dimension.id), path: names.join(' / ') });
      visit(dimension.id, depth + 1, names);
    }
  }
  visit(undefined, 0, []);
  return rows;
}
export function ratingLeafDimensions(config: RatingConfig) {
  return ratingDimensionRows(config).filter(d => d.isLeaf);
}
export function readRatingAnswer(data: Record<string, unknown>, value: unknown): RatingAnswer | null {
  const raw = record(value);
  if (raw.format !== 'rating/v1') return null;
  const config = ratingConfig(data);
  const source = record(raw.ratings);
  const ratings: Record<string, number> = {};
  if (raw.maxStars === config.maxStars) for (const dimension of ratingLeafDimensions(config)) {
    const stars = source[dimension.id];
    if (typeof stars === 'number' && Number.isInteger(stars) && stars >= 1 && stars <= config.maxStars) ratings[dimension.id] = stars;
  }
  const text = config.commentEnabled && typeof raw.text === 'string' ? raw.text.slice(0, 10000) : '';
  return Object.keys(ratings).length || text.trim() ? { format: 'rating/v1', maxStars: config.maxStars, ratings, text } : null;
}
export function ratingAnswerText(data: Record<string, unknown>, value: unknown): string | null {
  const answer = readRatingAnswer(data, value);
  if (!answer) return null;
  const config = ratingConfig(data);
  return [...ratingLeafDimensions(config).map((d, i) => `${d.path || `维度 ${i + 1}`}：${answer.ratings[d.id] ? `${answer.ratings[d.id]} / ${config.maxStars}` : '未评价'}`),
    ...(answer.text.trim() ? [`文字感想：${answer.text}`] : [])].join('\n');
}

/** Count Unicode characters without whitespace; saving a short draft remains valid. */
export function ratingCommentLength(text: string): number {
  return Array.from(text.replace(/\s/g, '')).length;
}
export function ratingSubmissionError(data: Record<string, unknown>, value: unknown): string | null {
  const config = ratingConfig(data);
  const answer = readRatingAnswer(data, value);
  const leaves = ratingLeafDimensions(config);
  const missing = leaves.filter(d => !answer?.ratings[d.id]).length;
  if (missing) return `还差 ${missing} 项`;
  if (config.commentEnabled) {
    const length = ratingCommentLength(answer?.text ?? '');
    if (!length) return config.minCommentLength > 1 ? `请填写文字感想，至少 ${config.minCommentLength} 字` : '请填写文字感想';
    if (length < config.minCommentLength) return `文字感想至少需要 ${config.minCommentLength} 字，目前 ${length} 字`;
  }
  return answer ? null : '请至少完成一项评价';
}

/** Short names keep monitoring cards and statistics focused on answers. */
export function ratingDimensionName(text: string, fallback = '评价维度'): string {
  return text.split(/[：:]/, 1)[0].trim() || fallback;
}
export function ratingResultSummary(data: Record<string, unknown>, value: unknown): string | null {
  const answer = readRatingAnswer(data, value);
  if (!answer) return null;
  const config = ratingConfig(data);
  return [...ratingLeafDimensions(config).map((d, i) => `${d.path.split(' / ').map(text => ratingDimensionName(text, `维度 ${i + 1}`)).join(' / ')}：${answer.ratings[d.id] ? `${answer.ratings[d.id]} / ${config.maxStars}` : '未评价'}`),
    ...(answer.text.trim() ? [`文字感想：${answer.text}`] : [])].join('\n');
}

/** Monitor cards show results without repeating group paths or every missing item. */
export function ratingCompactSummary(data: Record<string, unknown>, value: unknown): string | null {
  const answer = readRatingAnswer(data, value);
  if (!answer) return null;
  const config = ratingConfig(data);
  const leaves = ratingLeafDimensions(config);
  const names = leaves.map((d, i) => ratingDimensionName(d.text, `维度 ${i + 1}`));
  const rated = leaves.flatMap((d, i) => {
    const score = answer.ratings[d.id];
    if (!score) return [];
    const label = names.filter(name => name === names[i]).length > 1
      ? d.path.split(' / ').map(text => ratingDimensionName(text)).join(' / ')
      : names[i];
    return [`${label} ${score}/${config.maxStars}`];
  });
  const missing = leaves.length - rated.length;
  return [rated.join(' · '), ...(missing ? [`${missing} 项未评价`] : []),
    ...(answer.text.trim() ? [`感想：${answer.text.trim()}`] : [])].filter(Boolean).join('\n');
}

/** Existing results require the same scale and stable set of answerable dimension IDs. */
export function ratingScaleChanged(previous: Record<string, unknown>, next: Record<string, unknown>): boolean {
  const before = ratingConfig(previous), after = ratingConfig(next);
  const ids = (config: RatingConfig) => ratingLeafDimensions(config).map(d => d.id).sort();
  return before.maxStars !== after.maxStars || JSON.stringify(ids(before)) !== JSON.stringify(ids(after));
}

/** A legacy mismatched scale may be restored without rewriting or rescaling any answer. */
export function canRestoreRatingScale(previous: Record<string, unknown>, next: Record<string, unknown>, values: unknown[]): boolean {
  const before = ratingConfig(previous), after = ratingConfig(next);
  if (before.maxStars === after.maxStars || !values.length) return false;
  const ids = (config: RatingConfig) => ratingLeafDimensions(config).map(d => d.id).sort();
  if (JSON.stringify(ids(before)) !== JSON.stringify(ids(after))) return false;
  return values.every(value => record(value).maxStars === after.maxStars && readRatingAnswer(next, value) !== null);
}
