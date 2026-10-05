import { explicitFillGrading, type QuestionNode } from './worksheet-questions.js';
import { rubricTextOf } from './analysis-question.js';

export const AI_SCORE_MAX = 100;
export const AI_SCORE_CRITERIA_MAX = 1200;
export const AI_SCORE_ADVICE_MAX = 1200;
export const AI_SCORE_BLOCK_START = '<classnode-scores>';
export const AI_SCORE_BLOCK_END = '</classnode-scores>';

export interface AiScoringConfig {
  enabled: boolean;
  maxScore: number;
  unit: string;
  criteria: string;
  parts?: Array<{ index: number; maxScore: number }>;
}

export interface StoredAiScoring {
  maxScore: number;
  unit: string;
  criteria: string;
  parts?: Array<{ index: number; maxScore: number }>;
  scores: Array<{ studentId: string; score: number | null; reason: string; advice: string }>;
}

export interface StudentAiReferenceScore {
  score: number | null;
  maxScore: number;
  unit: string;
  /** 只返回当前学生自己的简短评分依据。 */
  comment: string;
  /** 学生主动展开后才显示的个性化改进建议。 */
  advice: string;
}

/** 分数档允许一位小数；奖杯、星星等图标奖励只能按完整个数发放。 */
function normalizeAiScore(score: number, config: AiScoringConfig): number {
  return config.unit === '分' ? Math.round(score * 10) / 10 : Math.round(score);
}

export function aiScoringConfigOf(node: QuestionNode, unit = '分'): AiScoringConfig {
  const fillParts = node.type === 'fill-blank' && node.autoGrade !== false
    ? explicitFillGrading(node.data).map((part, index) => ({ ...part, index })).filter(part => part.gradingMode === 'ai')
    : [];
  // 新版填空可以只把指定空交给 AI；题目级自动评分开关同时控制本地与 AI 评分。
  const subjective = node.type === 'short-answer' || node.type === 'drawing'
    || (node.type === 'fill-blank' && fillParts.length > 0);
  const enabled = subjective && (node.data.aiScoringEnabled === true || fillParts.length > 0);
  const rawMax = node.data.aiScoringMaxScore;
  const configuredMax = typeof rawMax === 'number' && Number.isInteger(rawMax) && rawMax >= 1 && rawMax <= AI_SCORE_MAX
    ? rawMax : 10;
  const maxScore = fillParts.length > 0 ? fillParts.reduce((sum, part) => sum + part.maxScore, 0) : configuredMax;
  // ★ 2026-10-05：「评分要求」与「评分标准」被教师合并成同一份东西了（见 `rubricTextOf`）
  // ⇒ 这里不再单独读 `aiScoringCriteria`。存下来的这一份是**给人看的**（结果面板那一行），
  // 超长截断；发给模型的那一份是载荷里的 `rubricText` 原文，不截断。
  const criteria = rubricTextOf(node).slice(0, AI_SCORE_CRITERIA_MAX);
  return { enabled, maxScore, unit, criteria, ...(fillParts.length > 0 ? {
    parts: fillParts.map(part => ({ index: part.index, maxScore: part.maxScore })),
  } : {}) };
}

/**
 * 把模型返回拆成「教师看的 Markdown」与「机器读的逐生分数」。机器块不会进入界面。
 * 开启评分时，缺块或有学生漏评都视为失败，调用方因此保留上一次完整结果。
 */
export function parseAiAnalysisResult(
  raw: unknown,
  config: AiScoringConfig,
  entries: Array<{ studentId: string; anonLabel: string }>,
): { narrative: string; perStudent: StoredAiScoring | null } | { error: string } {
  if (typeof raw !== 'string') return { error: '模型没有返回可用内容' };
  if (!config.enabled) return { narrative: raw, perStudent: null };

  const start = raw.lastIndexOf(AI_SCORE_BLOCK_START);
  const end = raw.lastIndexOf(AI_SCORE_BLOCK_END);
  if (start < 0 || end < start) return { error: '模型没有按约定返回 AI 评分数据（未写入）' };
  const jsonText = raw.slice(start + AI_SCORE_BLOCK_START.length, end).trim();
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); } catch { return { error: '模型返回的 AI 评分数据无法读取（未写入）' }; }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { scores?: unknown }).scores)) {
    return { error: '模型返回的 AI 评分数据格式不完整（未写入）' };
  }

  const byLabel = new Map(entries.map((entry) => [entry.anonLabel, entry.studentId]));
  const found = new Map<string, { studentId: string; score: number | null; reason: string; advice: string }>();
  for (const item of (parsed as { scores: unknown[] }).scores) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const studentId = typeof row.student === 'string' ? byLabel.get(row.student) : undefined;
    if (!studentId || found.has(studentId)) continue;
    const score = row.score === null
      ? null
      : typeof row.score === 'number' && Number.isFinite(row.score) && row.score >= 0 && row.score <= config.maxScore
        ? normalizeAiScore(row.score, config) : undefined;
    if (score === undefined) continue;
    const reason = typeof row.reason === 'string' ? row.reason.trim().slice(0, 200) : '';
    const advice = typeof row.advice === 'string' ? row.advice.trim().slice(0, AI_SCORE_ADVICE_MAX) : '';
    // 新协议要求“一句评价 + 详细建议”同时存在；缺一项就拒绝整次结果，避免学生页出现半张卡。
    if (!reason || !advice) continue;
    found.set(studentId, { studentId, score, reason, advice });
  }
  if (found.size !== entries.length) {
    return { error: `模型只返回了 ${found.size}/${entries.length} 份有效 AI 评分（未写入）` };
  }
  const narrative = `${raw.slice(0, start)}${raw.slice(end + AI_SCORE_BLOCK_END.length)}`.trim();
  return {
    narrative,
    perStudent: {
      maxScore: config.maxScore,
      unit: config.unit,
      criteria: config.criteria,
      ...(config.parts ? { parts: config.parts } : {}),
      scores: entries.map((entry) => found.get(entry.studentId)!),
    },
  };
}

