/** 学习单的题型注册表。**纯函数，全部在服务端** —— 本项目不引入前端测试框架（规格 §11）。 */

// ★ M4b：判分前的 ink 短路，以及写入口的体积校验，都建立在同一份格式判据上。
// ⚠️ 这是**本文件唯一**的 import —— 它不引入任何循环（`worksheet-ink.ts` 自身不 import）。
import { isInkFormat } from './worksheet-ink.js';

/**
 * 题型注册表。**导出的是运行时列表**，`QuestionType` 由它派生 —— 这样「有哪些题型」
 * 只有一处定义，测试可以**遍历**它（而不是在测试里把类型名抄一遍）。
 *
 * 🔴 它**同时是校验用的那张表**：`routes/worksheets.ts` 的 `normalizeNode` 直接从
 * 这里 `import { QUESTION_TYPES }`，不再另抄一份。
 *
 * ⚠️ 曾经那里抄了一份自己的字面量，而当时的注释只分析了**一个方向**（「注册表有、
 * 校验那份没有 ⇒ 400 响亮失败，所以没关系」）。反向**不是**响亮的：校验那份多出一个
 * 题型 ⇒ `normalizeNode` 收下它，而下面的 `validateQuestion` 不认识它 ⇒ 返回空错误 ⇒
 * 那道题永远无法作答、也永远无法提交，整卷永远停在 `in-progress`、看板「已交 N/M」
 * 永远填不满，**全程无一处报错**。合并成一份之后两个方向一起消失。
 * ⚠️ 往这个数组里加题型时，`validateQuestion` 的分支表（`VALIDATORS`）**必须**同步补
 * 一个键 —— 它是一张 `Record<QuestionType, …>`，漏补是**编译错误**，不再是静默通过。
 *
 * ── M4a：3 → 8 ────────────────────────────────────────────────────
 * `true-false` **不是** `single-choice` 的特例别名：它要有自己的编辑 UI 与提示文案，
 * 但**判分与作答值与单选逐字相同**（规格 §12 裁定）。两者在 `VALIDATORS` 里共用
 * 同一个校验器（`correctKeys` 恰好一个），差别只在单选多一条 `options.length >= 2`。
 */
export const QUESTION_TYPES = [
  'single-choice', 'true-false', 'multi-choice', 'fill-blank', 'short-answer',
  'order', 'match', 'categorize',
  // ★ M4b：绘图题。**不判分**（`graded: false`）—— 学生画图，教师人眼看。
  // 🔴 它同时收口一个真实存在过的窗口：前端 A2 已把 `drawing` 加进
  // `QUESTION_TYPE_OPTIONS`，而服务端当时还没有它 ⇒ 教师在「添加题目」弹窗里选
  // 「绘图题」保存必被 400 拒。加进来之后那个窗口关闭。
  // ⚠️ 它的作答值是**笔迹**（`ink/v1` / `drawing/v1`），判分的两处闸门见 `judge()`
  // 与 `JUDGES`；写入口的体积校验见 `services/worksheet-ink.ts`（B1）。
  'drawing',
  // ★ 2026-09-25：**任务**（分组容器）—— 它不是一道题，见下面 `JUDGES` / `VALIDATORS` 里
  //    它那两条各自的注释。放进本联合而不是另开一个 node kind 的理由：
  //    下面两张表都是 `Record<QuestionType, …>` ⇒ 加一项会让**每一处编译报错**，
  //    而「另开一个 kind」会让它们**静默漏掉**（那是本仓反复栽的那一类）。
  'task',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** 一道题的两个分值档（规格 §12：得分不是比例，是教师逐题填的两个**绝对数**）。 */
export interface QuestionPoints { full: number; half: number }

/**
 * 逐题分值的默认档。**与第一批行为逐字相同**（规格 §12 裁定 3：星星 ⭐、全对 1 / 半对 0）
 * —— 它同时是「题上没有 `points`」时 `normalizePointValue` 的回落值。
 */
export const DEFAULT_POINTS: QuestionPoints = { full: 1, half: 0 };

/**
 * 分值的取值上限。
 *
 * ⚠️ 它是**两个档共用的上界**（`full` 与 `half` 各自上到 99），不是「`full + half <= 99`」——
 * 后者会让「全对 60 / 半对 50」这种（半对拿得比全对多的笔误）悄悄通过，
 * 而它唯一的表现是看板上的数字怪怪的。要挡那种笔误得靠在 UI 上比大小，不在这里。
 */
export const POINTS_MAX = 99;

/**
 * ★ M4a/I1：**「全对」档的下界**。`half` 的下界是 `0`，`full` 的不是。
 *
 * 🔴 `full = 0` 的后果是**三个观测互相打架、而全程无一处报错**（2026-09-24 终审实测的链条）：
 *   1. `grade()` 对**答对**的题给出 `{ state: 'correct', score: 0 }`；
 *   2. 学生端对错档按 `score >= 1` 画 ⇒ **红叉**（他答对了，却没有分）；
 *      符号档 `rewardAmount(0) = 0` ⇒ 一个符号都不画；
 *   3. 教师抽屉读 `gradeState` ⇒ **`✓ 答对`（绿）**，并把它计进正确率的分子。
 * ⇒ 同一次提交，学生屏幕说「错」、教师说「对且绿」、正确率 100%、学生总奖励 0。
 *
 * ⇒ `full` 的域是 `1..POINTS_MAX`，`half` 的域是 `0..POINTS_MAX`。**两个域是有意不同的**，
 * 别把它们「统一」：`half = 0` 是合法选择（= 不给部分分，规格 §12 裁定 3 的默认值就是它，
 * 服务端的 `HALF_STEPS` 与 `shouldWarnZeroHalfCredit` 都建立在它上面），
 * 而 `full = 0` 是「答对了却一个都不给」—— 与 `REWARD_STEPS` 里刻意不放 `0` 是同一件事。
 */
export const POINTS_FULL_MIN = 1;

/**
 * 取一个 `0..POINTS_MAX` 的整数；非整数 / 越界 / 缺失一律回落到 `fallback`。
 *
 * 🔴 它**同时被两条路用到**，这是它被导出的原因：`routes/worksheets.ts` 归一化
 * 题目上的 `points`（写入口），与 A2 的 `pointsFromSettings` 读学习单级的档（读出口）。
 * 各写一份会让「`points: { full: "两朵" }` 到底算 1 还是算 0」在两条路上给出不同答案 ——
 * 而两个答案都不会报错。
 *
 * ⚠️ 它的域是**宽的那个**（`0..POINTS_MAX`，与 `isUsablePointValue` 同一对判据）：
 * 学习单级的 `rewardStep` / `halfStep` 走它，而 `halfStep = 0` 合法。
 * `full` 那一侧更窄（`isUsableFullPointValue`），所以 `normalizePoints` 是**先判域、
 * 再调本函数**，不是反过来 —— 反过来会把 `full: 0` 归一化成一个合法的 0 分。
 *
 * `Math.round` 而不是拒绝小数：教师端将来可能出现 `2.5` 这种输入，四舍五入到 3 比
 * 静默回落到默认值（1）更接近他填的东西。**取整必须在这里做**，因为
 * `WorksheetAnswer.score` 是 `Float`，一个 2.5 会一路走进奖励累计里。
 */
export function normalizePointValue(raw: unknown, fallback: number): number {
  if (!isUsablePointValue(raw)) return fallback;
  return Math.round(raw as number);
}

/**
 * 这个值**能不能当作分值用**（= `normalizePointValue` 的回落条件的反面）。
 *
 * ⚠️ 单独抽出来是为了**只有一处**回答「什么算有效分值」：`normalizePoints` 要按这个判据
 * 决定「这题是填了分还是留空」，而那个决定直接决定「继承还是脱离学习单级」（裁定 4）。
 * 两处各写一份 `typeof raw === 'number' && …` 的话，改了一处就静默分叉。
 *
 * ⚠️ 这是**宽的那个域**（`0..POINTS_MAX`）—— 它回答的是「形状对不对」，不是「这一档收不收」。
 * `full` 还要再过一道 `isUsableFullPointValue`。
 */
export function isUsablePointValue(raw: unknown): boolean {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return false;
  const rounded = Math.round(raw);
  return rounded >= 0 && rounded <= POINTS_MAX;
}

/**
 * ★ M4a/I1：**「全对」档**的判据（`1..POINTS_MAX`）。下界的理由写在 `POINTS_FULL_MIN` 上。
 *
 * 🔴 与 `isUsablePointValue` **是两个域，不许合并**：合并的那个方向有两种，都很坏 ——
 *   · 用窄的（本函数）替掉宽的 ⇒ `half: 0` 被判成「没填」，**教师配的「不给部分分」
 *     静默变成「继承学习单级」**，而 `shouldWarnZeroHalfCredit` 那条提示正建立在
 *     「半对 0 是一个有效值」上面；
 *   · 用宽的替掉窄的 ⇒ 就是 I1 那个缺陷本身。
 *
 * ⚠️ 判据是 `Math.round` 之后的值（与 `normalizePointValue` 同一把尺子）：
 * `full: 0.4` 落到 0，一样不收 —— 否则屏幕上「0.4」与「0」会走出两条不同的路。
 */
export function isUsableFullPointValue(raw: unknown): boolean {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return false;
  const rounded = Math.round(raw);
  return rounded >= POINTS_FULL_MIN && rounded <= POINTS_MAX;
}

/**
 * 写入口的**拒绝判据**：这个 `full` 是不是**认得出、但不合法**（今天只有 `0` 一种）。
 *
 * 🔴 为什么不是「`isUsableFullPointValue` 为假就拒」：字符串 / `null` / `undefined` /
 * 越界值（`-1`、`100`）在 A1 的语义里**就是「没填」**（`normalizePoints` 把它们当留空
 * ⇒ 那道题继承学习单级），而那是一条已经生效、有用例钉着的裁定 —— 把它们一起改成 400
 * 等于顺手改掉另一条语义。只有 `0` 落在两个域**之间**：它**是一个数**、宽判据认它有效
 * （所以会被当成「教师真的填了 0 分」落进库里），而它作为 `full` 的后果正是上面那条自相矛盾的链。
 * ⇒ 只拒它一个，且**拒绝保存**（与 `partialCredit` 同一种处置）而不是回落到默认 ——
 * 回落会让教师的输入静默变成另一个数，而这条链上看起来一切正常。
 *
 * ⚠️ 它只回答「该不该拒」；真正落 400 的地方在 `routes/worksheets.ts` 的
 * `normalizeNode`（错误串要说出**第几题**，而这里不知道）。
 */
export function isRejectedFullPointValue(raw: unknown): boolean {
  return isUsablePointValue(raw) && !isUsableFullPointValue(raw);
}

/**
 * 归一化题目的**逐题分值**（M4a，规格 §12 裁定 4 / 5）。
 *
 * 🔴 **两个字段都不是有效数字时返回 `undefined` —— 那是「留空 = 继承学习单级」，
 * 不是「用默认值」。** 曾经这里无条件构造
 * `{ full: normalizePointValue(source.full, 1), half: normalizePointValue(source.half, 0) }`，
 * 于是 `points: {}`（前端清空了两个输入框）会落成**显式**的 `{ full: 1, half: 0 }`。
 * 而 `DEFAULT_POINTS` 恰好等于第一批的默认档 ⇒ 教师**看不出任何差别**，直到他改了
 * 学习单级的档，才发现这一道题不跟随 —— 且没有任何提示。裁定 4 要防的就是这个。
 *
 * 只有一个字段有效时，取有效的那个，另一个回落 `DEFAULT_POINTS`（它还是要有个数）。
 *
 * 🔴 ★ M4a/I1：**两个字段用的不是同一个判据** —— `full` 走 `isUsableFullPointValue`（`1..99`），
 * `half` 走 `isUsablePointValue`（`0..99`）。`full: 0` 因此在这里就是「没填」，
 * 它**落不进库**（写入口拒收：`isRejectedFullPointValue` / `normalizeNode`）。
 * 于是两种来路各自得到一个**不会打架**的结果：
 *   · 走编辑器的数据 —— 服务端 400，教师当场看到是第几题；
 *   · 手工改过的库行 —— 这里当成「没填」⇒ 继承学习单级，而**学习单级那一侧的 `full`
 *     也恒 ≥ 1**（`pointsFromSettings` 同样走 `isUsableFullPointValue`，见那个函数）——
 *     **不会**再出现「答对却拿 0 分 ⇒ 学生画红叉、教师画绿勾」。
 *
 * ⚠️ 「学习单级那一侧」这半句是**后补的**：原先写的是「见 `REWARD_STEPS`」，
 * 而 `REWARD_STEPS = [1,2,3,5]` 只约束**写入口**（`normalizeSettings`）——
 * 一条手工改过的 `rewardStep: 0` 会绕过它，`pointsFromSettings` 原样吐出 `full: 0`，
 * 于是 `resolvePoints` ⇒ `grade(答对)` 又是 `{state:'correct', score:0}`，I1 那四个观测原样回来
 * （2026-09-24 终审的限定复查实测）。⇒ 那条链现在也从**读出口**堵上了，这半句才是真的。
 */
export function normalizePoints(raw: unknown): QuestionPoints | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const hasFull = isUsableFullPointValue(source.full);
  const hasHalf = isUsablePointValue(source.half);
  if (!hasFull && !hasHalf) return undefined;
  return {
    full: hasFull ? normalizePointValue(source.full, DEFAULT_POINTS.full) : DEFAULT_POINTS.full,
    half: hasHalf ? normalizePointValue(source.half, DEFAULT_POINTS.half) : DEFAULT_POINTS.half,
  };
}

