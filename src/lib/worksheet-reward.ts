/**
 * 学习单的**奖励形式**（规格 §9）—— 常量 + 纯函数，不碰 React / DOM / 网络。
 *
 * ── 这一层是硬边界（规格 §9.1）────────────────────────────────────────────
 *
 * ```
 * 数据层     isCorrect: true | false        ← 永远只有这一种，永远落库的只有它
 *               │
 * 呈现层        ├─ 对错    ✓ / ✗
 *               ├─ 星星    ⭐ ×N
 *               ├─ 花朵    🌸 ×N
 *               └─ 分数    +N
 * ```
 *
 * 🔴 **绝不把星星 / 花朵 / 分数存进数据库。** 一旦落库，教师端「哪道题错得多」、导出、
 * P4 的分析型智能体都要面对一个「⭐ 是什么数」的问题。所以本文件里的每一个数都是
 * **算出来的**，`WorksheetAnswer` 上没有任何一列与之对应。
 *
 * ── 单独成文件、单独可跑 ───────────────────────────────────────────────────
 *
 * 与 `worksheet-questions.ts` 同一个理由：取值的规则**错了不报错** —— 步长算错只会让
 * 学生少拿一朵花、多拿一颗星，界面上一切正常。所以它必须能被 `node --test` 直接断言：
 *
 * ```bash
 * node --test src/lib/worksheet-reward.test.ts
 * ```
 *
 * ⚠️ 因此本文件**不得出现 `@/…` 的运行时 import、不得引 React / DOM**（Node 解析不了
 * 联名路径）。它是零依赖的，这条约束今天自然成立，改动时请保持。
 */

/**
 * 奖励形式（规格 §9.2 的四选一）。
 *
 * ⚠️ 取值与服务端 `routes/worksheets.ts` 的 `REWARD_STYLES` 是**同一套字面量**，
 * 而服务端复制了一份自己的（它读不到 `src/`）。与题型注册表（`QUESTION_TYPE_OPTIONS`
 * 对 `QUESTION_TYPES`）同一个由来：**两处必须一起改**，改一处会让「学生端认不出
 * 服务端存的样式」——而那种失效是静默的（落到默认档，画出来的是另一种奖励）。
 */
export type RewardStyle = 'correctness' | 'star' | 'flower' | 'points';

export interface RewardStyleOption {
  value: RewardStyle;
  /** 教师端那四个选项上的字（规格 §9.2 的图）。 */
  label: string;
  /** 学生端画出来的符号；`null` = 这一档不用符号（对错档画的是 ✓ / ✗）。 */
  symbol: string | null;
  /** 步长的量词（规格 §9.2：「星星/花朵是『个』、分数是『分』」）。空串 = 这一档没有步长。 */
  unit: string;
  /** 教师端那行小字：说清学生**看到**什么。 */
  hint: string;
}

/** 四选一的顺序 = 规格 §9.2 图里的顺序（对错打头，分数收尾）。 */
export const REWARD_STYLE_OPTIONS: readonly RewardStyleOption[] = [
  {
    value: 'correctness',
    label: '对错',
    symbol: null,
    unit: '',
    hint: '答对显示 ✓、答错显示 ✗。没有步长 —— 对错本身不累计成一串符号。',
  },
  {
    value: 'star',
    label: '星星 ⭐',
    symbol: '⭐',
    unit: '个',
    hint: '每答对一题给几颗星，答错不给。',
  },
  {
    value: 'flower',
    label: '花朵 🌸',
    symbol: '🌸',
    unit: '朵',
    hint: '每答对一题给几朵花，答错不给。',
  },
  {
    value: 'points',
    label: '分数 ＋',
    symbol: '+',
    unit: '分',
    hint: '每答对一题加几分，答错不加。',
  },
];

/**
 * 默认档。
 *
 * ⚠️ 这是**这次改动定的**（规格 §9 与计划都没写默认值）：§9.2 的那张图里 `●` 打在
 * 「星星 ⭐」上、步长框里写的是 `1`，§8.2 的学生端版式图顶栏画的也是 `⭐×3` ——
 * 三处画的是同一个默认。改它等于改所有**已经存在**的学习单在学生眼前的样子。
 */
export const DEFAULT_REWARD_STYLE: RewardStyle = 'star';
export const DEFAULT_REWARD_STEP = 1;
/** 全对档步长的可选项（规格 §9.2 定死 1 / 2 / 3 / 5）。 */
export const REWARD_STEPS: readonly number[] = [1, 2, 3, 5];

