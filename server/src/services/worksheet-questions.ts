/** 学习单的题型注册表。**纯函数，全部在服务端** —— 本项目不引入前端测试框架（规格 §11）。 */

// ★ M4b：判分前的 ink 短路，以及写入口的体积校验，都建立在同一份格式判据上。
// ⚠️ 这是**本文件唯一**的 import —— 它不引入任何循环（`worksheet-ink.ts` 自身不 import）。
// ★ 2026-09-30：判分侧要**剥掉公式定界符**（裁定 ④）—— 与显示侧同源于一条规则。
import { mathText, splitMath } from './worksheet-math.js';
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
  // ★ 2026-09-26（教师）：「增加一个新的题型，叫**选择填空**，题干跟普通填空题类似，
  //    但是题干下方会出现几个待选词，学生可以**拖拽**它们到正确的填空区域来完成答题。」
  // 🔴 它复用填空题的**全部**机制：题干里的空（`promptRuns` 的 `blank` 标识）、
  //    答案的存储（`answers: string[][]` 每空一份）、**判分器**（`JUDGES['fill-blank']`）。
  //    它多出来的只有两样：`data.choices`（待选词）与「学生用拖拽填」这个交互。
  //    ⇒ **别给它另写一份判分**（先例：判断题与单选共用一支）。
  //    ⚠️ 校验上它多一条硬要求：`choices.length >= answers.length` ——
  //    每个词只能用一次（教师裁定），词不够时这道题**无解**，而那种题在屏幕上看不出异常。
  'choice-blank',
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
 * 逐题分值的默认档。**与第一批行为逐字相同**（规格 §12 裁定 3：星星 ⭐、全对 1 / 部分给分 0）
 * —— 它同时是「题上没有 `points`」时 `normalizePointValue` 的回落值。
 */
export const DEFAULT_POINTS: QuestionPoints = { full: 1, half: 0 };

/**
 * 分值的取值上限。
 *
 * ⚠️ 它是**两个档共用的上界**（`full` 与 `half` 各自上到 99），不是「`full + half <= 99`」——
 * 后者会让「全对 60 / 部分给分 50」这种（部分给分拿得比全对多的笔误）悄悄通过，
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
 *     「部分给分 0 是一个有效值」上面；
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
  inputMode: 'keyboard' | 'handwriting' | 'photo';
  /**
   * ★ M4a：逐题分值。**留空 = 继承学习单级**（规格 §12 裁定 4）——
   * 所以 `undefined` 是一个**有意义的取值**，不是「还没填」。
   * 它**不进 `data`**：它是题型无关的（8 个题型都要），而 `data` 是各题型自己的形状，
   * 放进去就要在 8 个题型里各写一遍读法。
   */
  points?: QuestionPoints;
  /**
   * ★ 2026-09-25（教师裁定）：**是否允许自动评分**。缺省 / `true` = 允许；`false` = 不判分。
   *
   * 它放**顶层**而不是 `data` 里，理由与 `points` 逐字相同：**题型无关**（九个题型都要回答
   * 这一格），塞进 `data` 就要在九个题型里各写一遍读法。
   *
   * 🔴 判分器以**这个开关**为准，**不再**以「有没有答案」推断 —— 两条路留着就会有两个来源
   *（教师关掉开关时答案**保留在库里**，见下面的裁定），而那时「有答案却不判分」是**正常状态**。
   */
  autoGrade?: boolean;
  /**
   * ★ 2026-09-25（教师裁定）：**部分给分的容错档** —— 「错不超过 N 处 ⇒ 部分给分」。
   * 缺省（`undefined`）= **旧规则**「只要有一部分对就给分」。
   *
   * 🔴 缺省**不能**换算成某个数存下来：旧规则是「至少对 1 处」，它**随题面变**
   *（教师给连线加一条，总数就变了）⇒ 存成死数会让判据在改题面时**静默漂移**。
   * ⚠️ 判据（`meetsTolerance`）只认 `undefined` 与 `>= 1` 的整数；其他值一律当缺省。
   */
  partialTolerance?: number;
  data: Record<string, unknown>;
  children: QuestionNode[];
}
export interface WorksheetContent { schemaVersion: number; nodes: QuestionNode[] }


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
 * 下一个读这段的人以为可以「只让部分给分档跟随学习单」：
 *
 * | 教师填了 | 落库的 `points`（`normalizeNode` → `normalizePoints`） | 本函数的结果 |
 * |---|---|---|
 * | 两个框都留空 | 键**不存在** | 整份回落学习单级 ✅ |
 * | 全对 7 / 部分给分留空 | `{ full: 7, half: 0 }` —— 缺的那一端被补成 `DEFAULT_POINTS` | `{ full: 7, half: 0 }` ⇒ **部分给分得 0 分** |
 * | 全对 7 / 部分给分 2 | `{ full: 7, half: 2 }` | 原样 |
 *
 * ⚠️ 第二行**真的会发生**（不是理论风险）：在隔离库上 `POST /api/worksheets`、载荷
 * `points: {full: 7}` 的实测结果是回包与库里**都是** `points: {full: 7, half: 0}`。
 * ⇒ **把这个函数改成逐字段回落修不了它**：库里那个 `half: 0` 是一个**有效分值**
 * （`isUsablePointValue(0)` 为真），逐字段回落会照用它。
 * 真正的防线在**写入口**：编辑器的 UI 不允许只填一个框（`src/app/teacher/worksheets/edit/`
 * 的 `findPartialPoints` + `save()` 把它拦下）⇒ 第二行在**走编辑器的数据上不可达**。
 * 它仍可能出现在手工改过的库行上，届时部分给分得 0 分 —— 那是这条整对象语义的**已知代价**，
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

/**
 * 读一道题的容错档。**只有 `>= 1` 的整数才算设过** —— 与 `normalizePointValue` 同一把尺子：
 * 库里可能出现任何形状（`0` / 小数 / 字符串 / `null`），认不出的**一律当缺省**（旧规则）。
 * ⚠️ 这里**不抛也不报错**：它是读路径，一份手改过的数据不该让判分 500。
 */
export function toleranceOf(node: QuestionNode): number | null {
  const raw = node.partialTolerance;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) return null;
  return raw;
}

/**
 * ★ 2026-09-25：**部分给分的唯一判据** —— 「错了多少处」是否在容错之内。
 *
 * `tolerance === null` ⇒ **旧规则**：只要有一部分对就给分（`hit > 0`）。
 * 否则 ⇒ `总数 - 对的 ≤ N`。
 *
 * 🔴 五个题型（多空填空 / 排序 / 连线 / 归类 / 多选）共用这一个函数。各写一份算术
 * 是本仓反复栽的那类分叉：改了一处、另一处还是旧的，而屏幕上只是「分数不太对」。
 */