export interface QuestionNode {
  id: string;
  type: QuestionType;
  prompt: string;
  inputMode: 'keyboard' | 'handwriting';
  /**
   * ★ M4a：逐题分值。**留空 = 继承学习单级**（规格 §12 裁定 4）——
   * 所以 `undefined` 是一个**有意义的取值**，不是「还没填」。
   * 它**不进 `data`**：它是题型无关的（8 个题型都要），而 `data` 是各题型自己的形状，
   * 放进去就要在 8 个题型里各写一遍读法。
   */
  points?: QuestionPoints;
  data: Record<string, unknown>;
  children: QuestionNode[];
}
export interface WorksheetContent { schemaVersion: number; nodes: QuestionNode[] }

/**
 * 学习单级的**两个档**（`Worksheet.settings`）—— 规格 §12 裁定 4 的「兜底」。
 *
 * 语义是「**本单未单独设置的题**用这个」。缺字段 / 坏形状一律回落到 `DEFAULT_POINTS`
 * （= 第一批的默认档 1 / 0）。
 *
 * 🔴 **取值域是 `normalizePointValue` 的 0..99（`full` 那一档是 1..99，见 `POINTS_FULL_MIN`），
 * 不是 `rewardStep` / `halfStep` 的 1/2/3/5 与 0/1/2/3/5。** 那两个下拉是**学习单级**的 UI 约束
 * （`src/lib/worksheet-reward.ts` 的 `REWARD_STEPS` / `HALF_STEPS`），而**逐题**的两个输入框
 * 是自由的（规格 §12 裁定 5：教师可以填 2 或 4）。
 * ⚠️ 这个差异是**有意的**，不要「统一」它们。但两个函数换上来的后果**不一样**，别用一句
 * 「静默变回默认档」把两件事说成一件：
 *    · 换成 `normalizeRewardStep` ⇒ 库里一个已有的 `rewardStep: 4`（手工改过 / 将来放宽了
 *      取值域）**静默变回 1**，教师看到的是「我配的档没生效」；
 *    · 换成 `normalizeHalfStep` ⇒ `halfStep: 4` **静默变回 0**，而半对 0 的含义是
 *      **「不给部分分」** —— 比变 1 更险：教师配的「漏选给 2 分」会变成「漏选一分不给」，
 *      学生只是少拿分，界面上一切正常，没有任何提示。
 *      更麻烦的是这个兜底值恰好等于一个**合法值**：`0` 与「越界回落」是同一个观测，
 *      所以「半对档坏了」这件事在数据上**看不出来**（`HALF_STEPS` 那边的说明也提到这点）。
 *
 * ⚠️ 半对档**有第三个消费方**，域与上面两个下拉都不同（2026-09-24 记，**不改行为**）：
 * 写入口（`routes/worksheets.ts` 的 `normalizeSettings`）认的是 `HALF_STEPS` 的
 * `{0,1,2,3,5}`，而**判分**这条兜底走的是本函数的 `0..99`。
 * ⚠️ 写入口那侧的机制是**越界即回落 `DEFAULT_SETTINGS.halfStep`（0）**，不是「夹到区间里」
 *（`normalizeHalfStep` 与它同一条口径：越界不夹逼，见那份文件上的说明）。
 * ⇒ 一行手改过的库写成 `halfStep: 7`（**它没走过写入口**）时，两侧对同一个键给出两个数：
 * 判分**按 7 分算**，而编辑器的下拉里没有 7（`normalizeLoadedSettings` 把它读成 0）
 * ⇒ **界面上显示 0**；而这行**一旦被编辑器保存一次**，写入口就把它落成 0，判分也跟着变 0 ——
 * 也就是「教师只要打开这张单改个标题再保存，半对档就会从 7 变成 0」，同样没有任何提示。
 * `rewardStep` 早就有同一条缝（`rewardStep: 4`），它是有意为之；这里把 `halfStep`
 * 一并点名，免得下一个人以为只有全对档有这条缝。
 *
 * ⚠️ 半对档缺席（`source.halfStep` 是 `undefined` / 形状不对）时 `normalizePointValue`
 * 回落到 `DEFAULT_POINTS.half = 0`，与规格的默认值相同 —— 也就是第一批的行为。
 * ⊘ 2026-09-24（C3）更正：这一段原先写的是「`halfStep` 要到任务 B2 才进 `normalizeSettings`
 *（写入口）。**这个窗口期是安全的**：此刻没有任何 UI 能写出那个键」。那个窗口期已经
 * **关闭两次**：B2 让写入口认它，C3 让编辑器设置面板也能写出它（`page.tsx` 的那一行下拉）。
 * ⇒ 「库里那个键缺席」不再是常态，只是「这张单是在 C3 之前配的」或「那行是手改的」。
 * 上面那条兜底行为**本身仍然成立**，作废的只是那半句理由。
 *
 * 🔴 ★ M4a/I1（2026-09-24 终审的限定复查带出）：**`full` 那一档在这里也要过窄判据。**
 * 原先它走的是宽的 `normalizePointValue`（`0..99`）⇒ 一行手工改过的 `rewardStep: 0`
 * （`REWARD_STEPS` 只约束**写入口**，管不到这种行）会原样吐出 `full: 0` ⇒
 * `resolvePoints` ⇒ `grade(答对)` = `{state:'correct', score:0}` ——
 * **I1 那四个观测原样回来**（学生画红叉、教师画绿勾、正确率算全对、奖励 +0）。
 * 那条链因此有**两个**读出口，这是第二个（第一个是 `normalizePoints`）。
 * ⇒ 不在区间里就回落 `DEFAULT_POINTS.full`（= 1），与越界值的处置同一条路。
 * ⚠️ 只影响「取整之后是 0」的那一个值：`rewardStep: 7`（手改的、不在 `REWARD_STEPS` 里）
 * 照旧按 7 算 —— 那条缝**有意保留**（见下面 `halfStep: 7` 那段）。
 */
