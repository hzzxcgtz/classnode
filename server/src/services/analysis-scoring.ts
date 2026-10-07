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
  /**
   * ★ 2026-10-07：**还没有分的学生**（模型漏了、或分数越界、或缺评价/建议）。
   * 由写入那一侧算好存进来，教师面板据此显示「本次只拿到 X/Y，缺：…」。
   */
  missing?: string[];
}

/**
 * 两份评分结果的**口径**是不是同一套（满分 / 单位 / 评分项）。
 * ⚠️ 教师改了满分或单位之后，旧分本来就对不上（读取那一侧也按这条拒收）——
 *    合并时要认同一件事，否则会把两套口径的分数混在一起。
 */
export function sameScoringBasis(a: StoredAiScoring, b: StoredAiScoring): boolean {
  return a.maxScore === b.maxScore && a.unit === b.unit
    && JSON.stringify(a.parts ?? null) === JSON.stringify(b.parts ?? null);
}

/**
 * 把这一轮的结果**并进**已存的那份（★ 2026-10-07 教师：40 人那份要能补跑）。
 *
 * · 同一个人：以**新**的为准；
 * · 这一轮**没拿到分**的人：**保留上一轮已经拿到的分** ——
 *   否则每补跑一次，就把之前拿到的那批丢掉一批（40 人班上模型每次漏的人还不一样，
 *   那样永远凑不齐）；
 * · 口径不一致（教师改了满分 / 单位 / 评分项）：旧分不并 —— 它们本来就对不上口径；
 * · 顺序按 `order`（这一轮的名单）排，读出来的那一列才稳定。
 */
