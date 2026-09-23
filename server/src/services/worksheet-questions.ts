/** 学习单的题型注册表。**纯函数，全部在服务端** —— 本项目不引入前端测试框架（规格 §11）。 */

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
 * ⚠️ 它是**两个档共用的**（`full` 与 `half` 各自在 0..99），不是「`full + half <= 99`」——
 * 后者会让「全对 60 / 半对 50」这种（半对拿得比全对多的笔误）悄悄通过，
 * 而它唯一的表现是看板上的数字怪怪的。要挡那种笔误得靠在 UI 上比大小，不在这里。
 */
export const POINTS_MAX = 99;

/**
 * 取一个 0..99 的整数；非整数 / 越界 / 缺失一律回落到 `fallback`。
 *
 * 🔴 它**同时被两条路用到**，这是它被导出的原因：`routes/worksheets.ts` 归一化
 * 题目上的 `points`（写入口），与 A2 的 `pointsFromSettings` 读学习单级的档（读出口）。
 * 各写一份会让「`points: { full: "两朵" }` 到底算 1 还是算 0」在两条路上给出不同答案 ——
 * 而两个答案都不会报错。
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
 */
export function isUsablePointValue(raw: unknown): boolean {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return false;
  const rounded = Math.round(raw);
  return rounded >= 0 && rounded <= POINTS_MAX;
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
 */
export function normalizePoints(raw: unknown): QuestionPoints | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const hasFull = isUsablePointValue(source.full);
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
 * 🔴 **取值域是 `normalizePointValue` 的 0..99，不是 `rewardStep` 的 1/2/3/5。**
 * 那个四选一的下拉是**学习单级**的 UI 约束（`src/lib/worksheet-reward.ts` 的 `REWARD_STEPS`），
 * 而**逐题**的两个输入框是自由的（规格 §12 裁定 5：教师可以填 2 或 4）。
 * ⚠️ 这个差异是**有意的**，不要「统一」它们：把这里改成 `normalizeRewardStep` 会让库里
 * 一个已有的 `rewardStep: 4`（手工改过 / 将来放宽了取值域）**静默变回 1**，
 * 而教师看到的是「我配的档没生效」。
 *
 * ⚠️ `halfStep` 要到任务 B2 才进 `normalizeSettings`（写入口）。**这个窗口期是安全的**：
 * 此刻没有任何 UI 能写出那个键 ⇒ `source.halfStep` 是 `undefined` ⇒ `normalizePointValue`
 * 回落到 `DEFAULT_POINTS.half = 0`，与规格的默认值相同 —— 也就是第一批的行为。
 */
export function pointsFromSettings(settings: unknown): QuestionPoints {
  const source = (settings && typeof settings === 'object' && !Array.isArray(settings))
    ? settings as Record<string, unknown> : {};
  return {
    full: normalizePointValue(source.rewardStep, DEFAULT_POINTS.full),
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
 *
 * ⚠️ 连线题的 `links` 不走这里，走 `readPairs`：那里的每个元素（一条连线）是**独立的**，
 * 丢掉一条形状不全的连线不会改变其余任何一条的含义（而一条形状不全的连线本来就
 * 不可能匹配上任何正确配对）。
 */
function readStrictStrings(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  for (const item of raw) {
    if (typeof item !== 'string' || !item) return null;
  }
  return raw as string[];
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
  // 选中不止一个 ⇒ 不符合题型（**不是**「部分对」）：单选只有一个组成部分，没有半对。
  const picked = [...new Set(selected)];
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
  // ⚠️ **向后兼容**：`data.blanks` 缺席时走 M3 的单空路径（不动）。第一批落库的填空题
  // 一个 `blanks` 都没有，把它当成「零个空」会让全班的历史题目集体判错。
  if (!Array.isArray(data.blanks)) {
    const answers = readStrings(data.answers);
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
    const acceptable = readStrings(answers);
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
 */
function judgeMatch(data: Record<string, unknown>, value: unknown): GradeState {
  const pairs = readPairs(data.pairs);
  if (pairs.length === 0) return 'incorrect';
  const links = readPairs(readField(value, 'links'));
  if (links.length === 0) return 'incorrect';

  // 两端各数一次出现次数：某条连线的左项或右项被**别的**连线重复使用时，它不算对。
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
  'single-choice': judgeSingleChoice,
  // 判断题与单选**共用同一个判分器**（规格 §12：作答值与判分逐字相同）。
  'true-false': judgeSingleChoice,
  'multi-choice': judgeMultiChoice,
  'fill-blank': judgeFillBlank,
  'short-answer': () => null,
  order: judgeOrder,
  match: judgeMatch,
  categorize: judgeCategorize,
};

/**
 * 判分的分派。**不导出** —— 绕过 `points` 直接拿三态会让「得分」与「对错」在两条路上
 * 各算一次，而规格 §12 要收口的正是这件事（`isCorrect` 的语义收窄为「全对」，
 * 由 `gradeState` 派生写入）。
 */
function judge(node: QuestionNode, value: unknown): GradeState | null {
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
};

/** 编辑期校验。返回中文错误列表，空数组表示通过。 */
export function validateQuestion(node: QuestionNode): string[] {
  const errors: string[] = [];
  if (!node.prompt.trim()) errors.push('题干不能为空');
  VALIDATORS[node.type](node, errors);
  return errors;
}