export function pointsFromSettings(settings: unknown): QuestionPoints {
  const source = (settings && typeof settings === 'object' && !Array.isArray(settings))
    ? settings as Record<string, unknown> : {};
  return {
    full: isUsableFullPointValue(source.rewardStep)
      ? normalizePointValue(source.rewardStep, DEFAULT_POINTS.full)
      : DEFAULT_POINTS.full,
    half: normalizePointValue(source.halfStep, DEFAULT_POINTS.half),
  };
}

/**
 * 这道题**实际用**的两个档：逐题优先，留空回落学习单级（规格 §12 裁定 4）。
 *
 * 🔴 判分只认这个函数吐出来的值。它存在的理由与 `isUsablePointValue` 同款：
 * 「逐题填了没有」这个判断**只有一处**回答，否则改了一处就静默分叉。
 *
 * ⚠️ 走 `normalizePoints(node.points)` 而不是直接 `node.points ?? fallback`：
 * `node.points` 来自库里的 JSON，手工改过的行可能是 `{}` 或 `{ full: '五' }`。
 * 前者在 `normalizePoints` 的语义里**就是「留空」**（A1 的裁定：两个字段都不是有效数字
 * ⇒ `undefined` ⇒ 继承学习单级）；后者由它补上 `DEFAULT_POINTS` 的另一半 ——
 * 逐题**既然填了**，它就脱离了学习单级，不再跟随（裁定 4 要防的正是「看起来跟随了」）。
 *
 * 🔴 **「留空 = 继承」是整对象级的，不是字段级的。** 2026-09-24 实测确认，写在这里免得
 * 下一个读这段的人以为可以「只让半对档跟随学习单」：
 *
 * | 教师填了 | 落库的 `points`（`normalizeNode` → `normalizePoints`） | 本函数的结果 |
 * |---|---|---|
 * | 两个框都留空 | 键**不存在** | 整份回落学习单级 ✅ |
 * | 全对 7 / 半对留空 | `{ full: 7, half: 0 }` —— 缺的那一端被补成 `DEFAULT_POINTS` | `{ full: 7, half: 0 }` ⇒ **半对得 0 分** |
 * | 全对 7 / 半对 2 | `{ full: 7, half: 2 }` | 原样 |
 *
 * ⚠️ 第二行**真的会发生**（不是理论风险）：在隔离库上 `POST /api/worksheets`、载荷
 * `points: {full: 7}` 的实测结果是回包与库里**都是** `points: {full: 7, half: 0}`。
 * ⇒ **把这个函数改成逐字段回落修不了它**：库里那个 `half: 0` 是一个**有效分值**
 * （`isUsablePointValue(0)` 为真），逐字段回落会照用它。
 * 真正的防线在**写入口**：编辑器的 UI 不允许只填一个框（`src/app/teacher/worksheets/edit/`
 * 的 `findPartialPoints` + `save()` 把它拦下）⇒ 第二行在**走编辑器的数据上不可达**。
 * 它仍可能出现在手工改过的库行上，届时半对得 0 分 —— 那是这条整对象语义的**已知代价**，
 * 不是一处漏判。
 *
 * ⚠️ 所以**别**把这里改成 `{ full: node.points?.full ?? fallback.full, half: … }`：
 * 那会让读出口与写入口对同一个库里形状给出**不同**的答案（写入口补 0、读出口补学习单级），
 * 而两者都不会报错 —— 正是本文件反复在防的那种失效。
 */
export function resolvePoints(node: QuestionNode, fallback: QuestionPoints): QuestionPoints {
  return normalizePoints(node.points) ?? fallback;
}

/**
 * 填空题的文本归一化。
 *
 * 🔴 **刻意不做大小写不敏感**（规格 §3-T）：化学式 / 英文填空的大小写是语义的一部分，
 * 把 `CO2` 判成 `co2` 正确比不判更糟。英文题请教师在 `answers` 里多列几个写法。
 */
export function normalizeFillText(raw: string): string {
  return raw
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))  // 全角→半角
    .replace(/\s+/g, ' ')
    .trim();
}

/** 深度优先展开题目（第一批没有容器节点，但 content 是树，遍历写成递归不会过时）。 */
export function flattenQuestions(content: WorksheetContent): QuestionNode[] {
  const out: QuestionNode[] = [];
  const walk = (nodes: QuestionNode[]) => {
    for (const node of nodes) { out.push(node); walk(node.children ?? []); }
  };
  walk(content.nodes ?? []);
  return out;
}

/**
 * 答案字段的键名。**唯一来源** —— stripAnswers 与各题型共用，防止漏剥一个。
 *
 * 🔴 这是一张**黑名单**：`normalizeNode` 把 `data` 原样透传，所以没被列在这里的键
 * 会**原样下发到 `student-view`**（即泄漏给学生）。规格 §5.4 自己的措辞是单数的
 * `answer`，而这里的键是复数的 `answers` —— 一个字的差别就是一次静默泄漏，
 * 且没有任何编译期检查会红。防线是 `worksheet-grade.test.ts` 里的
 * 「每个题型的答案键都必须 ∈ ANSWER_KEYS」那条用例：**加题型时先看它**。
 *
 * ── M4a 新增的三个 ────────────────────────────────────────────────
 * `correctOrder`（排序题的正确顺序）· `pairs`（连线题的配对）· `placement`（归类题的归属）
 * **都是答案本身**：泄漏任何一个，学生打开 `student-view` 就等于拿到了标准答案。
 * ⇒ 它们必须在这张表里 —— 漏掉的代价不是一条红测试，而是一次**静默泄漏**。
 *
 * ⚠️ 与之相对，`items` / `left` / `right` / `zones` / `options` **不能**进来：
 * 它们是学生必须看到的题面，剥掉它们会让题目残缺到无法作答。
 */
export const ANSWER_KEYS = ['correctKeys', 'answers', 'explanation', 'correctOrder', 'pairs', 'placement'] as const;