export function meetsTolerance(hit: number, total: number, tolerance: number | null): boolean {
  if (tolerance === null) return hit > 0;
  return total - hit <= tolerance;
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
export const ANSWER_KEYS = [
  'correctKeys', 'answers', 'explanation', 'correctOrder', 'pairs', 'placement',
  // 评分标准只供教师与 AI 分析使用，不能随学生版学习单下发。
  'rubricText', 'rubricImageUrl',
] as const;

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
 * 在两道题上可以是 1 分也可以是 0 分（教师把部分给分档填成 0）。
 */
export interface GradeResult { state: GradeState; score: number }

/**
 * 判分。`null` = 该题型不参与判分（主观题）。
 *
 * 🔴 **返回的是判定对象，不是布尔**（规格 §12「M4 重开了 §3-S」）：`isCorrect: boolean`
 * 表达不了「一部分给分」，而多选题的「漏选算部分给分」、排序 / 连线 / 归类的部分正确都要它。
 * ⇒ `isCorrect` 的语义**收窄为「全对」**，由 `state` 派生写入，它不再是第二真相源。
 *
 * ⚠️ `score` 是**绝对值**（该题「全对」或「部分给分」那个数），**不是** 0/0.5/1 的比例 ——
 * 逐题分值可以不同（§12 的例子：单选 2/1，填空 1/0），比例在各题之间不可比。
 *
 * ⚠️ 部分正确的统一口径：凡是「多个组成部分」的题（多选 / 填空多空 / 排序 / 连线 / 归类），
 * **部分正确 = 部分给分**。唯一的开关是多选题的「漏选算不算」（教师逐题选，§12 已裁定）。
 * 「选了错的」一律不给部分分 —— 部分给分只奖励「少做了」，不奖励「做错了」。
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
  const data = node.data && typeof node.data === 'object' && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : {};
  const mixedFill = node.type === 'fill-blank' ? explicitFillGrading(data) : [];
  if (mixedFill.length > 0) {
    const auto = mixedFill
      .map((setting, index) => ({ ...setting, index }))
      .filter(setting => setting.gradingMode === 'auto');
    if (auto.length === 0) return null;
    const rawTexts = readField(value, 'texts');
    const texts = Array.isArray(rawTexts) ? rawTexts : [readField(value, 'text')];
    let hit = 0;
    let score = 0;
    auto.forEach((setting) => {
      const text = texts[setting.index];
      const accepted = gradableAnswers(data, setting.index);
      if (typeof text !== 'string' || accepted.length === 0) return;
      const normalized = normalizeFillText(text);
      if (accepted.some(answer => normalizeFillText(answer) === normalized)) {
        hit += 1;
        score += setting.maxScore;
      }
    });
    return { state: hit === auto.length ? 'correct' : hit > 0 ? 'partial' : 'incorrect', score };
  }
  if ((node.type === 'fill-blank' || node.type === 'choice-blank')
      && (data.fillScoring === 'per-blank' || data.fillScoring === 'whole')) {
    if (node.autoGrade === false) return null;
    const stats = fillHitStats(data, value);
    if (stats.total === 0) return { state: 'incorrect', score: 0 };
    const state: GradeState = stats.hit === stats.total ? 'correct' : stats.hit > 0 ? 'partial' : 'incorrect';
    if (data.fillScoring === 'per-blank') return { state, score: stats.hit * points.full };
    return { state, score: state === 'correct' ? points.full : 0 };
  }
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
export function readStrings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string' && !!item) : [];
}

/** 读选择题的选项 key（`Array<{ key; text }>`）。 */
export function readOptionKeys(raw: unknown): string[] {
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
export function readItemIds(raw: unknown): { ids: string[]; allValid: boolean } {
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
export function readPairs(raw: unknown): Array<{ leftId: string; rightId: string }> {
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
 *     `selected: ['A', 42]` 会被读成「只选了 A」，在「漏选算部分给分」下反而**多给**半分；
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
 * 让学生拿不到分」的方向，而且 `validateQuestion` 的 `isValidMatching` 已经把
 * 「已设置的答案必须一一对应」钉在写入口了。
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
export function readStringMap(raw: unknown): Record<string, string> {
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
 * 连线题的 `pairs` 是不是一组合法的**可留空连线集合**。
 *
 * 左栏允许放干扰项，因此不要求每一项都出现；自动评分开启时至少要有一组答案，
 * 否则整题没有任何可评分内容。
 *
 * ★ 2026-09-28（教师裁定「甲」）：**去掉了「左右端点最多各用一次」** —— 那条是
 * 「一对一」这个假设的落点，而教师要支持一对多 / 多对一 / 多对多。留着它的话，
 * 勾选矩阵里同一行勾两格**存都存不下**（保存被拒），而判分那一侧已经先放开了。
 * ⇒ 现在只拦两件真正坏的事：
 *   ① 答案指向不存在的条目（左或右）；
 *   ② **同一条线重复**（`{l1,r1}` 出现两次）—— 它没有任何意义，而判分会把它算两次命中。
 * ⚠️ 这**改变了老题能不能保存**的判断：一份「两个左项连同一个右项」的答案从前存不下、
 *    现在存得下（教师知情选了甲）。
 * ⚠️ 调用点那条错误文案（「至少设置一组正确配对」）对**重复线**那种失败是**说不清**的
 *    —— 那是本次之前就在的毛病，我没顺手改（改它要动那条用例断言的文案），
 *    但在这里记一笔：下次碰这段时把它拆成两句。
 */
function isValidMatching(
  leftIds: string[],
  rightIds: string[],
  pairs: Array<{ leftId: string; rightId: string }>,
): boolean {
  if (pairs.length < 1) return false;
  const seen = new Set<string>();
  for (const pair of pairs) {
    if (!leftIds.includes(pair.leftId) || !rightIds.includes(pair.rightId)) return false;
    const key = `${pair.leftId}\u0000${pair.rightId}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
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
function judgeSingleChoice(data: Record<string, unknown>, value: unknown): GradeState | null {
  const correct = readStrings(data.correctKeys);
  const selected = readStrictStrings(readField(value, 'selected'));
  // ★ 2026-09-25（教师裁定）：**没设答案 ⇒ 这道题不判分**（回 `null` = 没判过）。
  // 它与主观题走同一条路：只统计作答进度，不画任何对错标记。
  // 🔴 别把它判成 `incorrect` —— 那会让看板显示「正确率 0%」、抽屉里每人都画 ✗、
  // 导出 Word 一列「错」，而教师会去怀疑学生，不会来怀疑这道题。
  if (correct.length === 0) return null;
  // ⚠️ 与「没设」分开：`correctKeys` **多于一个**是**坏数据**（单选只有一个正确答案），
  // 判错是响亮的那条路（学生端会画 ✗、教师会来问），静默回 `null` 会让它一直没人发现。
  if (correct.length !== 1 || selected === null) return 'incorrect';
  // 🔴 先**去重**再判「是不是只选了一个」。这里有一处**有意的行为变更**：
  // `selected: ['B','B']` 在旧实现下是 `false`（`selected.length === 1` 不成立），
  // 现在是 `correct`（去重后就是「选了 B」）。方向是**松**的 —— 理由有两条：
  //   ① 学生端那个勾选控件**产生不了**这种值（手搓请求才可达）；
  //   ② 多选那一侧去重是**必须**的（不去重会让 `['A','A']` 凑成满分），两处得是
  //      同一套「作答值是一个集合」的语义，否则同一个形状在两个题型上含义不同。
  // `worksheet-grade-m4.test.ts` 有一条用例把这个口径**显式钉住**。
  const picked = [...new Set(selected)];
  // 选中不止一个 ⇒ 不符合题型（**不是**「部分对」）：单选只有一个组成部分，没有部分给分。
  if (picked.length !== 1) return 'incorrect';
  return picked[0] === correct[0] ? 'correct' : 'incorrect';
}

function judgeMultiChoice(data: Record<string, unknown>, value: unknown, tolerance: number | null = null): GradeState | null {
  const correct = [...new Set(readStrings(data.correctKeys))];
  const selected = readStrictStrings(readField(value, 'selected'));
  // ★ 2026-09-25（教师裁定）：没设答案 ⇒ 不判分（回 `null`，理由与 `judgeSingleChoice` 同一段）。
  if (correct.length === 0) return null;
  if (selected === null) return 'incorrect';

  // 🔴 **先去重再比个数。** 不去重的话 `selected: ['A','A']`（学生只勾了一个）会被读成
  // 「选了两个」—— 在「漏选算部分给分」下正好凑成 `size === correct.length` ⇒ **静默的满分**。
  const picked = new Set(selected);
  // 选了错的 ⇒ 一律不给部分分。部分给分只奖励「少做了」，不奖励「做错了」。
  for (const key of picked) {
    if (!correct.includes(key)) return 'incorrect';
  }
  if (picked.size === correct.length) return 'correct';
  // 空选不是「漏选」：什么都没做不该拿分（否则一道允许漏选的题在零作答时给半分）。
  if (picked.size === 0) return 'incorrect';
  // ★ 2026-09-25：容错档设过 ⇒ 「漏选不超过 N 个」（`total` = 正确答案的个数，`hit` = 选对几个）；
  // 没设 ⇒ **旧行为**（那个「漏选算不算」的开关）。
  // ⚠️ 两种口径写在同一行里是有意的：教师把容错档一设，`partialCredit` 那个键就**不再被读**
  //（它在界面上是「判分依据」的默认档，一旦选了具体数字就由那个数字说了算）。
  if (tolerance !== null) return meetsTolerance(picked.size, correct.length, tolerance) ? 'partial' : 'incorrect';
  return allowsMissing(data) ? 'partial' : 'incorrect';
}

/**
 * 多选题的「漏选算不算部分给分」（教师逐题选，规格 §12 的裁定）。
 *
 * 🔴 **只有逐字等于 `'allow-missing'` 才算「算」** —— 认不出的值（缺字段、拼错、
 * 换了个别的写法）一律按「全对才算」走。方向是刻意选的：把「认不出」当成「允许漏选」
 * 会让一道本该判错的题**静默地给学生半分**，而教师看不出任何异常（他以为自己选的是
 * 「全对才算」）；反过来，认不出的值当成「不给部分分」，教师至少能看到
 * 「我选了算部分给分但分数没给」—— 那是**可见的**。
 */
function allowsMissing(data: Record<string, unknown>): boolean {
  return data.partialCredit === 'allow-missing';
}

/**
 * 这道填空题有几个**答案槽** —— 判分时的分母（★ 2026-09-26）。
 *
 * ⚠️ **不是「题干里画了几个框」**：那是客户端的事（它读题干里的空分段）。
 * 这里数的是**教师配了几个答案**，而它才是判分该用的分母 ——
 * 一份答案都没有的题恒判错（与下面那道「不许落到 0 === 0 全对」的闸同源）。
 *
 * 三种历史形状各有各的读法（都是不同时期落库的，一份都不能丢）：
 *   ① 新：`answers: [['氧气'], ['阳光']]`（每空一份）
 *   ② 老多空：`blanks: [{ answers: […​] }, …]`
 *   ③ 老单空：`answers: ['氧气']`（**平铺**的一份）
 */
export function answerSlotCount(data: Record<string, unknown>): number {
  if (Array.isArray(data.blanks)) return data.blanks.length;
  if (hasNestedAnswers(data)) return (data.answers as unknown[]).length;
  return Array.isArray(data.answers) ? 1 : 0;
}

/**
 * `data.answers` 是**新形状**（每空一份 `string[][]`）吗。
 *
 * 🔴 判据必须是「**每一个**元素都是数组」，不是「第一个是」——
 * 教师的坏数据里出现一个 `[]`（M3 那条边界用例就钉着 `[42, null, [], …]` 这一串）
 * 会让「第一个是数组」判错，于是那份**平铺**的答案表被当成「两个空」：
 * 第 0 个空的可接受答案变成那个空数组 ⇒ **谁也答不对**。
 * ⚠️ 而 `acceptableAnswersFor` **必须用同一个判据** —— 两处各判一次就会各错各的。
 */
function hasNestedAnswers(data: Record<string, unknown>): boolean {
  const answers = data.answers;
  return Array.isArray(answers) && answers.length > 0 && answers.every(Array.isArray);
}

/** 第 `index` 个空的**可接受答案** —— 三种历史形状都读得出来。 */
export function acceptableAnswersFor(data: Record<string, unknown>, index: number): string[] {
  const answers = data.answers;
  // ① 新形状：`answers[index]` 自己就是一份（判据与 `answerSlotCount` 同一个）
  if (hasNestedAnswers(data)) return readAcceptableAnswers((answers as unknown[])[index]);
  // ② 老多空：答案住在 `blanks[index].answers` 里
  if (Array.isArray(data.blanks)) {
    const blank = data.blanks[index];
    const inner = (blank && typeof blank === 'object' && !Array.isArray(blank))
      ? (blank as Record<string, unknown>).answers
      : undefined;
    return readAcceptableAnswers(inner);
  }
  // ③ 老单空：`answers` 是**平铺**的一份，只有第 0 个空有
  return index === 0 ? readAcceptableAnswers(answers) : [];
}

/**
 * **判分侧**的可接受答案 —— 在 `acceptableAnswersFor` 之上**剥掉公式定界符**（裁定 ④）。
 *
 * ★ 2026-09-30 教师裁定：「学生端在输入的时候不允许输入公式」。于是：
 *   · 教师答案栏写 `$x=5$` ⇒ 判分文本是 `x=5` ⇒ 学生打 `x=5` **判对** ✓；
 *   · 学生打 `$x=5$` 反而**判错**（学生那一侧 `$` 只是普通字符，这正是裁定要的）。
 *
 * 🔴 **只能用在判分那一侧。** `acceptableAnswersFor` 本身**不许改** —— 它同时喂给
 *    **显示**（教师用卷、答错时发给学生看的那句正确答案），而那边要的是**原文**
 *    （渲染时由 `splitMath` 切出公式来画）。两处需求相反，所以分叉在**调用点**，
 *    不是在被调用的那个函数里。
 * 🔴 剥离走的是**同一个** `mathText(splitMath(...))`（服务端孪生），不是另写一条 ——
 *    显示侧与判分侧是从同一条规则派生出的**两个投影**，谁都不许自己造一份。
 */
function gradableAnswers(data: Record<string, unknown>, index: number): string[] {
  return acceptableAnswersFor(data, index).map((answer) => mathText(splitMath(answer)));
}

function fillHitStats(data: Record<string, unknown>, value: unknown): { hit: number; total: number } {
  const total = answerSlotCount(data);
  const rawTexts = readField(value, 'texts');
  const texts = Array.isArray(rawTexts) ? rawTexts : [readField(value, 'text')];
  let hit = 0;
  for (let index = 0; index < total; index += 1) {
    const acceptable = gradableAnswers(data, index);
    const text = texts[index];
    if (typeof text !== 'string' || acceptable.length === 0) continue;
    const normalized = normalizeFillText(text);
    if (acceptable.some(answer => normalizeFillText(answer) === normalized)) hit += 1;
  }
  return { hit, total };
}

interface ExplicitFillGrading { gradingMode: 'auto' | 'ai' | 'none'; maxScore: number }

/**
 * 新版逐空评分按 `fillBlankSettings` 的写入顺序与答案槽逐位对应。
 * 客户端每次改空都会按题面顺序重写整张 keyed map，因此 JSON 的枚举顺序就是答案顺序；
 * 只要有一项没有显式模式，就判为老题并整体回退到旧评分规则，避免半迁移数据改变成绩。
 */
export function explicitFillGrading(data: Record<string, unknown>): ExplicitFillGrading[] {
  const raw = data.fillBlankSettings;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const values = Object.values(raw as Record<string, unknown>);
  if (values.length === 0 || values.length !== answerSlotCount(data)) return [];
  const out: ExplicitFillGrading[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const setting = value as Record<string, unknown>;
    if (setting.gradingMode !== 'auto' && setting.gradingMode !== 'ai' && setting.gradingMode !== 'none') return [];
    const maxScore = typeof setting.maxScore === 'number' && Number.isInteger(setting.maxScore)
      && setting.maxScore >= 1 && setting.maxScore <= POINTS_MAX ? setting.maxScore : 1;
    out.push({ gradingMode: setting.gradingMode, maxScore });
  }
  return out;
}

/**
 * 填空题的判分。
 *
 * ★ 2026-09-26：分派判据从**题目数据的形状**（`Array.isArray(data.blanks)`）改成
 * **作答值的形状**（值自带 `format`：`fill/v1` 带 `text`、`fill-multi/v1` 带 `texts`）。
 *
 * 🔴 为什么必须改：迁移把老题的空挪进了题干，`data.blanks` 从此不在库里。
 * 再按数据分派的话，一道**迁移过的多空题**会被当成单空题判 —— 它去读 `value.text`，
 * 而客户端写的是 `{ texts: [...] }` ⇒ `undefined` ⇒ **每个学生都判错**，无一处报错。
 * 按值的形状分派之后，**两边都不再看 `data.blanks`**，也就没有可漂移的地方。
 *
 * ⚠️ 顺带一个好处：**老提交**（迁移之前学生存的 `{ text }`）仍然判得对 ——
 * 它的形状就是「单空」，而单空的可接受答案在新老形状下都读得出来。
 */
function judgeFillBlank(data: Record<string, unknown>, value: unknown, tolerance: number | null = null): GradeState {
  // ⚠️ **向后兼容**：`data.blanks` 缺席时走 M3 的单空路径（**形状**不动）。
  // 第一批落库的填空题一个 `blanks` 都没有，把它当成「零个空」会让全班的历史题目集体判错。
  //
  // 🔴 但**判据**有一处**有意扩大的行为变更**（不是「沿用不动」）：这里走
  // `readAcceptableAnswers`，它比旧实现多丢掉「归一化之后是空串」的答案元素。
  // 旧实现是 `answers.some(a => typeof a === 'string' && normalizeFillText(a) === normalized)` ——
  // **不过滤空白串**，于是教师的 `[' ', '光合作用']`（能存进库）+ 学生的空提交 = **满分**。
  // ⇒ `['', '光合作用']` 从「空提交算对」变成「算错」。方向是收紧，见
  // `readAcceptableAnswers` 的注释与 `worksheet-grade-m4.test.ts` 里的用例。
  const texts = readField(value, 'texts');
  if (Array.isArray(texts)) {
    const total = answerSlotCount(data);
    // 🔴 一个答案槽都没有（教师建了题但一个空都没填）⇒ 判错。**不能**落到下面那句
    // 「全对」：`hit === total` 在 total 为 0 时恒真（0 === 0），一道没有任何空的题
    // 会拿到满分，且全程无报错。
    if (total === 0) return 'incorrect';
    let hit = 0;
    for (let index = 0; index < total; index += 1) {
      // ⚠️ 每一空都要丢掉空白串（`readAcceptableAnswers` 负责），否则「这一空什么都不填」
      // 会因为 `normalizeFillText(' ') === normalizeFillText('')` 而被算成答对。
      const acceptable = gradableAnswers(data, index);
      const text = texts[index];
      // 这一空没有可接受答案 / 学生没填 / 填的不是字符串 ⇒ **这一空算错**，其余照常给分。
      if (acceptable.length === 0 || typeof text !== 'string') continue;
      const normalized = normalizeFillText(text);
      if (acceptable.some((answer) => normalizeFillText(answer) === normalized)) hit += 1;
    }
    if (hit === total) return 'correct';
    // ★ 2026-09-25：容错档（「错不超过 N 处」）与旧规则（「至少对 1 处」）由 `meetsTolerance`
    // 一处回答 —— 四个题型共用，各写一份算术是本仓反复栽的那类分叉。
    return meetsTolerance(hit, total, tolerance) ? 'partial' : 'incorrect';
  }

  // 老的值形状（`{ text }`，迁移之前学生存的那些）：只有一个组成部分 ⇒ **没有部分给分**。
  // 🔴 `normalizeFillText` **刻意不做大小写不敏感**（规格 §3-T）：化学式 / 英文填空的
  // 大小写是语义的一部分，把 `CO2` 判成 `co2` 正确比不判更糟。要多收几种写法请教师
  // 在答案里多列几个。
  const acceptable = gradableAnswers(data, 0);
  const text = readField(value, 'text');
  if (typeof text !== 'string') return 'incorrect';
  const normalized = normalizeFillText(text);
  return acceptable.some((answer) => normalizeFillText(answer) === normalized) ? 'correct' : 'incorrect';
}

/** 学生端批改反馈使用：返回多空填空中答错的空（0 起）。不适用的题型返回空数组。 */
/**
 * ★ 2026-09-27（教师定的）：**答错的空**要能看到正确答案。
 *
 * 教师原话：「答错的用其它颜色表示，可以在原文字上加删除线，并在后面写上正确答案。」
 *
 * 🔴 **只发答错的那几个空。** `stripAnswers` 刻意不下发整张答案键（`routes/worksheets.ts`
 *    返回前剥掉），所以学生能看到的答案必须**刚好是他答错的那几格**、而且**只在他提交之后**
 *    —— 两个调用点都由 `gradeState` / `submittedAt` 把着门，别在别处调它。
 *    多一格就是泄露；少一格学生的「正确答案」就空着。
 * 🔴 **没设答案键的空不发**（`acceptable.length === 0`）：那种空在 `fillBlankWrongIndexes`
 *    里**也算错**，但它没有正确答案可写 —— 发了会得到一个空串，界面会写出「正确答案：」这种半句话。
 * ⚠️ **只发第一条**：其余是判分接受的别名（`宋朝` / `宋代`），一屏写不下。
 *    将来要在界面上展示全部别名再扩这个形状（现在是 `string`，扩成 `string[]` 即可）。
 */
export function wrongBlankAnswers(node: QuestionNode, value: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  for (const index of fillBlankWrongIndexes(node, value)) {
    const acceptable = acceptableAnswersFor(node.data, index);
    if (acceptable.length > 0) out[index] = acceptable[0];
  }
  return out;
}

/**
 * ★ 2026-09-27（教师）：「选择和判断学生错误后也要与填空一样给出叉叉符号并给出正确答案。」
 *
 * 选择 / 判断那一族的**正确答案**（选项 key），**只在学生没全对时**给。
 *
 * 🔴 **窄口与 `wrongBlankAnswers` 逐字相同**：`stripAnswers` 刻意不下发整张答案键，
 *    所以学生能看到的答案必须**只在他提交之后**、而且**只有他没答对的那道题**。
 *    两个调用点都由 `gradeState` / `submittedAt` 把着门，别在别处调它。
 * 🔴 **全对 ⇒ 空对象**。判据是「**集合**是否完全一致」（顺序无关）—— 那也正是
 *    `gradeState === 'correct'` 的口径，所以「没全对（含只对了一部分）」与
 *    「这里有条目」是同一件事，不会出现「显示『部分答对』却看不到答案」。
 *    多选的部分分是「漏选且没选错」⇒ 那种情况会走到这里、把漏掉的那几个告诉他。
 *
 * ⚠️ 顺序取**选项表**（`data.options`）而不是 `correctKeys` 自己的顺序：教师横着比一串
 *    学生时，同一道题的「正确答案」每次都得是同一串（与抽屉 / 导出口径一致）。
 *    判断题不存 `options`（key 是协议里的 T/F），而它的正确答案恰好一个 ⇒ 没有顺序问题。
 */
export function wrongChoiceAnswers(node: QuestionNode, value: unknown): Record<number, string> {
  if (!CHOICE_ANSWER_TYPES.includes(node.type)) return {};
  const selected = [...new Set(readStrings(readField(value, 'selected')))];
  const correct = [...new Set(readStrings(node.data.correctKeys))];
  // 没设答案键 ⇒ 这题不判分（`judgeSingleChoice` 回 null），也就没有「正确答案」可写。
  // ⚠️ 这一行**是显式的、不是必需的**：`correct` 为空时下面 `shown` 的兜底同样得到空对象。
  //    留着它是因为「没设答案键 ⇒ 不发」是那道窄口的一部分，值得在函数开头一眼看见。
  // 🔴 但**没有用例专门钉它** —— 删掉这一行，两个调用点的输出一个字节都不变（变异检验实测）。
  //    别在任何地方引用「这一行有测试守着」：它没有。
  if (correct.length === 0) return {};
  if (selected.length === correct.length && selected.every((key) => correct.includes(key))) return {};

  const ordered = optionKeyOrder(node).filter((key) => correct.includes(key));
  // ⚠️ 兜底：手工改过的行可能让 `correctKeys` 指向一个不存在的选项（校验器会拒，
  //    但库里的行不一定经过校验）—— 那时**宁可照发**也不静默丢掉：丢掉会让界面
  //    既不画叉也不写答案，学生只看到一句「再想一想」。
  const shown = ordered.length > 0 ? ordered : correct;
  const out: Record<number, string> = {};
  shown.forEach((key, index) => { out[index] = key; });
  return out;
}

/**
 * 这道题**答错**时要写给学生的正确答案：填空逐空、选择 / 判断逐选项。不适用时 `{}`。
 *
 * ⚠️ 线上那个键仍叫 `correctBlanks`（`routes/worksheets.ts` 的两个下发点）——
 *    **不改名有两条理由**：① 键集是被三条用例锁着的窄口；② 那个名字里不许出现
 *    `answers` 这个子串（`worksheet-grade.test.ts` 拿整串做 `!raw.includes('answers')`
 *    的钝刀，见 `routes/worksheets.ts` 里那条注释）。⇒ 名字的含义由这条注释承担：
 *    **它装的是「答错时要展示给学生的正确答案」，填空是逐空的答案、选择是选项 key。**
 */
/**
 * 连线题答错时要给的**正确答案**（★ 2026-09-28，教师：「批改有错误的没有显示正确答案」）。
 *
 * 给的是「学生**漏掉或连错**的那些正确连线」，每条一句话：`《绝句》 → 《望庐山瀑布》`。
 * 🔴 **已经连对的那几条不给** —— 与填空/选择同一道窄口（只发答错的那几处，
 * 不把整张答案键倒给学生）。全对时返回空对象，客户端那块提示就不渲染。
 *
 * ⚠️ 条目文字读不出来时**回落到 id**（不写空串）：教师手改过的库 / 缺 text 的行都可能
 * 这样，而空串会让那一行变成「 → 」（看起来像界面坏了）。
 * ⚠️ 作答值形状坏掉（`readStrictPairs` 回 `null`）⇒ 空对象：那种题判分本身已经是
 * 「整体判错」，再列一堆答案也只是噪音。
 */
export function wrongMatchAnswers(node: QuestionNode, value: unknown): Record<number, string> {
  if (node.type !== 'match') return {};
  const pairs = readPairs(node.data.pairs);
  if (pairs.length === 0) return {};
  const links = readStrictPairs(readField(value, 'links'));
  if (links === null) return {};

  const textsOf = (raw: unknown): Map<string, string> => {
    const map = new Map<string, string>();
    if (!Array.isArray(raw)) return map;
    raw.forEach((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const row = entry as Record<string, unknown>;
      if (typeof row.id === 'string' && typeof row.text === 'string') map.set(row.id, row.text);
    });
    return map;
  };
  const left = textsOf(node.data.left);
  const right = textsOf(node.data.right);

  const out: Record<number, string> = {};
  pairs.forEach((pair, index) => {
    const drawn = links.some((link) => link.leftId === pair.leftId && link.rightId === pair.rightId);
    if (drawn) return;
    out[index] = `${left.get(pair.leftId) ?? pair.leftId} → ${right.get(pair.rightId) ?? pair.rightId}`;
  });
  return out;
}

export function wrongAnswers(node: QuestionNode, value: unknown): Record<number, string> {
  if (node.type === 'fill-blank' || node.type === 'choice-blank') return wrongBlankAnswers(node, value);
  // ★ 2026-09-28：连线题原来落到下面那一支（`wrongChoiceAnswers`）⇒ **恒回空对象**
  // ⇒ 学生答错了看不到任何正确答案（教师报的那个 bug）。
  if (node.type === 'match') return wrongMatchAnswers(node, value);
  return wrongChoiceAnswers(node, value);
}

/** 答案长在 `correctKeys` 里、判分器是 `judgeSingleChoice` / 多选那一支的三个题型。 */
const CHOICE_ANSWER_TYPES: readonly string[] = ['single-choice', 'multi-choice', 'true-false'];

/** 这道题**选项表**的顺序。判断题见 `wrongChoiceAnswers` 里那一段。 */
function optionKeyOrder(node: QuestionNode): string[] {
  if (node.type === 'true-false') return readStrings(node.data.correctKeys);
  return readOptionKeys(node.data.options);
}

export function fillBlankWrongIndexes(node: QuestionNode, value: unknown): number[] {
  if (node.type !== 'fill-blank' && node.type !== 'choice-blank') return [];
  const texts = readField(value, 'texts');
  if (!Array.isArray(texts)) return [];
  const wrong: number[] = [];
  const total = answerSlotCount(node.data);
  for (let index = 0; index < total; index += 1) {
    const acceptable = gradableAnswers(node.data, index);
    const text = texts[index];
    if (acceptable.length === 0 || typeof text !== 'string') {
      wrong.push(index);
      continue;
    }
    const normalized = normalizeFillText(text);
    if (!acceptable.some(answer => normalizeFillText(answer) === normalized)) wrong.push(index);
  }
  return wrong;
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
function judgeOrder(data: Record<string, unknown>, value: unknown, tolerance: number | null = null): GradeState {
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
  // ★ 2026-09-25：容错档（「错不超过 N 处」）与旧规则（「至少对 1 处」）由 `meetsTolerance`
  // 一处回答 —— 四个题型共用，各写一份算术是本仓反复栽的那类分叉。
  return meetsTolerance(hit, correct.length, tolerance) ? 'partial' : 'incorrect';
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
 * `isValidMatching` 把它钉在教师那一侧）。学生两端有重复的连法时，那条线**不算对**：
 * 否则一个「l1 连到 r1、又连到 r3」的矛盾作答会因为「里面含有正确的那条」而拿满分，
 * 而学生端画出来的明明是三条线。
 *
 * ⚠️ 「重复」的判据是**每一个端点 id 只许出现一次**（左右各自）——
 * 所以**同一条线被原样提交两次**（`[{l1,r1},{l1,r1}]`）也算重复、那条也不算对。
 * 这比「只有两条**不同**的线共用端点才算重复」更严，**刻意保留**：它偏严，
 * 而偏严的代价是「一份正确作答 + 一条重复的线」掉到 `partial`（不会虚高），
 * 偏松的代价是矛盾作答拿满分（虚高，且教师查不出来）。
 */
function judgeMatch(data: Record<string, unknown>, value: unknown, tolerance: number | null = null): GradeState {
  const pairs = readPairs(data.pairs);
  if (pairs.length === 0) return 'incorrect';
  // 🔴 `readStrictPairs`（含坏元素 ⇒ 整体判错），**不是** `readPairs` ——
  // 丢掉坏元素会让「更残缺的作答拿到更高的分」，见 `readStrictPairs` 的注释。
  const links = readStrictPairs(readField(value, 'links'));
  if (links === null || links.length === 0) return 'incorrect';

  // ★ 2026-09-28（教师裁定「甲」）：**逐条判断对错** —— 一条线对不对，只看它自己在不在
  // 正确答案里。**去掉了**原来那条「某个左项/右项被用到超过一次 ⇒ 用到它的线全不算对」。
  //
  // 🔴 为什么去掉：那条规则是「**一对一**」这个假设的落点，而教师要求支持一对多 /
  // 多对一 / 多对多。留着它的话，勾选矩阵里同一行勾两格（一对多）会被判成错。
  // ⚠️ **它改变了老题的判分**（教师知情并选择了甲）：原来「A→1 对 + A→2 错」两条都不算，
  //    现在 A→1 算一条命中 ⇒ 分数变宽松。方向是「更公平」。
  // ⚠️ 于是「同一条线提交两次」(`[{l1,r1},{l1,r1}]`) 也从「一条都不算」变成「算一条命中、
  //    但 `links.length` 多于答案 ⇒ 拿不到全对」—— 下面那条 `links.length` 的判据管着它。
  let hit = 0;
  for (const pair of pairs) {
    const matched = links.some((link) => link.leftId === pair.leftId && link.rightId === pair.rightId);
    if (matched) hit += 1;
  }
  // 未出现在答案表里的左项可以留空，但学生若给这些干扰项多连了线，不能算全对。
  if (hit === pairs.length && links.length === pairs.length) return 'correct';
  // ★ 2026-09-25：容错档（「错不超过 N 处」）与旧规则（「至少对 1 处」）由 `meetsTolerance`
  // 一处回答 —— 四个题型共用，各写一份算术是本仓反复栽的那类分叉。
  return meetsTolerance(hit, Math.max(pairs.length, links.length), tolerance) ? 'partial' : 'incorrect';
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
function judgeCategorize(data: Record<string, unknown>, value: unknown, tolerance: number | null = null): GradeState {
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
  // ★ 2026-09-25：容错档（「错不超过 N 处」）与旧规则（「至少对 1 处」）由 `meetsTolerance`
  // 一处回答 —— 四个题型共用，各写一份算术是本仓反复栽的那类分叉。
  return meetsTolerance(hit, items.length, tolerance) ? 'partial' : 'incorrect';
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
const JUDGES: Record<QuestionType, (data: Record<string, unknown>, value: unknown, tolerance: number | null) => GradeState | null> = {
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
  // ★ 2026-09-26：**选择填空**判分与填空题**逐字相同**（题干里的空 + 每空一份答案；
  // 待选词只是学生的**输入方式**，判分只看每个空填得对不对）。
  // ⇒ 共用一支，不另写（先例：判断题与单选）。
  'choice-blank': judgeFillBlank,
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
  // ★ 2026-09-25（教师裁定）：教师**关掉了这道题的自动评分** ⇒ 不判分。
  // 🔴 这里是**唯一**读 `autoGrade` 的地方 —— 五个判分器都不需要知道它，
  //    它们只管「按题面判」，而「判不判」是分派层的事。
  // ⚠️ 以**开关**为准，不以「有没有答案」推断：关掉开关时答案**保留在库里**（教师再打开时
  //    原来勾的还在），所以「有答案却不判分」是一个**正常状态**，不能当成坏数据。
  if (node.autoGrade === false) return null;
  // ⚠️ `node.data` 也走「先判类型再取」：`Record<string, unknown>` 是**编译期的承诺**，
  // 而库里的 JSON 可能是 `null` / 数组 / 别的标量 —— `null.correctKeys` 会在提交路径上
  // 抛一次 500，学生看到的是「提交失败」。
  const data = (node.data && typeof node.data === 'object' && !Array.isArray(node.data))
    ? node.data as Record<string, unknown>
    : {};
  // ⚠️ `node.type` 同样是编译期的承诺：手工改过的行可能是一个**不存在的题型**。
  // 取不到判分器时回答 `null`（= 不判分）—— 与主观题同一档，看板不会把它算进
  // 「已判分」的分母，也就不会报出一个错的正确率。
  const judgeForType: ((data: Record<string, unknown>, value: unknown, tolerance: number | null) => GradeState | null) | undefined =
    node.type === 'single-choice' && data.choiceMode === 'multiple' ? judgeMultiChoice : JUDGES[node.type];
  if (!judgeForType) return null;
  return judgeForType(data, value, toleranceOf(node));
}

/** 单选与判断题**共用**的校验：`correctKeys` 恰好一个。`checkOptions` 只对单选为真。 */
function validateSingleAnswer(
  node: QuestionNode,
  errors: string[],
  label: string,
  checkOptions: boolean,
): void {
  const optionKeys = readOptionKeys(node.data.options);
  if (checkOptions && optionKeys.length < 2) {
    errors.push(`${label}至少需要两个选项`);
  }
  // ★ 2026-09-25（教师裁定）：答案必填与否**由「允许自动评分」那个开关决定** ——
  // 开着（缺省）⇒ 必须恰好一个；关掉 ⇒ 答案根本用不上，一条都不查。
  // ⚠️ 这是本特性与上一版的分界：上一版按「有没有答案」**推断**判不判分，现在以开关为准
  //（关掉时答案保留在库里，所以「有答案却不判分」是正常状态）。
  if (node.autoGrade === false) return;
  const correct = readStrings(node.data.correctKeys);
  if (correct.length !== 1) errors.push(`${label}必须且只能指定一个正确答案`);
  // ★ 2026-09-25 补：答案指向一个**不存在的选项** ⇒ 没有任何学生能答对，而看板上只表现为
  // 「正确率 0%」—— 教师会去怀疑学生，不会来怀疑这道题。多选题那一支**一直**有这条检查，
  // 单选漏了（同一条失效、两处两个样）。
  //
  // ⚠️ **只对存 `options` 的题型查**（即单选）。判断题的答案键是固定的 `T` / `F`，
  // 而那不是 `data.options` 里的东西 —— 套用这条检查会把每一道合法的判断题都判成非法
  //（实测踩过）。判断题的键**值**服务端今天不校验（它只是一对协议常量，服务端没有第二份
  // 拷贝；本校验器只管个数），这是既有边界，本批没有改变它。
  if (checkOptions && correct.some((key) => !optionKeys.includes(key))) {
    errors.push(`${label}的正确答案里有不存在的选项`);
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
/**
 * 表格填空的行 / 列 / 空数上限。
 * 🔴 **与客户端 `src/lib/worksheet-table.ts` 是同一组数** —— 那边改了这边也要改，
 * 两边不一致的症状是「教师端加得进去、保存被服务端拒掉」（或者反过来）。
 */
const MAX_TABLE_ROWS = 10;
const MAX_TABLE_COLS = 10;
const MAX_TABLE_BLANKS = 30;

/**
 * 题干里那两个标记串的**服务端副本**（★ 2026-09-28）。
 *
 * ⚠️ 它是**刻意的双胞胎**：真源在客户端 `src/lib/worksheet-table.ts`（`TABLE_MARK_TEXT`）
 * 与 `prompt-editor.tsx`（`FILL_BLANK_TEXT`），而服务端是另一个包、import 不过来。
 * 两边靠用例对齐（先例：`hasNestedAnswers` / `fillShape`）。
 */
export const TABLE_MARK_TEXT = '{表格域}';
export const FILL_BLANK_TEXT = '{填空域}';

/**
 * 纸面上的空：**8 个半角下划线**（★ 2026-09-30 教师从导出结果里看出来）。
 *
 * 教师原话：「填空题的下划线使用 8 个连续的下划线」。
 * 🔴 原来是 4 个**全角**下划线（`＿＿＿＿`）—— 它在正文里看着还行，但**在 Word 里是四段
 *    断开的短线**（全角字符一个字一格，格与格之间有空隙），教师看到的那一版就是那样。
 * ⚠️ 半角 `_` 才会连成**一条**。改这一处同时影响教师用卷、按学生的作答报告与 AI 载荷
 *（它们都走 `questionTextFor`）—— 那是要的：同一个空在四处长得一样。
 */
export const PAPER_BLANK_TEXT = '________';

/** 题干里有几处表格域标记（>1 是坏数据：标记不带 id，说不清哪一处是哪张表）。 */
function tableMarkCount(text: unknown): number {
  if (typeof text !== 'string' || text === '') return 0;
  let total = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(TABLE_MARK_TEXT, from);
    if (at < 0) break;
    total += 1;
    from = at + TABLE_MARK_TEXT.length;
  }
  return total;
}

/** 表格的行列表（坏行 → 空行；**不丢行**，因为行的下标就是「第几行」）。 */
export function tableRowList(raw: unknown): unknown[][] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const rows = (raw as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => (Array.isArray(row) ? row : []));
}

/**
 * 表格里有几个空 —— **服务端自己的一份**（客户端那份在 `src/lib/worksheet-table.ts`）。
 *
 * ⚠️ **它是一对刻意的双胞胎**，照本仓既有的先例：`hasNestedAnswers`（服务端）与
 * `fillShape`（客户端）也是各写一份，理由写在 `src/lib/types.ts` 的那段注释里
 *（题型注册表与判分**只在服务端**，前端不该再定义一份纯逻辑）。两边靠**用例**对齐。
 */
export function tableBlankCount(raw: unknown): number {
  return tableRowList(raw).reduce((total, row) => total + row.filter((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const blank = (entry as Record<string, unknown>).blank;
    return typeof blank === 'string' && blank !== '';
  }).length, 0);
}

/**
 * 把表格拍成**能读的纯文本**（★ 2026-09-28）：Word 导出与 AI 分析载荷那两条路
 * 今天只读 `prompt` 文本 ⇒ 不补这一段，表格在那两处**凭空消失**，
 * 而分析智能体就看不到那道题在问的那张表。
 *
 * 🔴 格子里的 `|` 换成 `/`、换行压成空格：**一个格子的内容不许改变表格的形状**
 *（否则 AI 读到的行列数与教师看到的不一样，而那是静默的）。
 * ⚠️ 整行都是空白 ⇒ 丢掉那一行；一格空白**留着**（列要对齐）。
 */
export function tableAsText(raw: unknown): string {
  const rows = tableRowList(raw).map((cells) => cells.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
    const text = (entry as Record<string, unknown>).text;
    return typeof text === 'string' ? text.replace(/[|]/g, '/').replace(/[\r\n]+/g, ' ').trim() : '';
  }));
  return rows
    .filter((cells) => cells.some((text) => text !== ''))
    .map((cells) => cells.join(' | '))
    .join('\n');
}

/**
 * 一道题的**题面文本** —— 题干，外加表格的纯文本投影（★ 2026-09-28）。
 *
 * 🔴 为什么把表格**折进**题干文本，而不是给载荷加一个 `tableText` 字段：
 *   那个 `{questionId, typeLabel, prompt, heading}` 的形状在**四个地方**各拼一遍
 *   （`routes/worksheets.ts` 三处 + `export-service.ts` 一处），加字段就要四处都改，
 *   而漏一处的症状是「那一条路里表格凭空消失」—— 本仓最防的就是这种静默的遗漏。
 *   ⇒ 改一处、四处受益：所有读 `prompt` 的纯文本消费者（Word 导出、AI 分析载荷）
 *     自动看得见表格。
 * ⚠️ **代价**：`prompt` 字段从此不是「题干原文」。要读**原文**的地方（编辑器、迁移、
 *   判分、学生端）请直接读 `node.prompt` —— 它们都不该用本函数。
 */
export function questionTextFor(node: { prompt: string; data: Record<string, unknown> }): string {
  const prompt = typeof node.prompt === 'string' ? node.prompt : '';
  const data = node.data && typeof node.data === 'object' ? node.data : {};
  const table = tableAsText(data.table);
  const at = prompt.indexOf(TABLE_MARK_TEXT);
  // 🔴 **有标记才投影** —— 与渲染同一条判据（`{填空域}` 那条裁定的先例：由文本决定）。
  //    ⚠️ 这里有意的行为变更（2026-09-28）：表格域之前是**追加在题干末尾**的，
  //    现在按标记的位置**就地**替换 —— 与学生在屏幕上看到的顺序一致。
  const withTable = at < 0
    ? prompt
    : `${prompt.slice(0, at)}${table || TABLE_MARK_TEXT}${prompt.slice(at + TABLE_MARK_TEXT.length)}`;
  // ★ 2026-09-28：`{填空域}` 那五个字**原来会原样进 Word 导出与 AI 载荷**（服务端
  //   没有任何地方替换它）—— 教师导出的 Word 里写着「植物需要{填空域}才能生长」。
  //   换成一条下划线：读得通，而且它是「这里该学生填」的通行写法。
  return withTable.split(FILL_BLANK_TEXT).join(PAPER_BLANK_TEXT);
}

/**
 * 表格这道题有没有明显坏掉的地方。
 *
 * 🔴 **只查一个方向**（表格的空 > 答案槽），另一条**有意不查**：
 * 服务端**从不读题干**（`answerSlotCount` 的注释：「不是题干里画了几个框」），
 * 所以「表格 1 个空 + 2 份答案」既可能是坏数据、也可能是题干里还有一个空 ——
 * 查它会把合法的「题干空 + 表格空」混合题一律拒掉。
 * 而「表格的空比答案槽还多」无论题干里有没有空都一定是坏的。
 */
function findTableError(data: Record<string, unknown>, prompt: string): string | null {
  const marks = tableMarkCount(prompt);
  if (marks > 1) return `题干里有 ${marks} 处「${TABLE_MARK_TEXT}」—— 一道题只能放一张表格`;
  const raw = data.table;
  if (raw === undefined || raw === null) return null;
  // 🔴 有表但没有标记 ⇒ **学生看不到这张表**（渲染与投影都由标记决定）。
  //    这是「看不见的内容」，必须响亮地拒 —— 而不是让它静静地躺在库里。
  if (marks === 0) return `题干里没有「${TABLE_MARK_TEXT}」标记，学生看不到这道题的表格 —— 请用工具栏的「表格域」把它插进题干`;
  if (tableBlankCount(raw) === 0 && tableRowList(raw).length === 0) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return '这道题的表格结构读不出来';
  const rows = tableRowList(raw);
  // ⚠️ 「有键但没有行」当成没有表 —— 与客户端 `readTableFor` 同一条判据
  if (rows.length === 0) return null;
  if (rows.length > MAX_TABLE_ROWS || rows[0].length > MAX_TABLE_COLS) {
    return `表格最多 ${MAX_TABLE_ROWS} 行 ${MAX_TABLE_COLS} 列`;
  }
  const blanks = tableBlankCount(raw);
  if (blanks > MAX_TABLE_BLANKS) return `表格里的填空最多 ${MAX_TABLE_BLANKS} 个`;
  const slots = answerSlotCount(data);
  if (blanks > slots) {
    return `表格里有 ${blanks} 个填空，但只配了 ${slots} 份标准答案 —— 每个空都要配一份`;
  }
  return null;
}

function validateFillBlank(node: QuestionNode, errors: string[]): void {
    // ★ 2026-09-28（表格填空）：表格先查，**查出问题就不再往下查** —— 后面那些判据
    // 在「空数与答案对不上」的题上会给出更绕的错，教师看不出该改哪儿。
    const tableError = findTableError(node.data, node.prompt);
    if (tableError) { errors.push(tableError); return; }
    // ★ 2026-09-26：**与判分读同一份答案**（`answerSlotCount` / `acceptableAnswersFor`）。
    //
    // 🔴 这里原来自己按老形状读（`Array.isArray(data.blanks)` 在不在 + 平铺的 `data.answers`），
    // 而编辑器与迁移现在写的是**每空一份**（`[['张三'], ['李四']]`）——
    // 校验读到的是「一个字符串都没有」⇒ **教师填的两个答案它一个都没看见**，
    // 保存被拒：「填空题至少要有一个可接受的答案」。而屏幕上两个框里明明写着字。
    //
    // ⇒ 判据只有一处（那两个函数），校验与判分都走它。**同一件事写在两处，必然有一处落后。**
    const total = answerSlotCount(node.data);
    if (total === 0) {
      errors.push('填空题至少要有一个空');
      return;
    }
    const explicit = explicitFillGrading(node.data);
    if (explicit.length > 0) {
      for (let index = 0; index < total; index += 1) {
        if (explicit[index]?.gradingMode === 'auto'
            && !acceptableAnswersFor(node.data, index).some(answer => answer.trim())) {
          // ⚠️ 这里必须叫「本地评分」：界面上那一档 2026-10-05 已按教师裁定改名
          //    （`FILL_GRADING_LABELS`）。报错指着一个屏幕上不存在的选项名，教师只能自己猜。
          errors.push(`填空题第 ${index + 1} 空选择了本地评分，请填写标准答案`);
        }
      }
      return;
    }
    // ⚠️ 开关关掉时「答案」整块不查 —— 但**题面**照查（上面那条空数的检查仍在）。
    if (node.autoGrade === false) return;
    for (let index = 0; index < total; index += 1) {
      if (!acceptableAnswersFor(node.data, index).some((answer) => answer.trim())) {
        // 同一个毛病不按空数重复说 N 遍（一道 10 个空的题会甩出 10 条一样的错）。
        // ⚠️ 单空那条文案保留（它更简短），多空用逐空那条。
        errors.push(total === 1 ? '填空题至少要有一个可接受的答案' : '填空题每个空至少要有一个可接受的答案');
        break;
      }
    }
}

function validateFillModes(node: QuestionNode, errors: string[]): void {
  if (node.data.fillScoring !== undefined && node.data.fillScoring !== 'per-blank' && node.data.fillScoring !== 'whole') {
    errors.push('填空题的给分方法不合法');
  }
  const raw = node.data.fillBlankSettings;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const settings = Object.values(raw as Record<string, unknown>);
  let needsPool = false;
  let aiMaximum = 0;
  settings.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`填空题第 ${index + 1} 空的作答方式不合法`);
      return;
    }
    const setting = entry as Record<string, unknown>;
    if (setting.mode !== 'text' && setting.mode !== 'pool' && setting.mode !== 'inline') {
      errors.push(`填空题第 ${index + 1} 空的作答方式不合法`);
    }
    if (setting.mode === 'pool') needsPool = true;
    if (setting.mode === 'inline' && readStrings(setting.choices).length < 2) {
      errors.push(`填空题第 ${index + 1} 空的右侧选词至少需要两个词`);
    }
    if (setting.gradingMode !== undefined
        && setting.gradingMode !== 'auto' && setting.gradingMode !== 'ai' && setting.gradingMode !== 'none') {
      errors.push(`填空题第 ${index + 1} 空的评分方式不合法`);
    }
    if (setting.gradingMode === 'ai' && setting.mode !== 'text') {
      errors.push(`填空题第 ${index + 1} 空只有手工填写时才能使用 AI 评分`);
    }
    if (setting.gradingMode !== undefined && setting.gradingMode !== 'none'
        && (typeof setting.maxScore !== 'number' || !Number.isInteger(setting.maxScore)
          || setting.maxScore < 1 || setting.maxScore > POINTS_MAX)) {
      errors.push(`填空题第 ${index + 1} 空的满额必须是 1–${POINTS_MAX} 的整数`);
    }
    if (setting.gradingMode === 'ai' && typeof setting.maxScore === 'number' && Number.isInteger(setting.maxScore)) {
      aiMaximum += setting.maxScore;
    }
  });
  if (aiMaximum > 100) errors.push('一道题交给 AI 评分的各空满额合计不能超过 100');
  // ⚠️ 这句话必须与编辑页那个面板的标题**逐字同源**（★ 2026-10-05 教师把面板从
  //    「下方共用词池」改名成「共用选词」）——报错里指着一块屏幕上已经不存在的东西，
  //    教师只能自己去猜是哪一栏。改一处就要改这一处。
  if (needsPool && readStrings(node.data.fillChoicePool ?? node.data.choices).length === 0) errors.push('填空题的共用选词不能为空');
}


const VALIDATORS: Record<QuestionType, (node: QuestionNode, errors: string[]) => void> = {
  /**
   * ★ 2026-09-25：**任务容器**的校验。只剩一条：**任务里不能再嵌套任务**。
   *
   * 🔴 它拦的是「题号会变成三级」——而三级题号会让 UI 那套「重复」的优势立刻消失
   *（教师裁定：任务只装小题）。schema 里没有禁止它的东西，所以只能在这里拦。
   *
   * ── 两条**已经不在**这里的检查（别照旧注释以为还在）────────────────────
   *
   * 1. ~~任务里一道小题都没有~~ —— **2026-09-25 教师裁定：允许空任务。**
   *    理由在编辑页那一侧：教师点「+ 添加任务」之后还没放小题时保存，不该撞上 400。
   *    原先写在这里的三条理由（空任务在界面上是一块空白…）**仍然是事实**，
   *    但它们的代价现在由编辑页承担（页面上看得见、可编辑），不再用 400 去挡。
   *    ⚠️ 迁移那边**仍然不造空任务**（`worksheet-task-migration.ts` 的纪律 4）——
   *    那 теперь是**品味**（不造没用的东西），**不是**为了躲开校验。
   *
   * 2. ~~任务标题不能为空~~ —— **本来就允许**（教师裁定 ①a：任务只是分组 + 一段说明），
   *    但这一条原先**只在注释里成立**：`validateQuestion` 的公共那句「题干不能为空」
   *    对任务一样生效，而且报错用的词是「题干」——教师改的是任务名，却收到一句说题干的话。
   *    ⇒ 已改成公共那句按题型放行（见 `validateQuestion`）。
   */
  task: (node, errors) => {
    const children = node.children ?? [];
    if (children.some((child) => child.type === 'task')) errors.push('任务里不能再嵌套任务');
  },
  'single-choice': (node, errors) => {
    if (node.data.choiceMode !== 'multiple') {
      validateSingleAnswer(node, errors, '选择题（单选）', true);
      return;
    }
    const optionKeys = readOptionKeys(node.data.options);
    const correct = readStrings(node.data.correctKeys);
    if (optionKeys.length < 2) errors.push('选择题至少需要两个选项');
    if (node.autoGrade === false) return;
    if (correct.length < 1) errors.push('选择题（多选）至少要指定一个正确答案');
    if (correct.some((key) => !optionKeys.includes(key))) errors.push('选择题的正确答案里有不存在的选项');
  },
  // 判断题与单选**共用同一个校验器**：作答值与判分逐字相同（规格 §12），
  // 差别只在编辑 UI —— 判断题不存 `options`（选项恒为对/错两个），所以不查选项数。
  'true-false': (node, errors) => validateSingleAnswer(node, errors, '判断题', false),

  'multi-choice': (node, errors) => {
    const optionKeys = readOptionKeys(node.data.options);
    const correct = readStrings(node.data.correctKeys);
    if (optionKeys.length < 2) errors.push('多选题至少需要两个选项');
    // ★ 2026-09-25（教师裁定）：答案必填与否由「允许自动评分」那个开关决定（与单选同一段）。
    if (node.autoGrade === false) return;
    if (correct.length < 1) errors.push('多选题至少要指定一个正确答案');
    // 🔴 每个 key 都必须指向真实存在的选项：`correctKeys` 里一个不存在的字母
    // ⇒ 那道题**没有任何学生能答对**，而它在看板上只表现为「正确率 0%」——
    // 教师会去怀疑学生，不会来怀疑这道题。
    if (correct.some((key) => !optionKeys.includes(key))) errors.push('多选题的正确答案里有不存在的选项');
  },

  // ★ 2026-09-26：**选择填空** —— 题干与填空**逐字同一条**（题干里的空 + 每空一份答案），
  // 多出来的只有 `data.choices`（待选词）与「拖拽填」这个交互。
  // ⇒ 校验**复用**填空那一支，只多补一条硬要求（先例：判断题与单选共用判分器）。
  'choice-blank': (node, errors) => {
    validateFillBlank(node, errors);
    validateFillModes(node, errors);
    if (node.data.fillBlankSettings && typeof node.data.fillBlankSettings === 'object') return;
    if (node.autoGrade === false) return;
    const choices = readStrings(node.data.choices);
    // 🔴 **每个词只能用一次**（教师裁定）⇒ 词比空少时这道题**无解**，
    // 而那种题在屏幕上看不出任何异常（学生拖到最后一个空时没词可用）。
    if (choices.length === 0) {
      errors.push('「选择填空」至少要有一个待选词');
      return;
    }
    const requiredChoices = answerSlotCount(node.data) * (node.data.choiceLayout === 'inline-pairs' ? 2 : 1);
    if (choices.length < requiredChoices) {
      errors.push(node.data.choiceLayout === 'inline-pairs'
        ? '括号选词模式要求每个空至少配置两个待选词'
        : '「选择填空」的待选词不能比空少（每个词只能用一次，词不够就有空填不上）');
    }
  },

  'fill-blank': (node, errors) => {
    validateFillBlank(node, errors);
    validateFillModes(node, errors);
  },
  // ⚠️ 上面那条按名字引用（不是把函数体再写一遍）：`VALIDATORS` 在初始化期间
  // 引用自己（`VALIDATORS['fill-blank']`）会踩 TDZ，而两份实现漂移的症状是
  // 「两个题型一个校验得严一个松」。

/**
 * 填空题的校验（★ 2026-09-26：抽出来给「选择填空」复用）。
 * ⚠️ 抽它的唯一理由是 `VALIDATORS` 里要有**一条**实现给两个题型用 ——
 * 对象字面量里引用自己会踩 TDZ，而写两份必然漂移。
 */
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
    else if (node.autoGrade !== false && !isPermutation(ids, correctOrder)) errors.push('排序题的「正确顺序」必须正好是这些条目各一次');
    else if (isSameOrder(ids, correctOrder)) {
      // 🔴 **本步骤最容易漏掉的一条。** `items` 是学生看到的**初始顺序**，两者相同
      // ⇒ 学生什么都不做就是满分。这不是理论风险：教师在编辑器里按正确顺序录入条目
      // 是最自然的操作，而那个编辑器我们正准备做。
      errors.push('排序题的条目顺序与正确顺序相同 —— 请先把条目打乱，或点「重新排列」');
    }
  },

  match: (node, errors) => {
    const left = readItemIds(node.data.left);
    const right = readItemIds(node.data.right);
    const pairs = readPairs(node.data.pairs);
    if (left.ids.length < 2) errors.push('连线题左栏至少需要两个条目');
    if (right.ids.length < 1) errors.push('连线题右栏至少需要一个条目');
    if (!left.allValid || !right.allValid) errors.push('连线题里有条目缺少 id');
    else if (new Set(left.ids).size !== left.ids.length || new Set(right.ids).size !== right.ids.length) {
      errors.push('连线题里有重复的条目 id');
    } else if (!isValidMatching(left.ids, right.ids, pairs)) {
      if (node.autoGrade !== false) errors.push('连线题至少设置一组正确配对；未配对的左侧条目将作为留空项');
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
      if (node.autoGrade !== false) errors.push('归类题每个条目都必须落到一个框里');
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

/**
 * 编辑期校验。返回中文错误列表，空数组表示通过。
 *
 * ⚠️ **「题干不能为空」这条对 `task` 不适用**：任务的 `prompt` 是它的**标题**，
 * 而「纯分组」是合法数据（教师裁定 ①a —— 见 `VALIDATORS.task` 上面那一段）。
 * 不排除它的表现是：一个合法的纯分组任务**存不进库**，而教师收到的词是「题干」
 * ——他改的明明是任务名。
 */
export function validateQuestion(node: QuestionNode): string[] {
  const errors: string[] = [];
  if (node.type !== 'task' && !node.prompt.trim()) errors.push('题干不能为空');
  VALIDATORS[node.type](node, errors);
  return errors;
}
