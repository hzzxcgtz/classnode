// ⚠️ **相对路径 + `.ts` 后缀**（不是 `@/…`）：本文件要被 `node --test` 直接跑。
// 与 `worksheet-tile-state.ts` / `worksheet-drawer-state.ts` 同一条写法。
import {
  draftFromValue,
  readCategorizeItems,
  readCategorizeZones,
  readMatchLeft,
  readMatchRight,
  readOptions,
  readOrderItems,
  TRUE_FALSE_OPTIONS,
  type WorksheetEntry,
} from '../../../lib/worksheet-questions.ts';
import { readPairs, readPlacement } from '../../../lib/worksheet-answer-view.ts';
import { isGradedType, rowVerdict } from './worksheet-drawer-state.ts';

/**
 * 「按题统计与分析」的**判据层** —— 纯函数，不碰 React / DOM / 网络。
 *
 * 规格：`specs/2026-09-28-按题统计与分析.md`（教师：这一块「非常重要」）。
 *
 * ── 🔴 本文件唯一的硬线：**只计数，不判分**（规格 §3）────────────────────
 *   · **判分档**（全对 / 部分 / 错 / 未判）**一律读行里已有的 `gradeState`**，
 *     走 `rowVerdict`（那一份的优先级与兜底在 `worksheet-drawer-state.ts` 里有完整理由）
 *     —— 本地**绝不重算**。排序带**容差**（服务端 `judgeOrder` 的 `meetsTolerance`）、
 *     填空有**多个可接受答案**：重算就是**第二份判分实现**，服务端改了它不会跟着变，
 *     而两边都不报错。
 *   · **分布计数**（谁选了 B、谁把「水」连到「CO2」）**没有规则可写错** —— 那是纯粹的
 *     数数，所以本地算。
 *
 * ── 口径（每一条都会出现在屏幕上，错了不报错）──────────────────────────
 *   · 🔴 **只数 `submitted` 的行**：草稿还在变，混进去会让分布一直跳；
 *   · 🔴 **每个百分比都要写得出分母**：所以下面每一条文字都从「已交 N 人」出发，
 *     **不许**出现裸的百分比（本仓反复栽在分母口径上）；
 *   · ⚠️ 分母是**参与者数**（高级/分组模式下是组），量词由界面按课堂 mode 定。
 */

/** 一根横条。`correct` 只在有正确答案的题型上有意义（界面据此标绿）。 */
export interface Bar {
  label: string;
  count: number;
  /** 这一项是正确答案（选项题、排序的某一位）。 */
  correct?: boolean;
}

/** 一格矩阵的值（连线左×右、归类条目×框）。 */
export interface MatrixCell {
  rowId: string;
  colId: string;
  count: number;
  /** ★ 这一格是不是**正确答案**那一格（纯集合判定，见文件头）。 */
  correct: boolean;
}

export type QuestionDistribution =
  /** 单选 / 多选 / 判断：逐选项 + （多选）选答组合。 */
  | { kind: 'options'; bars: Bar[]; combos: Bar[] }
  /** 填空（含表格）：逐空的高频答案。 */
  | { kind: 'blanks'; blanks: Array<{ label: string; bars: Bar[]; distinct: number }> }
  /** 排序：每一位有多少人排对 + 最常见的顺序。 */
  | { kind: 'order'; positions: Array<{ index: number; hits: number }>; topOrders: Bar[] }
  /** 连线：左 × 右矩阵。 */
  | { kind: 'match'; left: WorksheetEntry[]; right: WorksheetEntry[]; cells: MatrixCell[] }
  /** 归类：条目 × 框矩阵。 */
  | { kind: 'categorize'; items: WorksheetEntry[]; zones: WorksheetEntry[]; cells: MatrixCell[] }
  /** 问答：字数分布（字数区间，不做判分）。 */
  | { kind: 'text'; lengths: Bar[] }
  /** 绘图：这一屏交给智能体（规格 §6.2），本地只报「几个人画了」。 */
  | { kind: 'ink'; drawn: number }
  /** 这一型本期没有分布图。 */
  | null;