/**
 * 剥离答案 —— 学生端 `student-view` 的唯一过滤点（规格 §5.4）。
 *
 * 🔴 **必须在服务端做，且必须返回新对象**：前端过滤等同于未过滤；就地改动会让
 * 后续复用同一份 content 的代码拿到已经被破坏的数据。
 *
 * 🔴 **递归剥，不是只剥顶层。** 这里曾经的实现是 `for (key of ANSWER_KEYS) delete data[key]`，
 * 只够得到 `data` 的**第一层**。而 M4a 的多空填空题把答案放在**第二层** ——
 * `data.blanks = [{ answers: […] }, …]` ⇒ 一次 `GET /:id/student-view` 就让全班学生
 * 拿到每一个空的可接受答案，**全程无报错**：顶层键扫描看不见嵌套层（`Object.keys`
 * 也看不进 `blanks[*]`），而 `validateQuestion` 那边是**故意**要把 `blanks` 收下的。
 *
 * 现在按**同一张黑名单**逐层剥。刻意不为嵌套层另立一份名单 —— 另立一份就会再漂一次。
 * `ANSWER_KEYS` 的语义就是「这些键名在**任何深度**都装答案」。
 *
 * ⚠️ 剥的**方向**是刻意选的：多剥一个键 ⇒ 学生看到一道残缺的题（看得见、当场就报）；
 * 少剥一个 ⇒ 答案静默泄漏给未成年人。两者代价差着量级，所以这里宁可过剥。
 * `worksheet-grade.test.ts` 的答案键审计对**每个形状**断言「剥完之后逐字等于期望」。
 *
 * ⚠️ 只剥 `data` 里的键，不动 `points`：`points` 是分值不是答案，学生端要靠它画
 * 「这题值几个 ⭐」（规格 §12：得分与奖励是同一个数的两种画法）。
 */
export function stripAnswers(content: WorksheetContent): WorksheetContent {
  /** 递归重建：命中黑名单的键整个丢掉，其余原样（数组保序、对象保键）。 */
  const stripValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripValue);
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((ANSWER_KEYS as readonly string[]).includes(key)) continue;
      out[key] = stripValue(child);
    }
    return out;
  };
  const stripNode = (node: QuestionNode): QuestionNode => ({
    ...node,
    data: stripValue(node.data) as Record<string, unknown>,
    children: (node.children ?? []).map(stripNode),
  });
  return { ...content, nodes: (content.nodes ?? []).map(stripNode) };
}

/**
 * 判分的三态（规格 §12「得分与正确率的口径」）。
 *
 * ⚠️ 没有第四档「题目坏了」—— 一道 `data` 被改坏的题只能落到 `incorrect`。
 * 这是**知情的取舍**：加第四档要让看板、奖励、导出三处都多一个分支，
 * 而它表达的是「教师建题时出错」，那件事的出路是编辑期校验（`validateQuestion`），
 * 不是判分。
 */
export type GradeState = 'correct' | 'partial' | 'incorrect';

/**
 * 一次判分的结果。**两个字段缺一不可**：
 *   · `state` 供看板的正确率与「哪道题错得多」；
 *   · `score` 供显示与累计。
 * 它们不是彼此的派生 —— `score` 是教师逐题填的**绝对值**，同一个 `partial`
 * 在两道题上可以是 1 分也可以是 0 分（教师把半对档填成 0）。
 */
export interface GradeResult { state: GradeState; score: number }

/**
 * 判分。`null` = 该题型不参与判分（主观题）。
 *
 * 🔴 **返回的是判定对象，不是布尔**（规格 §12「M4 重开了 §3-S」）：`isCorrect: boolean`
 * 表达不了「一半对」，而多选题的「漏选算半对」、排序 / 连线 / 归类的部分正确都要它。
 * ⇒ `isCorrect` 的语义**收窄为「全对」**，由 `state` 派生写入，它不再是第二真相源。
 *
 * ⚠️ `score` 是**绝对值**（该题「全对」或「半对」那个数），**不是** 0/0.5/1 的比例 ——
 * 逐题分值可以不同（§12 的例子：单选 2/1，填空 1/0），比例在各题之间不可比。
 *
 * ⚠️ 部分正确的统一口径：凡是「多个组成部分」的题（多选 / 填空多空 / 排序 / 连线 / 归类），
 * **部分正确 = 半对**。唯一的开关是多选题的「漏选算不算」（教师逐题选，§12 已裁定）。
 * 「选了错的」一律不给部分分 —— 半对只奖励「少做了」，不奖励「做错了」。
 *
 * 🔴 具体判分器在下面的 `JUDGES` 那张表里，与 `VALIDATORS` 同一手法：`Record<QuestionType, …>`
 * 把「加了题型却忘了写判分」变成**编译错误**，而不是一道永远没人判得了的题。
 *
 * ⚠️ `points` 由 `resolvePoints(node, pointsFromSettings(settings))` 给出 —— **别在调用点手拼**：
 * 手拼一次就有一处「忘了回落学习单级」的机会，而它唯一的表现是分数不对（没有报错）。
 *
 * @see judge — 三态是怎么判出来的
 */
export function grade(node: QuestionNode, value: unknown, points: QuestionPoints): GradeResult | null {
  const verdict = judge(node, value);            // 'correct' | 'partial' | 'incorrect' | null
  if (verdict === null) return null;
  const score = verdict === 'correct' ? points.full : verdict === 'partial' ? points.half : 0;
  return { state: verdict, score };
}

// ── `data` 的读取助手 ────────────────────────────────────────────────
// ⚠️ 全部写成**容错读**而不是 `as string[]` 断言：`data` 是库里的 JSON，任何手工改过的行
// 都可能有别的形状。断言只是让编译器闭嘴，运行时该炸还是炸 —— 而这里是保存路径，
// 一次抛错就是 500，教师看到的是「保存失败」，不是「你的第 3 题少了一个选项」。

/** 读一串**非空字符串**（丢掉别的元素）。 */
function readStrings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string' && !!item) : [];
}

/** 读选择题的选项 key（`Array<{ key; text }>`）。 */
function readOptionKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const key = (item as Record<string, unknown>).key;
    if (typeof key === 'string' && key) keys.push(key);
  }
  return keys;
}

/**
 * 读「条目数组」（`{ id; text }` / `{ id; label }`）的 id 列表，并**同时报告每一项是否合法**。
 *
 * 🔴 两个返回值必须分开。只返回 id 列表的话，「一个没有 id 的条目」会被静默丢掉 ——
 * 于是 `items: [{ id: 'a' }, { text: '甲' }]` 与 `correctOrder: ['a']` 会被判成
 * 「一个合法的排列」，而那道题在学生端少一个条目、在判分里少一项，**全程无报错**。
 * 没有 id 的条目是坏数据，不是可以忽略的噪声。
 */
function readItemIds(raw: unknown): { ids: string[]; allValid: boolean } {
  if (!Array.isArray(raw)) return { ids: [], allValid: false };
  const ids: string[] = [];
  let allValid = true;
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { allValid = false; continue; }
    const id = (item as Record<string, unknown>).id;
    if (typeof id !== 'string' || !id) { allValid = false; continue; }
    ids.push(id);
  }
  return { ids, allValid };
}

/** 读连线题的配对（`Array<{ leftId; rightId }>`），形状不全的条目直接丢掉。 */
function readPairs(raw: unknown): Array<{ leftId: string; rightId: string }> {
  if (!Array.isArray(raw)) return [];
  const pairs: Array<{ leftId: string; rightId: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.leftId === 'string' && row.leftId && typeof row.rightId === 'string' && row.rightId) {
      pairs.push({ leftId: row.leftId, rightId: row.rightId });
    }
  }
  return pairs;
}

/**
 * 从**作答值**里取一个字段。
 *
 * 🔴 作答值来自**请求体**（`WorksheetAnswer.value` 是一个 `Json` 列），可能根本不是对象 ——
 * `null` / 数字 / 字符串 / 数组都有。整体不是对象时一律回答 `undefined`，于是各判分器
 * 自己那条「取不到 ⇒ 判错」的路自然生效。
 * ⚠️ 数组要**单独挡掉**：`['B']` 也是 `typeof === 'object'`，而 `value.selected` 在它身上
 * 是 `undefined` —— 不挡会得到同样的结果，但挡掉之后「作答值必须是一个对象」这件事
 * 在代码里是显式的，而不是靠巧合。
 */
function readField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

/**
 * 读「一串非空字符串」，**一个元素不合格就整体作废**（返回 `null`）。
 *
 * 🔴 与 `readStrings` 的「跳过坏元素」**方向相反**，这是刻意的，别把两者混用：
 *   · `readStrings` 读的是**教师**的数据（`data.answers` 之类）—— 跳过坏元素，
 *     因为教师少填一个答案不该让学生拿不到分；
 *   · 本函数读的是**学生**的作答值（`selected` / `order`）—— 那里的元素**共同**构成
 *     一个集合或一个序列，跳过它就不是「忽略噪声」而是**改写答案**：
 *     `selected: ['A', 42]` 会被读成「只选了 A」，在「漏选算半对」下反而**多给**半分；
 *     `order: ['i2', 42, 'i3']` 会被读成两项，后面每一位的位置全部错开。
 *     两种都是**安静的虚高 / 错位**，所以坏形状一律整体判错。
 */
