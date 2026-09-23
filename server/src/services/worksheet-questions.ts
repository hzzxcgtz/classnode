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
 * 判分。返回 `null` 表示该题型不参与判分（主观题）。
 *
 * ⚠️ M4a 的 A1 只扩题型、**不动这里**：5 个新题型此刻走末尾的 `return null` 兜底，
 * 即「不判分」。这是**预期的中间态**（A2 才把返回值改成三态 + 数值），不是 bug。
 */
export function grade(node: QuestionNode, value: unknown): boolean | null {
  if (node.type === 'short-answer') return null;
  const v = (value ?? {}) as { selected?: unknown; text?: unknown };
  if (node.type === 'single-choice') {
    const correct = Array.isArray(node.data.correctKeys) ? (node.data.correctKeys as string[]) : [];
    const selected = Array.isArray(v.selected) ? (v.selected as string[]) : [];
    return selected.length === 1 && correct.length === 1 && selected[0] === correct[0];
  }
  if (node.type === 'fill-blank') {
    // ⚠️ `Array.isArray` 只保证「是数组」，不保证元素是字符串 —— `data` 是
    // `Record<string, unknown>`，内容来自库里的 JSON，任何手工改过的行都可能有
    // 非字符串元素。逐个元素判类型而不是整体断言成 `string[]`：少了这一步，
    // `answers: [42, '光合作用']` 会在 `normalizeFillText` 里抛 `raw.replace is not a function`，
    // 而学生提交路径上的一次抛错就是 500。非字符串元素直接跳过（当作不匹配）。
    const answers = Array.isArray(node.data.answers) ? node.data.answers : [];
    if (typeof v.text !== 'string') return false;
    const normalized = normalizeFillText(v.text);
    return answers.some((answer) => typeof answer === 'string' && normalizeFillText(answer) === normalized);
  }
  return null;
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