/** 一句话说明。`level` 只影响配色，**不改措辞**。 */
export interface Insight {
  level: 'good' | 'warn' | 'info';
  text: string;
}

/** ★ 过程统计（教师已批准保留，规格 §4.2）。旧行三列是 `NULL` ⇒ `null` = 不知道。 */
export interface ProcessStats {
  /** 用时的中位数（ms）；`null` = **一行都没有 `createdAt`/`savedAt`**（旧行）。 */
  medianMs: number | null;
  /** 修改次数的中位数；`null` = 没有一行有 `saveCount`。 */
  medianSaves: number | null;
  /** 还没交的参与者（界面点名字跳过去）。 */
  notSubmitted: string[];
}

export interface QuestionStats {
  /** 参与者数（分母）。 */
  total: number;
  submitted: number;
  correct: number;
  partial: number;
  wrong: number;
  /** 已提交但**没有判分**（主观题 / 关闭自动判分）。 */
  noVerdict: number;
  unanswered: number;
  /** 0–100 的整数；`null` = 没有已判过的行（界面显示「—」）。 */
  accuracy: number | null;
  distribution: QuestionDistribution;
  insights: Insight[];
  process: ProcessStats;
}

/** 一行作答里本模块要用的字段（**刻意只声明用到的**，免得读的人以为还有别的）。 */
export interface StatsRow {
  participantId: string;
  participantName: string;
  status: string;
  isCorrect: boolean | null;
  gradeState: string | null;
  value: unknown;
  createdAt: string | null;
  savedAt: string | null;
  saveCount: number | null;
}

/** 条目表的文本查表；查不到退回 id（与呈现层同一条纪律）。 */
function textOf(entries: readonly WorksheetEntry[], id: string): string {
  return entries.filter((entry) => entry.id === id)[0]?.text || id;
}