function readStrictStrings(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  for (const item of raw) {
    if (typeof item !== 'string' || !item) return null;
  }
  return raw as string[];
}

/**
 * 读学生提交的**连线**（`Array<{ leftId; rightId }>`），**一条不合格就整体作废**（返回 `null`）。
 *
 * 🔴 与上面 `readStrictStrings` 同一条纪律，而这里的代价更隐蔽：`readPairs` 会**丢掉**
 * 形状不全的那条线，于是它**凭空消失**—— 包括它在「一条线只能连一个端点」这个检测里的
 * 那一票。实测（审查者探针，正确配对 `[{l1,r1},{l2,r2}]`）：
 *
 * | 学生的 `links`（前两条都对） | 丢掉坏元素之后 | 判定 |
 * |---|---|---|
 * | `[{l1,r1},{l2,r2},{l1}]`（第三条缺 `rightId`） | 剩下两条**全对** | `correct`（2 分）❌ |
 * | `[{l1,r1},{l2,r2},{l1,r3}]`（第三条两边齐全、连错） | 三条都在 | `partial`（1 分）✅ |
 *
 * ⇒ **越残缺的作答反而拿到越高的分**。这正是「过滤不是忽略噪声，是改写答案」那句话的
 * 一个具体形态，所以坏元素一律整体判错。
 *
 * ⚠️ 教师那一侧的 `data.pairs` **继续走 `readPairs`**（宽松）：那里是「教师少填一项不该
 * 让学生拿不到分」的方向，而且 `validateQuestion` 的 `isCompleteMatching` 已经把
 * 「每一项都连到不同的一项上」钉在写入口了。
 */
function readStrictPairs(raw: unknown): Array<{ leftId: string; rightId: string }> | null {
  if (!Array.isArray(raw)) return null;
  const pairs: Array<{ leftId: string; rightId: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (typeof row.leftId !== 'string' || !row.leftId) return null;
    if (typeof row.rightId !== 'string' || !row.rightId) return null;
    pairs.push({ leftId: row.leftId, rightId: row.rightId });
  }
  return pairs;
}

/**
 * 填空题的**可接受答案**：`readStrings` 之后再丢掉「**归一化之后**是空串」的那些。
 *
 * 🔴 `readStrings` 丢的只是**空串**，丢不掉**只含空白**的串 —— 而 `normalizeFillText(' ')`
 * 就是 `''`。于是教师答案表里的一个 `' '`（多行输入框里很容易留下的一行）会变成
 * 「**学生什么都不填也算对**」：`normalizeFillText('') === normalizeFillText(' ')`。
 *
 * ⚠️ 这条坏数据**进得了库**：`validateQuestion` 只要求 `answers.some((a) => a.trim())` ——
 * `[' ', '光合作用']` **另一个元素非空即通过**（实测）。⇒ 判分这一侧必须自己挡住，
 * 不能指望写入口。（审查者实测的原始结果见 `worksheet-grade-m4.test.ts`：
 * `[' ', '光合作用']` + 学生 `''` / `'   '` 在修之前都是**满分**。）
 */
function readAcceptableAnswers(raw: unknown): string[] {
  return readStrings(raw).filter((answer) => normalizeFillText(answer) !== '');
}

/** 读一个 `字符串 → 非空字符串` 的映射（归类题的 `placement` / `assignment`），别的值丢掉。 */
function readStringMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}

/**
 * `candidate` 是不是 `ids` 的**一个排列（各出现一次）**。
 *
 * 🔴 用「排序后逐项相等」而不是「集合相等」：集合相等会把 `['a','a','b']` 与 `['a','b','b']`
 * 判成同一个排列，而前者意味着**两个条目共用一个 id** —— 学生端的作答值按 id 索引，
 * 那两个条目在判分里永远只算一个，而教师看到的是一道「有 3 个条目」的题。
 */
function isPermutation(ids: string[], candidate: string[]): boolean {
  if (ids.length !== candidate.length) return false;
  const sortedIds = [...ids].sort();
  const sortedCandidate = [...candidate].sort();
  return sortedIds.every((id, index) => id === sortedCandidate[index]);
}

/** 两个 id 数组**逐位相同**（用来判「学生看到的初始顺序 == 正确顺序」）。 */
function isSameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * 连线题的 `pairs` 是不是左栏 → 右栏的一个**完整一一对应**。
 *
 * 「完整」= 左栏每一项都恰好出现一次；「一一」= 右栏每一项最多被用一次。
 * 少了「一一」，两个左项连到同一个右项也能存进去 —— 学生端会画出两条线汇到一处，
 * 而判分里那个右项被算两次。
 */
function isCompleteMatching(
  leftIds: string[],
  rightIds: string[],
  pairs: Array<{ leftId: string; rightId: string }>,
): boolean {
  if (pairs.length !== leftIds.length) return false;
  const seenLeft = new Set<string>();
  const seenRight = new Set<string>();
  for (const pair of pairs) {
    if (!leftIds.includes(pair.leftId) || !rightIds.includes(pair.rightId)) return false;
    if (seenLeft.has(pair.leftId) || seenRight.has(pair.rightId)) return false;
    seenLeft.add(pair.leftId);
    seenRight.add(pair.rightId);
  }
  return seenLeft.size === leftIds.length;
}

// ── 判分器（`grade()` 的内部实现，不导出）────────────────────────────
//
// 🔴 全部走「**先判类型再取**」，与上面那批读取助手同一条纪律：`data` 是库里的 JSON、
// 作答值来自请求体，任何手工改过的行都可能有别的形状。**判分在提交路径上，一次抛错
// 就是 500**，而学生会看到「提交失败」并重试 —— 所以坏形状一律落到 `incorrect`。
//
// ⚠️ 三态里**没有第四档「读不懂」**：`null` 的语义是「这题型不判分」（主观题），
// 拿它表示「读不懂」会让看板把一个 500 级的问题显示成一道主观题。

/**
 * 单选与判断题**共用**的判分器。
 *
 * 两者在规格 §12 里「作答值与判分逐字相同」，差别只在编辑 UI（判断题不存 `options`，
 * 选项恒为对 / 错）—— 所以这里刻意是**同一个函数引用**，而不是复制一遍。
 */
function judgeSingleChoice(data: Record<string, unknown>, value: unknown): GradeState {
  const correct = readStrings(data.correctKeys);
  const selected = readStrictStrings(readField(value, 'selected'));
  // `correctKeys` 不是恰好一个 ⇒ 这道题**没有人能答对**（数据被改坏了）。三态里没有
  // 「题目坏了」这一档，只能判错 —— 出路是编辑期的 `validateQuestion`，不是判分。
  if (correct.length !== 1 || selected === null) return 'incorrect';
  // 🔴 先**去重**再判「是不是只选了一个」。这里有一处**有意的行为变更**：
  // `selected: ['B','B']` 在旧实现下是 `false`（`selected.length === 1` 不成立），
  // 现在是 `correct`（去重后就是「选了 B」）。方向是**松**的 —— 理由有两条：
  //   ① 学生端那个勾选控件**产生不了**这种值（手搓请求才可达）；
  //   ② 多选那一侧去重是**必须**的（不去重会让 `['A','A']` 凑成满分），两处得是
  //      同一套「作答值是一个集合」的语义，否则同一个形状在两个题型上含义不同。
  // `worksheet-grade-m4.test.ts` 有一条用例把这个口径**显式钉住**。
  const picked = [...new Set(selected)];
  // 选中不止一个 ⇒ 不符合题型（**不是**「部分对」）：单选只有一个组成部分，没有半对。
  if (picked.length !== 1) return 'incorrect';
  return picked[0] === correct[0] ? 'correct' : 'incorrect';
}

function judgeMultiChoice(data: Record<string, unknown>, value: unknown): GradeState {
  const correct = [...new Set(readStrings(data.correctKeys))];
  const selected = readStrictStrings(readField(value, 'selected'));
  if (correct.length === 0 || selected === null) return 'incorrect';

  // 🔴 **先去重再比个数。** 不去重的话 `selected: ['A','A']`（学生只勾了一个）会被读成
  // 「选了两个」—— 在「漏选算半对」下正好凑成 `size === correct.length` ⇒ **静默的满分**。
  const picked = new Set(selected);
  // 选了错的 ⇒ 一律不给部分分。半对只奖励「少做了」，不奖励「做错了」。
  for (const key of picked) {
    if (!correct.includes(key)) return 'incorrect';
  }
  if (picked.size === correct.length) return 'correct';
  // 空选不是「漏选」：什么都没做不该拿分（否则一道允许漏选的题在零作答时给半分）。
  if (picked.size === 0) return 'incorrect';
  return allowsMissing(data) ? 'partial' : 'incorrect';
}