export function mergeAiScoring(
  previous: StoredAiScoring | null,
  next: StoredAiScoring | null,
  order: string[],
): StoredAiScoring | null {
  if (!next) return previous;
  if (!previous || !sameScoringBasis(previous, next)) return next;
  const byId = new Map(previous.scores.map((row) => [row.studentId, row]));
  for (const row of next.scores) byId.set(row.studentId, row);
  const ranked = order.length > 0 ? order : [...byId.keys()];
  const ordered = ranked.map((studentId) => byId.get(studentId)).filter((row): row is NonNullable<typeof row> => !!row);
  return { ...next, scores: ordered };
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

/**
 * ★ 2026-10-07（教师决定 2：「AI 的评分是要写回的，要参与总分的统计」）——
 * 把 AI 给的分（满分是 **AI 自己的**满分）折成**这道题的得分**，连同三态一起给出。
 *
 * 🔴 **三个数一起给**：`score` 与 `gradeState` **同生共死**（`worksheets.ts` 那条唯一
 *   判分路径上的规矩），只写一个会让读的一侧去猜。`isCorrect` 与本地判分同一口径
 *   （语义早已收窄为「全对」）。
 *
 * 🔴 **取整**，不保留小数：奖励是按 `score` 的**绝对值**画的（`worksheet-reward.ts` 的
 *   `rewardAmount` 直接返回它），而符号档画的是 `symbol.repeat(amount)` —— `repeat` 把 8.4
 *   截成 8，于是同一件事有两个数（画 8 颗星、旁边写 `×8.4`）。本地判分也从不产生小数。
 *
 * ⚠️ **不往 `{ 0, half, full }` 上贴**：教师自己给的例子（题目 10 分、AI 给 4/5 ⇒ 记 8 分）
 *   就否掉了那一条 —— 8 既不是 0、也不是半对档。
 * ⚠️ 三态只看「是不是顶到 `full` / 落到 0」，**不看题目的 `half`**：`half` 是**本地判分器**
 *   给部分分用的档，而 AI 给的是连续分。
 */
export function answerGradeFromAiScore(
  aiScore: number,
  aiMaxScore: number,
  full: number,
): { isCorrect: boolean; gradeState: 'correct' | 'partial' | 'incorrect'; score: number } {
  const ratio = aiMaxScore > 0 ? aiScore / aiMaxScore : 0;
  const bounded = Number.isFinite(ratio) ? ratio : 0;
  const score = Math.max(0, Math.min(full, Math.round(bounded * full)));
  const gradeState = score >= full ? 'correct' : score <= 0 ? 'incorrect' : 'partial';
  return { isCorrect: gradeState === 'correct', gradeState, score };
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
 *
 * ★ 2026-10-07（教师：全班 40 人怎么一起交给智能体）—— 原来是**全有或全无**：
 *   缺块、或有一个学生漏评/分数越界 ⇒ **整次作废**。那个口径在 40 人这个规模上要命：
 *   模型少写一行，教师等满约三分钟只等到「分析失败」，**一个学生的分都不落库**。
 * ✅ 现在：**拿到几份存几份**，并把缺的那几个（`missing`）点名报出来给调用方 ——
 *   教师据此补跑。⚠️ 「不能只给半张卡」那条纪律没变：**缺评价或缺建议的那一行仍然不算数**
 *   （那个人进 `missing`），只是不再牵连全班。
 * ⚠️ 一份有效分都没有时 `perStudent` 回 `null`（解读照存）—— 调用方负责把新分数**并进**
 *   已存的那份，别把上一轮已经拿到的分覆盖没了。
 */
export function parseAiAnalysisResult(
  raw: unknown,
  config: AiScoringConfig,
  /**
   * ★ 2026-10-07：多了个可选的 `name` —— 模型**可能只回姓名**（把 `#7` 丢掉）。
   *   只在「本轮名单里**唯一**」时认它；不唯一就不认（那个人进 `missing`）。
   */
  entries: Array<{ studentId: string; anonLabel: string; name?: string }>,
): { narrative: string; perStudent: StoredAiScoring | null; missing: string[] } | { error: string } {
  if (typeof raw !== 'string') return { error: '模型没有返回可用内容' };
  if (!config.enabled) return { narrative: raw, perStudent: null, missing: [] };

  /*
   * ⚠️ 机器块缺失/读不出来时**不再作废整次** —— 解读（教师看得懂的那半）是独立的一份，
   *    该留住。分数这边退回「一份都没有」，由 `missing` 把全班列出来，教师据此补跑。
   */
  const start = raw.lastIndexOf(AI_SCORE_BLOCK_START);
  const end = raw.lastIndexOf(AI_SCORE_BLOCK_END);
  const blockScores = (() => {
    if (start < 0 || end < start) return null;
    try {
      const parsed: unknown = JSON.parse(raw.slice(start + AI_SCORE_BLOCK_START.length, end).trim());
      const rows = (parsed as { scores?: unknown } | null)?.scores;
      return Array.isArray(rows) ? rows : null;
    } catch { return null; }
  })();
  const narrative = (start >= 0 && end > start
    ? `${raw.slice(0, start)}${raw.slice(end + AI_SCORE_BLOCK_END.length)}`
    : raw).trim();
  if (!narrative) return { error: '模型没有返回可用内容' };

  const byLabel = new Map(entries.map((entry) => [entry.anonLabel, entry.studentId]));
  /*
   * ★ 2026-10-07（标签改用「姓名 + 学号」之后新增）—— **姓名别名**。
   *   模型偶尔会把 `张伟#7` 写成 `张伟`（丢掉 `#学号`）⇒ 整班收不到分，
   *   而教师只看到一句「本次只拿到 0/N」。代价太大，所以认。
   * 🔴 但**只在唯一时**认：`nameCount !== 1` 就不放进来 ⇒ 那个人落进 `missing`，
   *   教师看得见（**响亮地失败**）—— 这正是换标签的目的。
   * ⚠️ 与标签撞车的名字也不放（`byLabel.has`）：那说明名册本身有病，不在这里替它做主。
   */
  const nameCount = new Map<string, number>();
  for (const entry of entries) {
    if (entry.name) nameCount.set(entry.name, (nameCount.get(entry.name) ?? 0) + 1);
  }
  for (const entry of entries) {
    if (!entry.name || nameCount.get(entry.name) !== 1 || byLabel.has(entry.name)) continue;
    byLabel.set(entry.name, entry.studentId);
  }
  const found = new Map<string, { studentId: string; score: number | null; reason: string; advice: string }>();
  for (const item of blockScores ?? []) {
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
    // 「一句评价 + 详细建议」缺一不可：缺的那一行**不算数**（学生那边不能只看到半张卡），
    // ★ 但只丢这一行 —— 其余照存（原来这里是整次作废，40 人的班上等于全丢）。
    if (!reason || !advice) continue;
    found.set(studentId, { studentId, score, reason, advice });
  }
  const scores = entries.map((entry) => found.get(entry.studentId)).filter((row): row is NonNullable<typeof row> => !!row);
  return {
    narrative,
    perStudent: scores.length === 0 ? null : {
      maxScore: config.maxScore,
      unit: config.unit,
      criteria: config.criteria,
      ...(config.parts ? { parts: config.parts } : {}),
      scores,
    },
    missing: entries.filter((entry) => !found.has(entry.studentId)).map((entry) => entry.studentId),
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
  /*
   * ★ 2026-10-07（教师：40 人一起交给智能体）—— 这里原来要求 `scores.length === studentIds.length`：
   *   **读的时候也要求「一个都不能少」**。而写入那一侧已经改成「拿到几份存几份」了 ⇒
   *   部分结果**存得进、读不出**：面板上一片空白，而且**不报错**（比存不进去更难查）。
   * ✅ 去掉那条完整性要求：逐行校验照旧（越界分数、名字对不上仍然整份拒收），
   *   「还缺谁」由写入那一侧算好存在 `missing` 里带给界面。
   */
  if (new Set(scores.map((item) => item.studentId)).size !== scores.length) return null;
  /* ★ 2026-10-07：「还缺谁」也一起读出来 —— 教师面板靠它提示「本次只拿到 X/Y」。 */
  const missing = Array.isArray(source.missing)
    ? source.missing.filter((id): id is string => typeof id === 'string' && known.has(id))
    : [];
  return {
    maxScore: config.maxScore,
    unit: config.unit,
    criteria: typeof source.criteria === 'string' ? source.criteria.slice(0, AI_SCORE_CRITERIA_MAX) : '',
    ...(config.parts ? { parts: config.parts } : {}),
    scores,
    ...(missing.length > 0 ? { missing } : {}),
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