/** 把「值 → 出现次数」排成降序的横条；并列时按文本升序（**结果稳定**，否则每次刷新顺序会跳）。 */
function toBars(counts: Map<string, number>, limit = Infinity): Bar[] {
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** 累计一个 key 的出现次数。 */
function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** 中位数（偶数个取中间两个的平均，再四舍五入到整数）。空数组回 `null`。 */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** 填空答案的计数键：**trim 前后空白，不合并大小写**（理由见规格 §4.1 —— 合并要有规则）。 */
function blankKey(text: string): string {
  return text.trim();
}

/**
 * 一道题的统计。
 *
 * @param node 题目节点（教师端那一份**含答案**，从不外发）
 * @param rows 这一题上**每个参与者**的作答行（**没作答的也要占一格** —— 分母是参与者数）
 */
export function questionStats(
  node: Parameters<typeof draftFromValue>[0],
  rows: ReadonlyArray<StatsRow | undefined>,
): QuestionStats {
  let submitted = 0;
  let correct = 0;
  let partial = 0;
  let wrong = 0;
  let noVerdict = 0;
  let unanswered = 0;
  let graded = 0;
  const notSubmitted: string[] = [];
  const durations: number[] = [];
  const saveCounts: number[] = [];

  // 🔴 **只收「已交」的行**参与分布计数（草稿还在变）。
  const submittedRows: StatsRow[] = [];
  for (const row of rows) {
    if (!row) { unanswered += 1; continue; }
    const status = row.status === 'submitted' ? 'submitted' : row.status === 'draft' ? 'draft' : 'unanswered';
    if (status === 'unanswered') { unanswered += 1; notSubmitted.push(row.participantName); continue; }
    if (status === 'draft') { unanswered += 1; notSubmitted.push(row.participantName); continue; }

    submitted += 1;
    submittedRows.push(row);
    // 判分档：**读行里的**（`rowVerdict`），本地不重算。
    const verdict = isGradedType(node.type) ? rowVerdict(row as never) : null;
    if (verdict !== null) {
      graded += 1;
      if (verdict === 'correct') correct += 1;
      else if (verdict === 'partial') partial += 1;
      else wrong += 1;
    } else {
      noVerdict += 1;
    }

    // 过程统计（★ 教师批准保留）：`NULL` = 不知道 ⇒ 不收进样本。
    const created = row.createdAt ? Date.parse(row.createdAt) : Number.NaN;
    const saved = row.savedAt ? Date.parse(row.savedAt) : Number.NaN;
    if (Number.isFinite(created) && Number.isFinite(saved) && saved >= created) durations.push(saved - created);
    if (typeof row.saveCount === 'number' && Number.isFinite(row.saveCount)) saveCounts.push(row.saveCount);
  }

  const total = rows.length;
  const distribution = buildDistribution(node, submittedRows);
  return {
    total,
    submitted,
    correct,
    partial,
    wrong,
    noVerdict,
    unanswered,
    // ⚠️ 正确率的分母是**已判过的行数**（不是参与者数、也不是已交人数）——
    // 与 `questionAggregate` 逐字同源，两处各写一份口径会分叉。
    accuracy: graded > 0 ? Math.round((correct / graded) * 100) : null,
    distribution,
    insights: buildInsights({ node, total, submitted, correct, partial, wrong, noVerdict, graded, distribution, submittedRows }),
    process: { medianMs: median(durations), medianSaves: median(saveCounts), notSubmitted },
  };
}

/** 逐题型的分布。**这一层只数数**（见文件头）。 */
function buildDistribution(
  node: Parameters<typeof draftFromValue>[0],
  submittedRows: ReadonlyArray<StatsRow>,
): QuestionDistribution {
  if (submittedRows.length === 0) return null;

  // ── 选项族（单选 / 多选 / 判断）──────────────────────────────────────
  // 判据是**读回来的形状**（`draft.kind`），不是 `node.type` —— 教师把一道题从排序改成
  // 单选之后，学生**之前交的**那份排序仍然要按排序统计（库里那一行没变）。与 `answerView` 同源。
  const kinds = new Set(submittedRows.map((row) => draftFromValue(node, row.value).kind));

  if (kinds.size === 1 && kinds.has('choice')) {
    // 判断题**不存 options**（`data` 里只有 `correctKeys`）⇒ 必须走常量，
    // 否则一道判断题一个选项都数不出来，而屏幕上看起来只是「这道题没有选项」。
    const options = node.type === 'true-false' ? TRUE_FALSE_OPTIONS : readOptions(node);
    const correctKeys = Array.isArray(node.data?.correctKeys)
      ? (node.data.correctKeys as unknown[]).filter((key): key is string => typeof key === 'string')
      : [];
    const perOption = new Map<string, number>();
    const perCombo = new Map<string, number>();
    for (const row of submittedRows) {
      const draft = draftFromValue(node, row.value);
      if (draft.kind !== 'choice') continue;
      draft.selected.forEach((key) => bump(perOption, key));
      // 🔴 组合的 key 必须**排序后 join**：不排的话 `AB` 与 `BA` 会算成两组，
      // 而教师在屏幕上看到的是同一个组合被拆成两行。
      bump(perCombo, [...draft.selected].sort().join(''));
    }
    return {
      kind: 'options',
      bars: options.map((option) => ({
        label: `${option.key}. ${option.text || option.key}`,
        count: perOption.get(option.key) ?? 0,
        correct: correctKeys.includes(option.key),
      })),
      // 组合那张表**只在多选时有意义**（单选/判断的组合恒等于选项本身）。
      combos: node.type === 'multi-choice' ? toBars(perCombo, 3) : [],
    };
  }

  // ── 填空（含表格）──────────────────────────────────────────────────
  if (kinds.size === 1 && kinds.has('fill')) {
    // ⚠️ **刻意不读 `data.answers`**（标准答案）：裁定 ① 让填空只做**频次分布**，
    // 而一旦把标准答案读进来，下一个人就会顺手判「这个写法对不对」—— 那正是
    // 本模块拒绝的第二份判分实现。`readAnswerSets` 的导入也一并删了。
    /** 空数由**题目当下**的题干推（`draftFromValue` 已经把 `texts` 对齐到它）。 */
    const blanks: Array<{ label: string; bars: Bar[]; distinct: number }> = [];
    const first = draftFromValue(node, submittedRows[0].value);
    const count = first.kind === 'fill' ? first.texts.length : 0;
    for (let index = 0; index < count; index += 1) {
      const counts = new Map<string, number>();
      for (const row of submittedRows) {
        const draft = draftFromValue(node, row.value);
        if (draft.kind !== 'fill') continue;
        const key = blankKey(draft.texts[index] ?? '');
        // ⚠️ **留空的不计数**（它不是一种「写法」）。但界面上要另说有多少人留空 ——
        // 那由 `submitted - 各写法人数之和` 读得出来，不在这里补一个假答案。
        if (key === '') continue;
        bump(counts, key);
      }
      blanks.push({
        label: `第 ${index + 1} 空`,
        bars: toBars(counts, 5),
        distinct: counts.size,
      });
    }
    return { kind: 'blanks', blanks };
  }

  // ── 排序 ───────────────────────────────────────────────────────────
  if (kinds.size === 1 && kinds.has('order')) {
    const items = readOrderItems(node);
    const correctOrder = Array.isArray(node.data?.correctOrder)
      ? (node.data.correctOrder as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    const hits = new Array(correctOrder.length).fill(0) as number[];
    const orders = new Map<string, number>();
    for (const row of submittedRows) {
      const draft = draftFromValue(node, row.value);
      if (draft.kind !== 'order') continue;
      // ★ 「排对」= 该位与学生答案**逐字相同**。⚠️ 这是**计数**，不是判分 ——
      // 服务端的「部分给分」带容差（`meetsTolerance`），本地不算那一档（文件头）。
      // 但**完全正确**那一档是纯等式（长度相同 + 每位相同），本地与服务端逐字一致 ——
      // 即便如此本模块也不拿它当判分结论，页头那四格读的仍是 `gradeState`。
      draft.order.forEach((id, index) => {
        if (index < hits.length && id === correctOrder[index]) hits[index] += 1;
      });
      bump(orders, draft.order.map((id) => textOf(items, id)).join(' → '));
    }
    return {
      kind: 'order',
      positions: hits.map((hit, index) => ({ index, hits: hit })),
      topOrders: toBars(orders, 3),
    };
  }

  // ── 连线 ───────────────────────────────────────────────────────────
  if (kinds.size === 1 && kinds.has('match')) {
    const left = readMatchLeft(node);
    const right = readMatchRight(node);
    const pairs = readPairs(node);
    const isCorrectPair = (leftId: string, rightId: string) =>
      pairs.some((pair) => pair.leftId === leftId && pair.rightId === rightId);
    const counts = new Map<string, number>();
    for (const row of submittedRows) {
      const draft = draftFromValue(node, row.value);
      if (draft.kind !== 'match') continue;
      // ⚠️ 重复的同一对只算一次（否则「一条左项连了两个右项」的矛盾作答会把那一对算两次）。
      const seen = new Set<string>();
      for (const link of draft.links) {
        const key = `${link.leftId} ${link.rightId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        bump(counts, key);
      }
    }
    return {
      kind: 'match',
      left,
      right,
      cells: [...counts.entries()].map(([key, count]) => {
        const [rowId, colId] = key.split(' ');
        return { rowId, colId, count, correct: isCorrectPair(rowId, colId) };
      }),
    };
  }

  // ── 归类 ───────────────────────────────────────────────────────────
  if (kinds.size === 1 && kinds.has('categorize')) {
    const items = readCategorizeItems(node);
    const zones = readCategorizeZones(node);
    const placement = readPlacement(node);
    const zoneIds = new Set(zones.map((zone) => zone.id));
    const counts = new Map<string, number>();
    for (const row of submittedRows) {
      const draft = draftFromValue(node, row.value);
      if (draft.kind !== 'categorize') continue;
      for (const [itemId, zoneId] of Object.entries(draft.assignment)) {
        // ⚠️ 放进了**不存在的框**（教师改题删了那个框）⇒ **不计**：那一格在矩阵上没有列，
        // 计进去会凭空多出一个画不出来的格子。
        if (!zoneIds.has(zoneId)) continue;
        bump(counts, `${itemId} ${zoneId}`);
      }
    }
    return {
      kind: 'categorize',
      items,
      zones,
      cells: [...counts.entries()].map(([key, count]) => {
        const [rowId, colId] = key.split(' ');
        return { rowId, colId, count, correct: placement[rowId] === colId };
      }),
    };
  }

  // ── 问答 / 绘图 ────────────────────────────────────────────────────
  if (kinds.size === 1 && kinds.has('text')) {
    // 字数**分档**而不是逐个字数（逐个会得到几十根长度 1 的条，读不出形状）。
    const buckets = new Map<string, number>();
    for (const row of submittedRows) {
      const draft = draftFromValue(node, row.value);
      if (draft.kind !== 'text') continue;
      const length = draft.text.trim().length;
      const bucket = length === 0 ? '空' : length <= 10 ? '1–10 字' : length <= 30 ? '11–30 字' : length <= 60 ? '31–60 字' : '60 字以上';
      bump(buckets, bucket);
    }
    // ⚠️ 按**档位的自然顺序**排，不按人数降序 —— 字数分布读的是形状。
    const order = ['空', '1–10 字', '11–30 字', '31–60 字', '60 字以上'];
    return { kind: 'text', lengths: order.map((label) => ({ label, count: buckets.get(label) ?? 0 })) };
  }
  if (kinds.size === 1 && kinds.has('ink')) {
    return { kind: 'ink', drawn: submittedRows.length };
  }

  // 混合形状（教师改过题型，库里同时有新旧值）⇒ **不画分布**。
  // 猜一种画法会画出一张只有一半人参与的图，而屏幕上看起来是「全班都这样」。
  return null;
}

/**
 * 文字说明。
 *
 * 🔴 **只陈述算得出来的事实，不解释原因**（规格 §4 的硬线）：
 * 「63% 选了 B」是事实；「他们混淆了 A 和 B」是**解释**，那是智能体该说的（§6.2）。
 * 本地一旦开始解释，就是在编。
 *
 * ⚠️ **每个数字都要写得出分母**：所以每一条都从「已交 N 人」出发。
 */
function buildInsights(input: {
  node: Parameters<typeof draftFromValue>[0];
  total: number;
  submitted: number;
  correct: number;
  partial: number;
  wrong: number;
  noVerdict: number;
  graded: number;
  distribution: QuestionDistribution;
  submittedRows: ReadonlyArray<StatsRow>;
}): Insight[] {
  const { node, total, submitted, correct, partial, wrong, noVerdict, graded, distribution } = input;
  const out: Insight[] = [];

  // ① 交卷情况（**总是**有话说 —— 它是所有百分比的分母）。
  if (submitted === 0) {
    return [{ level: 'info', text: `全班 ${total} 人，还没有人交这道题。` }];
  }
  if (submitted < total) {
    out.push({ level: 'info', text: `${total} 人中已交 ${submitted} 人，还有 ${total - submitted} 人没交。` });
  }

  // ② 判分结论（**读服务端的 `gradeState`**，本地不重算）。
  if (graded > 0) {
    const accuracy = Math.round((correct / graded) * 100);
    // ⚠️ 阈值是**可争议的**，所以写在这里一处，而不是散在界面里。
    const level = accuracy < 30 ? 'warn' : accuracy >= 80 ? 'good' : 'info';
    out.push({
      level,
      text: `已判 ${graded} 人：全对 ${correct} 人、部分给分 ${partial} 人、答错 ${wrong} 人（正确率 ${accuracy}%）。`
        + (accuracy < 30 ? '这道题偏难。' : ''),
    });
  } else if (noVerdict > 0) {
    // 主观题 / 关闭自动判分 —— **不许**编一个百分比出来。
    out.push({ level: 'info', text: `已交 ${submitted} 人；这道题没有自动判分，不统计正确率。` });
  }
  if (node.type === 'short-answer' || node.type === 'drawing') {
    out.push({ level: 'info', text: '这道题的答案需要人来读 —— 下面可以交给智能体分析。' });
  }

  // ③ 分布里最突出的一件事（**每种题型各说各的**）。
  if (distribution?.kind === 'options') {
    const top = [...distribution.bars].sort((a, b) => b.count - a.count)[0];
    if (top && top.count > 0) {
      const wrongTop = distribution.bars.filter((bar) => !bar.correct).sort((a, b) => b.count - a.count)[0];
      out.push({
        level: top.correct ? 'good' : 'warn',
        text: `选得最多的是「${top.label}」（${top.count} 人）${top.correct ? '，它就是正确答案' : ''}。`,
      });
      if (!top.correct && wrongTop && wrongTop.count > 0) {
        out.push({ level: 'warn', text: `其中「${wrongTop.label}」有 ${wrongTop.count} 人选（不是正确答案）。` });
      }
    }
  }
  if (distribution?.kind === 'blanks') {
    for (const blank of distribution.blanks) {
      const top = blank.bars[0];
      if (!top) { out.push({ level: 'warn', text: `${blank.label}：没有人填。` }); continue; }
      out.push({
        level: 'info',
        text: `${blank.label}：${top.count} 人写了「${top.label}」`,
      });
      // 「写法很多」是一个**事实**（不是判分），而且它正是教师最需要的信号。
      if (blank.distinct >= 3) {
        out.push({ level: 'warn', text: `${blank.label}出现了 ${blank.distinct} 种不同写法 —— 建议核对是否有写法差异。` });
      }
    }
  }
  if (distribution?.kind === 'match') {
    const worst = [...distribution.cells].filter((cell) => !cell.correct).sort((a, b) => b.count - a.count)[0];
    if (worst && worst.count > 0) {
      out.push({
        level: 'warn',
        text: `${worst.count} 人把「${textOf(distribution.left, worst.rowId)}」连到了「${textOf(distribution.right, worst.colId)}」。`,
      });
    }
  }
  if (distribution?.kind === 'categorize') {
    const worst = [...distribution.cells].filter((cell) => !cell.correct).sort((a, b) => b.count - a.count)[0];
    if (worst && worst.count > 0) {
      out.push({
        level: 'warn',
        text: `${worst.count} 人把「${textOf(distribution.items, worst.rowId)}」放进了「${textOf(distribution.zones, worst.colId)}」。`,
      });
    }
  }
  if (distribution?.kind === 'order') {
    // ★ 「完全正确」是纯等式（长度相同 + 每一位相同）⇒ 如实说得出**人数**，
    // 但措辞是「按答案顺序排的」，不是「判对」——判分那件事由服务端说（页头那四格）。
    const full = distribution.positions.filter((position) => position.hits === submitted).length;
    if (distribution.positions.length > 0) {
      out.push({ level: 'info', text: `${submitted} 人里，有 ${full} 人每一处都排在答案的位置上。` });
    }
    const top = distribution.topOrders[0];
    if (top && full < submitted) {
      out.push({ level: 'info', text: `出现最多的顺序是「${top.label}」（${top.count} 人）。` });
    }
  }

  return out;
}

/**
 * ★ 2026-09-28（教师）：「非问答题，非绘图题，这部分要隐藏」。
 *
 * 🔴 **判据是题型**：客观题（单选/多选/判断/填空/排序/连线/归类）**本来就判分**，
 * 看板那四格与「本题统计」已经把「他答得怎么样」回答完了 —— 再交给智能体去读一遍，
 * 教师看到的会是一句「这道题不是主观题」（那是服务端 `canSend` 的拒绝理由），
 * 而它在这一屏上只是一句**噪声**。
 *
 * ⚠️ 只认这两个题型，**不认 `inputMode === 'handwriting'`**：手写只是作答方式，
 * 一道手写填空题仍然是**客观题**（服务端照常按答案判分）。把它一起放进来会让
 * 「填空 + 手写」那一种多出一块它不需要的东西 —— 而教师那句话说的是**题型**。
 *
 * ⚠️ 这里**只管显不显示**，不管「能不能发」：`canSend` 仍然是**服务端**给的判断
 * （它还要看有没有配 `purpose='analysis'` 的智能体、已交份数够不够等），两件事不同源。
 */
export function showsAgentAnalysis(node: { type: string }): boolean {
  return node.type === 'short-answer' || node.type === 'drawing';
}