/**
 * 多选题的「漏选算不算半对」（教师逐题选，规格 §12 的裁定）。
 *
 * 🔴 **只有逐字等于 `'allow-missing'` 才算「算」** —— 认不出的值（缺字段、拼错、
 * 换了个别的写法）一律按「全对才算」走。方向是刻意选的：把「认不出」当成「允许漏选」
 * 会让一道本该判错的题**静默地给学生半分**，而教师看不出任何异常（他以为自己选的是
 * 「全对才算」）；反过来，认不出的值当成「不给部分分」，教师至少能看到
 * 「我选了算半对但分数没给」—— 那是**可见的**。
 */
function allowsMissing(data: Record<string, unknown>): boolean {
  return data.partialCredit === 'allow-missing';
}

/**
 * 填空题（单空 + 多空）。
 *
 * 两个形状的分派判据与 `VALIDATORS` 里那支**逐字一致**（`Array.isArray(data.blanks)` 在不在）——
 * 两处用不同的判据会让一道题「校验时按多空、判分时按单空」，而它只表现为分数不对。
 */
function judgeFillBlank(data: Record<string, unknown>, value: unknown): GradeState {
  // ⚠️ **向后兼容**：`data.blanks` 缺席时走 M3 的单空路径（**形状**不动）。
  // 第一批落库的填空题一个 `blanks` 都没有，把它当成「零个空」会让全班的历史题目集体判错。
  //
  // 🔴 但**判据**有一处**有意扩大的行为变更**（不是「沿用不动」）：这里走
  // `readAcceptableAnswers`，它比旧实现多丢掉「归一化之后是空串」的答案元素。
  // 旧实现是 `answers.some(a => typeof a === 'string' && normalizeFillText(a) === normalized)` ——
  // **不过滤空白串**，于是教师的 `[' ', '光合作用']`（能存进库）+ 学生的空提交 = **满分**。
  // ⇒ `['', '光合作用']` 从「空提交算对」变成「算错」。方向是收紧，见
  // `readAcceptableAnswers` 的注释与 `worksheet-grade-m4.test.ts` 里的用例。
  if (!Array.isArray(data.blanks)) {
    const answers = readAcceptableAnswers(data.answers);
    const text = readField(value, 'text');
    if (typeof text !== 'string') return 'incorrect';
    const normalized = normalizeFillText(text);
    // 🔴 `normalizeFillText` **刻意不做大小写不敏感**（规格 §3-T）：化学式 / 英文填空的
    // 大小写是语义的一部分，把 `CO2` 判成 `co2` 正确比不判更糟。要多收几种写法请教师
    // 在 `answers` 里多列几个。
    // 单空只有一个组成部分 ⇒ **没有半对**。
    return answers.some((answer) => normalizeFillText(answer) === normalized) ? 'correct' : 'incorrect';
  }

  const blanks = data.blanks;
  // 🔴 空数组（教师建了题但一个空都没填）⇒ 判错。**不能**落到下面那句「全对」：
  // `hit === blanks.length` 在空数组上恒真（0 === 0），一道没有任何空的题会拿到满分，
  // 且全程无报错。
  if (blanks.length === 0) return 'incorrect';

  const texts = readField(value, 'texts');
  const list = Array.isArray(texts) ? texts : [];
  let hit = 0;
  for (const [index, blank] of blanks.entries()) {
    const answers = (blank && typeof blank === 'object' && !Array.isArray(blank))
      ? ((blank as Record<string, unknown>).answers)
      : undefined;
    // ⚠️ 多空这一侧同样要丢掉空白串（同一个洞的第二处），否则「这一空什么都不填」
    // 会因为 `normalizeFillText(' ') === normalizeFillText('')` 而被算成答对。
    const acceptable = readAcceptableAnswers(answers);
    const text = list[index];
    // 这一空没有可接受答案 / 学生没填 / 填的不是字符串 ⇒ **这一空算错**，其余照常给分。
    if (acceptable.length === 0 || typeof text !== 'string') continue;
    const normalized = normalizeFillText(text);
    if (acceptable.some((answer) => normalizeFillText(answer) === normalized)) hit += 1;
  }
  if (hit === blanks.length) return 'correct';
  return hit > 0 ? 'partial' : 'incorrect';
}

/**
 * 排序题：**逐位**比。
 *
 * ⚠️ 基准是 `data.correctOrder`，**不是** `data.items` —— `items` 是学生看到的**显示顺序**。
 * 拿 `items` 当基准就是「学生原封不动提交即满分」，而那正是 `validateQuestion` 拒绝
 * 「两者相同」的原因（它有自己的一条校验与注释）。
 *
 * 口径是**位置制**（「至少有 1 个位置对就不是全错」），不做移位距离、不做最长公共子序列 ——
 * 后两者会让「调换了 3 个」与「只调换了 1 个」在同一个分数上，而教师看到的是一个数。
 */
function judgeOrder(data: Record<string, unknown>, value: unknown): GradeState {
  const correct = readStrings(data.correctOrder);
  const order = readStrictStrings(readField(value, 'order'));
  if (correct.length === 0 || order === null) return 'incorrect';
  let hit = 0;
  const positions = Math.min(correct.length, order.length);
  for (let index = 0; index < positions; index += 1) {
    if (order[index] === correct[index]) hit += 1;
  }
  // 「全对」还要求**长度相同**：少放了条目 = 这题没做完，哪怕前面每一位都碰巧对上了。
  if (hit === correct.length && order.length === correct.length) return 'correct';
  return hit > 0 ? 'partial' : 'incorrect';
}

/**
 * 连线题。
 *
 * 🔴 **键名分工是已下的裁定**：教师的正确答案在 `data` 里叫 **`pairs`**，学生的作答值里
 * 叫 **`links`**（裁定 2026-09-23）。撞名会让那条「响应不得含答案键」的扫描
 * （`ANSWER_KEYS` 黑名单 + `worksheet-grade.test.ts` 的 `ANSWER_KEY_AUDIT`）
 * 把「学生答对了」读成「答案泄漏了」。两份都不能改。
 *
 * ⚠️ 「一条左项只能连一个右项」是连线题的**题面约束**（`validateQuestion` 用
 * `isCompleteMatching` 把它钉在教师那一侧）。学生两端有重复的连法时，那条线**不算对**：
 * 否则一个「l1 连到 r1、又连到 r3」的矛盾作答会因为「里面含有正确的那条」而拿满分，
 * 而学生端画出来的明明是三条线。
 *
 * ⚠️ 「重复」的判据是**每一个端点 id 只许出现一次**（左右各自）——
 * 所以**同一条线被原样提交两次**（`[{l1,r1},{l1,r1}]`）也算重复、那条也不算对。
 * 这比「只有两条**不同**的线共用端点才算重复」更严，**刻意保留**：它偏严，
 * 而偏严的代价是「一份正确作答 + 一条重复的线」掉到 `partial`（不会虚高），
 * 偏松的代价是矛盾作答拿满分（虚高，且教师查不出来）。
 */
function judgeMatch(data: Record<string, unknown>, value: unknown): GradeState {
  const pairs = readPairs(data.pairs);
  if (pairs.length === 0) return 'incorrect';
  // 🔴 `readStrictPairs`（含坏元素 ⇒ 整体判错），**不是** `readPairs` ——
  // 丢掉坏元素会让「更残缺的作答拿到更高的分」，见 `readStrictPairs` 的注释。
  const links = readStrictPairs(readField(value, 'links'));
  if (links === null || links.length === 0) return 'incorrect';

  // 两端各数一次出现次数：某个左项或右项**一共被用到超过一次**时，用到它的那些线都不算对。
  // ⚠️ 「重复使用」**不限于「被别的连线用了」**：同一条线被原样提交两次
  // （`[{l1,r1},{l1,r1}]`）同样算重复 —— 上面 JSDoc 那句「每一个端点 id 只许出现一次」
  // 就是这么写的，这里是对它的行内复述（曾经写成「被**别的**连线重复使用时」，
  // 那句话把同一条线提交两次的情形漏在外面，与实现不符）。
  const leftUse = new Map<string, number>();
  const rightUse = new Map<string, number>();
  for (const link of links) {
    leftUse.set(link.leftId, (leftUse.get(link.leftId) ?? 0) + 1);
    rightUse.set(link.rightId, (rightUse.get(link.rightId) ?? 0) + 1);
  }
  let hit = 0;
  for (const pair of pairs) {
    const matched = links.some((link) =>
      link.leftId === pair.leftId
      && link.rightId === pair.rightId
      && leftUse.get(link.leftId) === 1
      && rightUse.get(link.rightId) === 1);
    if (matched) hit += 1;
  }
  if (hit === pairs.length) return 'correct';
  return hit > 0 ? 'partial' : 'incorrect';
}