/**
 * ★ M4a：**半对档**步长的默认值与取值域。
 *
 * 🔴 `HALF_STEPS` **比 `REWARD_STEPS` 多一个 `0`** —— 这不是笔误，两者**本来就不同**：
 * `rewardStep` 是「答对一题得几个」，`0` 在那里无意义（答对却得 0 个）；而半对档的 `0`
 * 是**一个合法的选择** = 这单不给部分分（规格 §12 裁定 3 定的默认值就是它）。
 *
 * ⚠️ **别复用 `normalizeRewardStep` 来归一化半对档**（这是 2026-09-24 实测定下的一条）：
 * `REWARD_STEPS.includes(0)` 为假 ⇒ `normalizeRewardStep(0)` 回落到 `DEFAULT_REWARD_STEP = 1`
 * ⇒ 教师配的「半对 0」在学生端变成「半对 1」，既与裁定 3 的「与第一批行为逐字相同」打架，
 * 也与服务端下发的 0 打架。另一个修法（给 `normalizeRewardStep` 加个 `fallback` 参数）
 * 也不行：那样 `0` 之所以合法**只是因为它恰好等于 fallback**
 * （`normalizeRewardStep(4, 0)` 也回 0），一个合法值与一个越界值产生**同一个观测**，
 * 读者没法从代码看出「0 算不算数」。
 *
 * ⚠️ 这三个字面量在**服务端**（`server/src/routes/worksheets.ts` 的 `HALF_STEPS` 与
 * `DEFAULT_SETTINGS.halfStep`）各有一份：服务端读不到 `src/`。**两处必须一起改**，
 * 改一处不会报错，只会让教师配的档与学生看到的档不是同一个。
 */
export const DEFAULT_HALF_STEP = 0;
export const HALF_STEPS: readonly number[] = [0, 1, 2, 3, 5];

/**
 * 一份学习单上的奖励配置。
 *
 * `style` 与 `step` / `halfStep` 就是落库的那三个键（`Worksheet.settings`，规格 §4.4 / §9.2）。
 */
export interface RewardScale {
  style: RewardStyle;
  /** 答对一题的步长（教师可配 1 / 2 / 3 / 5）。 */
  step: number;
  /**
   * ★ M4a：**半对**那一档的步长（教师可配 0 / 1 / 2 / 3 / 5，`0` = 这单不给部分分）。
   *
   * 它从 D5 起就留在这个形状里、却一直没人传（那时教师配不了它）；M4a 起由
   * `resolveRewardScale` 从库里那个键读出来 —— 走那条路进来的 `RewardScale` **总是带着它**。
   *
   * ⚠️ 它仍然写成可选的，是因为 `rewardAmount` 里那条 `?? Math.floor(step × score)` 的兜底
   * 要对**手工拼的** `RewardScale`（用例里直接写 `{ style, step }` 的那些）成立 ——
   * 那是兜底，**不是**产品定的规则（产品规则是「半对得半对档那个数」）。
   */
  halfStep?: number;
}

/** 认不出的样式一律落到默认档（库里手工改过的行不该让面板画不出东西）。 */
export function normalizeRewardStyle(raw: unknown): RewardStyle {
  return REWARD_STYLE_OPTIONS.some(option => option.value === raw)
    ? raw as RewardStyle
    : DEFAULT_REWARD_STYLE;
}

/**
 * 步长只认 1 / 2 / 3 / 5 这四个值。
 *
 * 🔴 越界值**回落到默认**而不是「夹到区间里」：`0.5` 会让每题显示半颗星（画不出来），
 * `100` 会让一屏被星星塞满。夹逼看起来更温和，但它把一个**不属于取值域**的数
 * 变成一个看起来合法的数 —— 与「缺字段按默认走」相比，后者至少是可解释的。
 */
export function normalizeRewardStep(raw: unknown): number {
  return typeof raw === 'number' && REWARD_STEPS.includes(raw) ? raw : DEFAULT_REWARD_STEP;
}

/**
 * 半对档只认 0 / 1 / 2 / 3 / 5 这五个值（越界与缺字段一律回落到 **0**）。
 *
 * ⚠️ 与 `normalizeRewardStep` **不是**同一条规则，也**不许**合并 —— 两者的域不同、
 * 默认值也不同（这里是 0、那里是 1）。理由与代价写在 `HALF_STEPS` 上。
 */
export function normalizeHalfStep(raw: unknown): number {
  return typeof raw === 'number' && HALF_STEPS.includes(raw) ? raw : DEFAULT_HALF_STEP;
}