/** 读 JSON 列时再次收口形状；旧版本或手工改坏的数据不会直接送到前端。 */
export function readStoredAiScoring(
  raw: unknown,
  config: AiScoringConfig,
  studentIds: string[],
): StoredAiScoring | null {
  if (!config.enabled || !raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (source.maxScore !== config.maxScore || !Array.isArray(source.scores)) return null;
  if (config.parts && JSON.stringify(source.parts) !== JSON.stringify(config.parts)) return null;
  // 老版本没有存单位；按当前学习单奖励形式补齐。新版本若教师换了奖励形式，则隐藏旧结果，
  // 避免把原来的“9 分”误画成“9 座奖杯”。
  if (typeof source.unit === 'string' && source.unit !== config.unit) return null;
  const known = new Set(studentIds);
  const scores: StoredAiScoring['scores'] = [];
  for (const item of source.scores) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (typeof row.studentId !== 'string' || !known.has(row.studentId)) return null;
    if (row.score !== null && (typeof row.score !== 'number' || !Number.isFinite(row.score)
      || row.score < 0 || row.score > config.maxScore)) return null;
    scores.push({
      studentId: row.studentId,
      // 旧数据里若已经存在半个奖杯，这里也按离散奖励归一化，避免再次显示出来。
      score: row.score === null ? null : normalizeAiScore(row.score as number, config),
      reason: typeof row.reason === 'string' ? row.reason.slice(0, 200) : '',
      // 兼容升级前的已保存结果：旧数据没有 advice，仍可显示原来的一句评价。
      advice: typeof row.advice === 'string' ? row.advice.slice(0, AI_SCORE_ADVICE_MAX) : '',
    });
  }
  if (scores.length !== studentIds.length || new Set(scores.map((item) => item.studentId)).size !== studentIds.length) return null;
  return {
    maxScore: config.maxScore,
    unit: config.unit,
    criteria: typeof source.criteria === 'string' ? source.criteria.slice(0, AI_SCORE_CRITERIA_MAX) : '',
    ...(config.parts ? { parts: config.parts } : {}),
    scores,
  };
}

/**
 * 只取某一名学生自己的 AI 评分与简短评语。学生端不允许拿到同班其他人的评分与理由。
 * 与教师端的完整读取不同，这里不要求传入全体 studentIds；否则为了读一个人的分数，
 * 学生端接口反而必须先知道整班名单。
 */
export function readStudentAiReferenceScore(
  raw: unknown,
  config: AiScoringConfig,
  studentId: string,
): StudentAiReferenceScore | null {
  if (!config.enabled || !raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (source.maxScore !== config.maxScore || !Array.isArray(source.scores)) return null;
  if (config.parts && JSON.stringify(source.parts) !== JSON.stringify(config.parts)) return null;
  if (typeof source.unit === 'string' && source.unit !== config.unit) return null;
  const item = source.scores.find((candidate) => candidate && typeof candidate === 'object'
    && (candidate as Record<string, unknown>).studentId === studentId);
  if (!item || typeof item !== 'object') return null;
  const score = (item as Record<string, unknown>).score;
  if (score !== null && (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > config.maxScore)) return null;
  return {
    score: score === null ? null : normalizeAiScore(score, config),
    maxScore: config.maxScore,
    unit: config.unit,
    comment: typeof (item as Record<string, unknown>).reason === 'string'
      ? ((item as Record<string, unknown>).reason as string).trim().slice(0, 200)
      : '',
    advice: typeof (item as Record<string, unknown>).advice === 'string'
      ? ((item as Record<string, unknown>).advice as string).trim().slice(0, AI_SCORE_ADVICE_MAX)
      : '',
  };
}