/**
 * 归类题。
 *
 * 🔴 **键名分工同连线题**：教师侧是 **`placement`**，学生侧是 **`assignment`**（同一条裁定）。
 *
 * ⚠️「有条目没放 ⇒ 那一条算错」在**两个方向**上都要成立，而它们在代码上是同一条路
 * （都要 `assignment[id] === placement[id]` 才记一次对）：
 *   · 学生的 `assignment` 缺键 ⇒ 这一条算错（他没放）；
 *   · 教师的 `placement` 缺键 ⇒ 这一条**没有任何人**能落对（他建题时漏填）。
 * 用例里把两者**分开钉住**，因为它们代价不同：后者会让一个「其他都对」的学生
 * **答对了却拿不到满分**，而教师查不出来（§14.4 那一类）。
 */
function judgeCategorize(data: Record<string, unknown>, value: unknown): GradeState {
  const items = readItemIds(data.items).ids;
  const placement = readStringMap(data.placement);
  const assignment = readStringMap(readField(value, 'assignment'));
  // 没有条目 ⇒ 没有可判的东西。`hit === items.length` 在空数组上恒真（0 === 0）——
  // 少了这条守卫，一道零条目的题会给满分且无报错。
  if (items.length === 0) return 'incorrect';

  let hit = 0;
  for (const id of items) {
    const expected = placement[id];
    if (!expected) continue;   // 教师的漏填 ⇒ 这一条谁也落不对
    if (assignment[id] === expected) hit += 1;
  }
  if (hit === items.length) return 'correct';
  return hit > 0 ? 'partial' : 'incorrect';
}

/**
 * 题型 → 判分器。**这张表就是「这道题判不判分、怎么判」这个问题的唯一答案。**
 *
 * 🔴 与 `VALIDATORS` 同一手法（`Record<QuestionType, …>`）：往 `QUESTION_TYPES` 里加题型
 * 而忘了在这里补一条是**编译错误**（TS2739「缺少属性」），不是一道「永远不判分、
 * 看板上永远没有对错、整卷永远停在 in-progress」的题。`VALIDATORS` 的注释记着这条纪律
 * 的由来，这里是它的第二个受益者。
 *
 * ⚠️ `short-answer` 那支 `() => null` **不只是「不判分」的口径，也是一个必须被明确作出的
 * 决定**：`Record` 缺一个键就是编译错误，所以它不能靠「忘了写」来达成。
 */
const JUDGES: Record<QuestionType, (data: Record<string, unknown>, value: unknown) => GradeState | null> = {
  // 🔴 **任务没有作答值，永远不该走到判分**。所以这里**抛**，不返回 `null`。
  //    返回 `null`（= 没判过）会让「任务被当成一道题」这件事**一路滑到界面上**：
  //    看板多一格、抽屉多一行、统计的分母悄悄变大，而全程没有一处报错。
  //    抛出去则当场暴露，且暴露在**服务端日志**里 —— 那里才是能查的地方。
  task: () => { throw new Error('task 不是可作答的题：判分器不该被调到它'); },
  'single-choice': judgeSingleChoice,
  // 判断题与单选**共用同一个判分器**（规格 §12：作答值与判分逐字相同）。
  'true-false': judgeSingleChoice,
  'multi-choice': judgeMultiChoice,
  'fill-blank': judgeFillBlank,
  'short-answer': () => null,
  order: judgeOrder,
  match: judgeMatch,
  categorize: judgeCategorize,
  // ★ M4b：绘图题**不判分**（规格 §12 裁定 3）。与 `'short-answer': () => null`
  // 逐字同一个处置 —— 学生画图，教师人眼看，看板上它落在 `'none'` 那一档。
  // ⚠️ 别写成 `() => ({ state: 'incorrect', score: 0 })`：那会让一幅画被画成「✗ 答错」
  // 并计进正确率的分母（裁定 3 明写 `'none'` **不得画成答错**）。
  drawing: () => null,
};

/**
 * 判分的分派。**不导出** —— 绕过 `points` 直接拿三态会让「得分」与「对错」在两条路上
 * 各算一次，而规格 §12 要收口的正是这件事（`isCorrect` 的语义收窄为「全对」，
 * 由 `gradeState` 派生写入）。
 */
function judge(node: QuestionNode, value: unknown): GradeState | null {
  // 🔴 ★ M4b：手写 / 绘图**不参与判分**（规格 §12 裁定 3：「`grade()` 恒回 `null`」）。
  //
  // 判据是**作答值的格式**，不是题型 —— 教师在 D1 才拿到「作答方式」那个开关，
  // 所以一道问答题可能「之前是键盘作答（text/v1），之后改成手写」，学生那份**已经交上来**
  // 的 text 值仍然该被正常处置，而 ink 值一个判分字段都读不到。
  //
  // ⚠️ 这里是**读** `format`（不是校验它）：读它多出来的结论只有一个 —— `null`（不判分），
  // 而 `null` 正是裁定 3 要的那一档。**没有新增任何拒绝路径**，所以
  // `worksheet-answer-value.ts:48-76`（那段「`format` 在服务端只被读两处」）那条
  // 「不得给服务端补 format 校验」的纪律没被违反。
  //
  // 🔴 **必须是 `null`，不能是 `{ state: 'incorrect', score: 0 }`**：后者会让学生的一幅画
  // 在看板上被画成「✗ 答错」并计进正确率的分母 —— 裁定 3 明写「`'none'` **不得画成答错**」。
  //
  // ⚠️ 与 `JUDGES.drawing` 的 `() => null` 是**两条独立的闸**，两条都要：
  // 一条管「值是 ink」（教师把作答模式改回键盘之后仍然挡得住 —— 那时题型不再是 `drawing`），
  // 一条管「题型就是绘图题」（值被手改成别的形状时也挡得住 —— 那时 `format` 不是 ink）。
  if (isInkFormat(readField(value, 'format'))) return null;
  // ⚠️ `node.data` 也走「先判类型再取」：`Record<string, unknown>` 是**编译期的承诺**，
  // 而库里的 JSON 可能是 `null` / 数组 / 别的标量 —— `null.correctKeys` 会在提交路径上
  // 抛一次 500，学生看到的是「提交失败」。
  const data = (node.data && typeof node.data === 'object' && !Array.isArray(node.data))
    ? node.data as Record<string, unknown>
    : {};
  // ⚠️ `node.type` 同样是编译期的承诺：手工改过的行可能是一个**不存在的题型**。
  // 取不到判分器时回答 `null`（= 不判分）—— 与主观题同一档，看板不会把它算进
  // 「已判分」的分母，也就不会报出一个错的正确率。
  const judgeForType: ((data: Record<string, unknown>, value: unknown) => GradeState | null) | undefined =
    JUDGES[node.type];
  if (!judgeForType) return null;
  return judgeForType(data, value);
}

/** 单选与判断题**共用**的校验：`correctKeys` 恰好一个。`checkOptions` 只对单选为真。 */
function validateSingleAnswer(
  node: QuestionNode,
  errors: string[],
  label: string,
  checkOptions: boolean,
): void {
  if (checkOptions && readOptionKeys(node.data.options).length < 2) {
    errors.push(`${label}至少需要两个选项`);
  }
  if (readStrings(node.data.correctKeys).length !== 1) {
    errors.push(`${label}必须且只能指定一个正确答案`);
  }
}

/**
 * 题型 → 校验器。**这张表就是「新题型要不要校验、校验什么」这个问题的唯一答案。**
 *
 * 🔴 **为什么是 `Record<QuestionType, …>` 而不是原来那条 `if` 链**：
 * `if` 链靠开头一句「加题型时记得同步加一支」的注释维持，而**漏加一支是静默的** ——
 * `validateQuestion` 对不认识的题型返回空错误（= 通过），于是那道题**永远无法作答、
 * 也永远无法提交**，整卷永远停在 `in-progress`、看板「已交 N/M」永远填不满，
 * **全程无一处报错**。`Record<QuestionType, …>` 把「加了题型却没补校验」变成**编译错误**
 * （TS2739「缺少属性」）—— 与 `ANSWER_KEY_AUDIT`（`worksheet-grade.test.ts`）同一手法，
 * 而且它在**提交之前**就红，不依赖有人记得跑测试。
 *
 * ⚠️ 试过「`if` 链 + 末尾 `assertNever(node.type)`」，**在这里不成立**：TypeScript 5.6
 * 在「分支体不终止控制流」的链上不会把判别属性收窄成 `never`（实测：参数 `t: 'a' | 'b'`，
 * 两个空 `if (t === …) {}` 之后 `t` 仍然是 `'a' | 'b'`）⇒ `assertNever` 恒报
 * 「Argument of type 'string' is not assignable to parameter of type 'never'」，
 * 它不是一道门，只是一行常红的代码。换成这张表之后门是真的。
 *
 * ⚠️ 表只能保证「每个题型都有一条」，**不能**保证那条不是空的 —— 后者由
 * `worksheet-grade.test.ts` 的「空 `data` 必须被拒绝」那条用例行为性地钉住。
 */