/** 从 `Worksheet.settings` 那一坨里取出奖励配置（缺字段 / 坏值一律回落到默认）。 */
export function resolveRewardScale(settings: unknown): RewardScale {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : {};
  return {
    style: normalizeRewardStyle(source.rewardStyle),
    step: normalizeRewardStep(source.rewardStep),
    // ★ M4a：这一行就是「学习单级半对档」到学生端的**唯一**一条路（服务端那边是
    // `readStudentSettings` 把它下发出来）。少这一行 ⇒ `rewardAmount` 永远走
    // `Math.floor(step × score)` 那条兜底 ⇒ 教师配的「半对 0」被当成「按比例折算」，
    // 而界面上没有任何提示。
    halfStep: normalizeHalfStep(source.halfStep),
  };
}

/**
 * **得分 → 奖励个数**（规格 §9.1）。
 *
 * 🔴 入参是**得分**，不是 `isCorrect` 布尔：
 *   `score = 1` ⇒ 全对档的步长；`score = 0.5` ⇒ 半对档；`score = 0` ⇒ 0；
 *   `null` ⇒ 没判分（主观题 / 关掉自动判分）⇒ 0 —— **不是「0 分」**，两者在界面上
 *   都画不出奖励，但「没判」是「不知道」，把它当成 0 会让将来的统计把它算成答错。
 *
 * 今天得分只可能是 0 或 1（第一批没建 score 字段，规格 §3-S），所以在**论步长的那三档**
 * （星星 / 花朵 / 分数）上，本函数的行为与「`isCorrect ? step : 0`」**逐字相同**
 * （对错档根本没有步长，见下面那条分支）—— 变的是**接口的形状**，不是行为。
 * 这正是要按得分写的原因：M4 只需改判分与多一行配置，这里一行都不用动。
 */
export function rewardAmount(score: number | null, scale: RewardScale): number {
  if (score === null || !Number.isFinite(score) || score <= 0) return 0;
  // 🔴 **对错档没有步长**（规格 §9.2：选了「对错」时那一行不出现）⇒ 答对一题就是 1。
  // 不能读 `scale.step`：教师在「星星 ×3」与「对错」之间来回选时，库里那个 3 一直留着
  // （这是好事，切回星星时他配的 ×3 还在），但拿它去算对错档的累计会得到 `✓×9`
  // ——一个没有任何依据、也不会报错的数。这一条就是本文件存在的理由之一。
  if (scale.style === 'correctness') return 1;
  if (score >= 1) return scale.step;
  return scale.halfStep ?? Math.floor(scale.step * score);
}

/** 这一档的符号（对错档没有符号，返回 `null`）。 */
export function rewardSymbol(style: RewardStyle): string | null {
  return REWARD_STYLE_OPTIONS.find(option => option.value === style)?.symbol ?? null;
}

/**
 * **每题旁**那个奖励的字面（规格 §9.3）。`null` = 这一题不画任何东西。
 *
 * 两处「不画」是刻意的，不是漏了：
 *   · `score === null` —— 没判分（主观题、关掉自动判分）⇒ 没有奖励可言；
 *   · 符号档拿到 0 个 —— 「0 颗星」就是一颗都不画（规格 §9.1：显示值 = 答对 ? N : 0）。
 *     ⚠️ 所以**符号档下答错是「什么都没多出来」**，而对错档答错是明写的 ✗ ——
 *     那正是「对错」这一档存在的意义，不是两档画得不一致。
 */
export function rewardMark(scale: RewardScale, score: number | null): string | null {
  if (score === null) return null;
  // 对错档只有两种画法，半对（M4）在这档里画 ✗ —— 「半对」不是「对」。
  // 想看半对该给几朵花，就选星星 / 花朵 / 分数那三档。
  if (scale.style === 'correctness') return score >= 1 ? '✓' : '✗';
  const amount = rewardAmount(score, scale);
  if (amount <= 0) return null;
  if (scale.style === 'points') return `+${amount}`;
  // `String.prototype.repeat` 是 ES6，Safari 15 有（`Array.prototype.at` 才没有，别混用）。
  return rewardSymbol(scale.style)?.repeat(amount) ?? null;
}

/**
 * **顶部累计**那个字面（规格 §9.3 的 `⭐×3`）。`null` = 一个都不画（累计为 0）。
 *
 * 累计的口径是「全部答对题目的奖励之和」（规格 §9.1：累计 = 答对题数 × N）。分数档
 * 累加出来是一个数，所以它画成 `+3 分` 而不是 `＋×3` —— 后者是对着样式图硬套。
 */
export function rewardTotalText(scale: RewardScale, amount: number): string | null {
  if (amount <= 0) return null;
  if (scale.style === 'points') return `+${amount} 分`;
  if (scale.style === 'correctness') return `✓×${amount}`;
  const symbol = rewardSymbol(scale.style);
  return symbol ? `${symbol}×${amount}` : null;
}