const VALIDATORS: Record<QuestionType, (node: QuestionNode, errors: string[]) => void> = {
  /**
   * ★ 2026-09-25：**任务容器**的校验。
   *
   * 🔴 它要拦住的是两件事，两件都会让下游静默出错：
   *   1. **任务里嵌套任务** —— 题号会变成三级，而 UI 那套「重复」的优势立刻消失
   *      （教师裁定：任务只装小题）。schema 里没有禁止它的东西，所以只能在这里拦。
   *   2. **任务里一道小题都没有** —— 一个空任务在界面上是一块空白，而学生端会渲染出
   *      一个只有标题、没有任何可作答东西的段落。**允许它存在没有任何好处**，
   *      而迁移造出来的「任务一」如果原学习单是空的，正好会命中这一条 ——
   *      ⇒ 迁移那边要保证不造空任务（见 `specs/2026-09-25-学习单-任务制与编辑页重设计.md` §五）。
   *
   * ⚠️ **任务的说明允许留空**（教师裁定 ①a：任务只是分组 + 一段说明）——
   * 所以这里**不校验 `prompt` 非空**。「任务一」这种纯分组是合法的。
   */
  task: (node, errors) => {
    const children = node.children ?? [];
    if (children.length === 0) errors.push('任务里至少要有一道小题');
    if (children.some((child) => child.type === 'task')) errors.push('任务里不能再嵌套任务');
  },
  'single-choice': (node, errors) => validateSingleAnswer(node, errors, '单选题', true),
  // 判断题与单选**共用同一个校验器**：作答值与判分逐字相同（规格 §12），
  // 差别只在编辑 UI —— 判断题不存 `options`（选项恒为对/错两个），所以不查选项数。
  'true-false': (node, errors) => validateSingleAnswer(node, errors, '判断题', false),

  'multi-choice': (node, errors) => {
    const optionKeys = readOptionKeys(node.data.options);
    const correct = readStrings(node.data.correctKeys);
    if (optionKeys.length < 2) errors.push('多选题至少需要两个选项');
    if (correct.length < 1) errors.push('多选题至少要指定一个正确答案');
    // 🔴 每个 key 都必须指向真实存在的选项：`correctKeys` 里一个不存在的字母
    // ⇒ 那道题**没有任何学生能答对**，而它在看板上只表现为「正确率 0%」——
    // 教师会去怀疑学生，不会来怀疑这道题。
    if (correct.some((key) => !optionKeys.includes(key))) errors.push('多选题的正确答案里有不存在的选项');
  },

  'fill-blank': (node, errors) => {
    // ⚠️ **向后兼容**：`data.blanks` 缺席时走原来的单空路径（M3 的形状，不动）。
    // 第一批落库的填空题一个 `blanks` 都没有，把它们当成「零个空」会让全班的历史
    // 题目在下次保存时集体报错。
    if (!Array.isArray(node.data.blanks)) {
      const answers = readStrings(node.data.answers);
      if (!answers.some((answer) => answer.trim())) errors.push('填空题至少要有一个可接受的答案');
      return;
    }
    const blanks = node.data.blanks;
    if (blanks.length === 0) errors.push('填空题至少要有一个空');
    for (const blank of blanks) {
      const answers = (blank && typeof blank === 'object' && !Array.isArray(blank))
        ? (blank as Record<string, unknown>).answers
        : undefined;
      if (!readStrings(answers).some((answer) => answer.trim())) {
        // 同一个毛病不按空数重复说 N 遍（一道 10 个空的题会甩出 10 条一样的错）。
        errors.push('填空题每个空至少要有一个可接受的答案');
        break;
      }
    }
  },

  'short-answer': () => {
    // 主观题**只有题干**要校验，而题干在上面的 `validateQuestion` 里已经查过 —— 所以
    // 这一支是空的。⚠️ 它**必须存在**：「主观题不校验别的」本身就是一个必须被明确作出的
    // 决定，`Record` 缺一个键就是编译错误，所以它不能靠「忘了写」来达成。
  },

  order: (node, errors) => {
    const { ids, allValid } = readItemIds(node.data.items);
    const correctOrder = readStrings(node.data.correctOrder);
    if (ids.length < 2) errors.push('排序题至少需要两个条目');
    else if (!allValid) errors.push('排序题里有条目缺少 id');
    else if (new Set(ids).size !== ids.length) errors.push('排序题里有重复的条目 id');
    else if (!isPermutation(ids, correctOrder)) errors.push('排序题的「正确顺序」必须正好是这些条目各一次');
    else if (isSameOrder(ids, correctOrder)) {
      // 🔴 **本步骤最容易漏掉的一条。** `items` 是学生看到的**初始顺序**，两者相同
      // ⇒ 学生什么都不做就是满分。这不是理论风险：教师在编辑器里按正确顺序录入条目
      // 是最自然的操作，而那个编辑器我们正准备做。
      errors.push('排序题的条目顺序与正确顺序相同 —— 请先把条目打乱，或点「打乱顺序」');
    }
  },

  match: (node, errors) => {
    const left = readItemIds(node.data.left);
    const right = readItemIds(node.data.right);
    const pairs = readPairs(node.data.pairs);
    if (left.ids.length < 2) errors.push('连线题左栏至少需要两个条目');
    if (right.ids.length !== left.ids.length) errors.push('连线题左右两栏的条目数必须相同');
    if (!left.allValid || !right.allValid) errors.push('连线题里有条目缺少 id');
    else if (new Set(left.ids).size !== left.ids.length || new Set(right.ids).size !== right.ids.length) {
      errors.push('连线题里有重复的条目 id');
    } else if (!isCompleteMatching(left.ids, right.ids, pairs)) {
      errors.push('连线题必须把左栏每一项都连到右栏的一个不同项上');
    }
  },

  categorize: (node, errors) => {
    const items = readItemIds(node.data.items);
    const zones = readItemIds(node.data.zones);
    const placement = (node.data.placement && typeof node.data.placement === 'object' && !Array.isArray(node.data.placement))
      ? node.data.placement as Record<string, unknown>
      : {};
    if (items.ids.length < 1) errors.push('归类题至少需要一个条目');
    if (zones.ids.length < 2) errors.push('归类题至少需要两个框');
    if (!items.allValid) errors.push('归类题里有条目缺少 id');
    else if (new Set(items.ids).size !== items.ids.length) errors.push('归类题里有重复的条目 id');
    // ⚠️ 框的 id 重复**也要查**（与上面条目那条同一个理由）：两个框共用一个 id 时
    // `placement` 里那个值指向哪一个是不确定的 —— 学生端会画出两个都叫这个名字的框，
    // 而判分只认其中一个。少了这条，它是一份**看着合法**的坏数据。
    else if (new Set(zones.ids).size !== zones.ids.length) errors.push('归类题里有重复的框 id');
    // 🔴 「每个条目都落在某个框里」要查**两件事**：`placement` 里有没有**这一项**，
    // 以及那个框**存不存在**。只查前者的话，一个指向已删掉的框的 id 会一路存进去 ——
    // 学生端把那个条目画到不存在的框里（或干脆不画），而它永远判不了分。
    else if (items.ids.some((id) => {
      const zoneId = placement[id];
      return typeof zoneId !== 'string' || !zones.ids.includes(zoneId);
    })) {
      errors.push('归类题每个条目都必须落到一个框里');
    }
  },

  // ★ M4b：绘图题**没有答案要配**（学生画图，教师人眼看）—— 所以它不走任何题型专属判据，
  // 只留下 `validateQuestion` 里那条**公共**校验（题干不能为空，`validateQuestion` 的函数体里
  // 只有这一条）。这一支是**刻意的空实现**，不是「还没写」。
  //
  // ⚠️ **别给它加一条「必须有 data」之类的规则**：绘图题在 `newQuestion` 里的 `data` 是
  // `{}`，加了就等于「新建的绘图题永远存不下去」，而那条错误文案说的是「题干不能为空」
  // —— 一个**说得通但与真实原因无关**的提示（C2 的 Step 1 为同一件事写过这条代价）。
  drawing: () => {},
};

/** 编辑期校验。返回中文错误列表，空数组表示通过。 */
export function validateQuestion(node: QuestionNode): string[] {
  const errors: string[] = [];
  if (!node.prompt.trim()) errors.push('题干不能为空');
  VALIDATORS[node.type](node, errors);
  return errors;
}
