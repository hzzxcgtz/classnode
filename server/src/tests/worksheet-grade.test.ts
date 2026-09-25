import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_KEYS,
  QUESTION_TYPES,
  flattenQuestions,
  grade,
  normalizeFillText,
  stripAnswers,
  type QuestionNode,
  type QuestionPoints,
  type QuestionType,
  type WorksheetContent,
} from '../services/worksheet-questions.js';

/**
 * 判分用的分值档（A2 起 `grade()` 要收它）。
 *
 * ⚠️ **本文件只钉 `state`，不钉 `score`。** 下面的断言全都只读 `?.state`，
 * 所以 `P` 的取值在这份文件里**不可观测**。实测（审查者探针）：把 `grade()` 的得分改成
 * 完全忽略 `points` 的 `verdict === 'correct' ? 1 : 0`，**本文件一条都不红**，
 * 变红的是 `worksheet-grade-m4.test.ts`。
 *
 * ⇒ **`score` 的判据全在 `worksheet-grade-m4.test.ts`**（那里用 2 / 1 而不是默认的
 * 1 / 0：默认档下 `score` 恰好等于旧布尔值的 `Number()`，「把 `state` 当 `score` 用」
 * 「忘了乘 `points.full`」「得分写成比例」三种错会**全部绿**）。
 * ⚠️ 别以为这里传了 `P` 就等于测了分值 —— 那正是本注释第一版写错的地方。
 * ⚠️ **这里刻意不写「几条红 / 几条绿」**：那种数每加一条用例就会漂，而
 * 「拿旧数字当期望值」正是本项目反复出现的假绿形态。要总数就当场跑一遍。
 */
const P: QuestionPoints = { full: 2, half: 1 };

const choice: QuestionNode = { id: 'q1', type: 'single-choice', prompt: '…', inputMode: 'keyboard',
  data: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], correctKeys: ['B'] }, children: [] };
const fill: QuestionNode = { id: 'q2', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
  data: { answers: ['光合作用', '光合作用作用'] }, children: [] };
const short: QuestionNode = { id: 'q3', type: 'short-answer', prompt: '…', inputMode: 'keyboard',
  data: {}, children: [] };

test('单选：选中正确键即对，多选不给分', () => {
  assert.equal(grade(choice, { format: 'choice/v1', selected: ['B'] }, P)?.state, 'correct');
  assert.equal(grade(choice, { format: 'choice/v1', selected: ['A'] }, P)?.state, 'incorrect');
  assert.equal(grade(choice, { format: 'choice/v1', selected: ['A', 'B'] }, P)?.state, 'incorrect');
  assert.equal(grade(choice, { format: 'choice/v1', selected: [] }, P)?.state, 'incorrect');
});

test('填空：任一可接受答案即对', () => {
  assert.equal(grade(fill, { format: 'fill/v1', text: '光合作用' }, P)?.state, 'correct');
  assert.equal(grade(fill, { format: 'fill/v1', text: '光合作用作用' }, P)?.state, 'correct');
  assert.equal(grade(fill, { format: 'fill/v1', text: '呼吸作用' }, P)?.state, 'incorrect');
});

test('归一化：去首尾空格、全角转半角、折叠连续空格', () => {
  assert.equal(normalizeFillText('  光合作用  '), '光合作用');
  assert.equal(normalizeFillText('ＡＢＣ'), 'ABC');
  assert.equal(normalizeFillText('光合  作用'), '光合 作用');
  assert.equal(normalizeFillText('光合\t作用'), '光合 作用');
});

test('🔴 归一化不做大小写不敏感 —— 化学式必须区分', () => {
  // 用规格 §3-T 自己的例子（`CO2` / `co2`）。
  //
  // ⚠️ 原 brief 此处写的是 `grade(fill, { format: 'fill/v1', text: '光合作用'.toLowerCase() })`，
  // 但中文没有大小写，`'光合作用'.toLowerCase() === '光合作用'` 恒为真，所以 `fill` 的
  // `answers` 必然命中、`grade` 必然返回 `true` —— 那条断言在任何实现下都不可能为 `false`
  // （除非把大小写归一掉，而那正是规格 §3-T 明令禁止的）。改用有大小写的字符串，
  // 这条测试才真的在验证「不做大小写归一」。
  const co2: QuestionNode = { id: 'q4', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: ['CO2'] }, children: [] };
  assert.equal(grade(co2, { format: 'fill/v1', text: 'CO2' }, P)?.state, 'correct');
  assert.equal(grade(co2, { format: 'fill/v1', text: 'co2' }, P)?.state, 'incorrect');
});

test('问答题永远不判分', () => {
  // ⚠️ 这一条**刻意不写 `?.state`**：`?.state` 会把「`grade` 返回 `null`」与
  // 「返回了一个 `state` 字段缺失的对象」collapse 成同一个 `undefined`，
  // 而这条用例正是要钉住前者。断言整个返回值是 `null` 才是最强的形状。
  assert.equal(grade(short, { format: 'text/v1', text: '随便' }, P), null);
});

test('🔴 填空题：answers 里的非字符串元素不得让判分抛错', () => {
  // data 是 `Record<string, unknown>`、内容来自库里的 JSON，任何手工改过的行都可能混进
  // 非字符串元素。触发条件是「某个非字符串元素**之前没有元素命中**」—— 所以
  // `['光合作用', 42]` 恰好不炸（先命中了），`[42, '光合作用']` 才炸。三条都钉住。
  const withNumber: QuestionNode = { id: 'q5', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: [42, '光合作用'] }, children: [] };
  assert.equal(grade(withNumber, { format: 'fill/v1', text: '光合作用' }, P)?.state, 'correct', '非字符串元素应被跳过，不得抛错');

  const withNull: QuestionNode = { id: 'q6', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: [null, '光合作用'] }, children: [] };
  assert.equal(grade(withNull, { format: 'fill/v1', text: '光合作用' }, P)?.state, 'correct');

  const withObject: QuestionNode = { id: 'q7', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: [{}, '光合作用'] }, children: [] };
  assert.equal(grade(withObject, { format: 'fill/v1', text: '光合作用' }, P)?.state, 'correct');

  const withArray: QuestionNode = { id: 'q8', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: [['光合作用'], '光合作用'] }, children: [] };
  assert.equal(grade(withArray, { format: 'fill/v1', text: '光合作用' }, P)?.state, 'correct');

  // 全是非字符串时退化为「不匹配」，而不是抛错
  const allJunk: QuestionNode = { id: 'q9', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: [42, null] }, children: [] };
  assert.equal(grade(allJunk, { format: 'fill/v1', text: '光合作用' }, P)?.state, 'incorrect');
});

test('flattenQuestions 深度优先展开（含嵌套 children）', () => {
  const mk = (id: string, children: QuestionNode[] = []): QuestionNode =>
    ({ id, type: 'short-answer', prompt: '…', inputMode: 'keyboard', data: {}, children });
  // 树形：a ─┬─ b ── c
  //         └─ d
  //       e
  const c = mk('c');
  const b = mk('b', [c]);
  const d = mk('d');
  const a = mk('a', [b, d]);
  const e = mk('e');
  const content: WorksheetContent = { schemaVersion: 1, nodes: [a, e] };
  assert.deepEqual(flattenQuestions(content).map(n => n.id), ['a', 'b', 'c', 'd', 'e']);
});

test('🔴 stripAnswers 递归剥掉子节点的答案，且原对象未被改动', () => {
  const childFill: QuestionNode = { id: 'p1c1', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: ['光合作用'], explanation: '子节点解析' }, children: [] };
  const parentChoice: QuestionNode = { id: 'p1', type: 'single-choice', prompt: '…', inputMode: 'keyboard',
    data: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], correctKeys: ['B'] },
    children: [childFill] };
  const content: WorksheetContent = { schemaVersion: 1, nodes: [parentChoice] };
  // 原件快照：剥答案必须是纯函数式的，比对用它。
  const snapshot = structuredClone(content);

  const stripped = stripAnswers(content);
  const strippedChild = stripped.nodes[0].children[0];
  assert.deepEqual(stripped.nodes[0].data, { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }] },
    '父节点：答案剥掉、非答案数据保留');
  assert.deepEqual(strippedChild.data, {}, '子节点：answers 与 explanation 也必须被剥掉');
  assert.equal(strippedChild.id, childFill.id, '子节点本身保留（只剥 data 里的答案键）');
  assert.ok(!JSON.stringify(stripped).includes('correctKeys'), '整棵树都不得残留 correctKeys');
  assert.ok(!JSON.stringify(stripped).includes('光合作用'), '整棵树都不得残留答案');

  assert.deepEqual(content, snapshot, '原对象（含子节点）不得被就地改动');
});

test('🔴 stripAnswers 剥掉答案，且不改原对象', () => {
  const content: WorksheetContent = { schemaVersion: 1, nodes: [choice, fill, short] };
  const stripped = stripAnswers(content);
  const json = JSON.stringify(stripped);
  assert.ok(!json.includes('correctKeys'), 'correctKeys 必须被剥掉');
  assert.ok(!json.includes('answers'), 'answers 必须被剥掉');
  assert.equal(JSON.stringify(content).includes('correctKeys'), true, '原对象不得被改动');
  assert.equal(stripped.nodes.length, 3, '题数与题序不变');
  assert.equal(stripped.nodes[0].prompt, choice.prompt, '题干保留');
});

// ---------------------------------------------------------------------------
// ⑥ 答案键的**泄漏门**（规格 §5.4 第一条）
// ---------------------------------------------------------------------------

/**
 * **一个题型的一种 `data` 形状**的样本，以及它每个键是「答案」还是「给学生看的」。
 *
 * 🔴 **为什么是「一组形状」而不是「一个样本」**：`fill-blank` 有**两种**形状 ——
 * M3 的单空 `{ answers }` 与 M4a 的多空 `{ blanks: [{ answers }, …] }`。
 * 按题型只留一个样本时，多空那条路**根本走不到**，而它的答案在**第二层**：
 * 顶层的 `Object.keys` 看不见 `blanks[*]`，于是
 * `data.blanks[0].answers = ['H2O']` 会原样跟着 `student-view` 发给学生 ——
 * 一次 `GET` 就让全班拿到每一个空的可接受答案，**全程无报错**。
 * （这不是假想：A1 的第一版就是这么交出去的，审查实测抓出来的。）
 *
 * 🔴 `ANSWER_KEY_AUDIT` 那个 `Record` **同时是编译期门**：`QuestionType` 多一个成员
 * 而这里没补时，`tsc` 直接报错（`pnpm test` 先编译再跑，所以题型加漏了连测试都跑不起来）。
 */
interface AnswerShapeSample {
  /** 只用于报错信息，不参与判据。 */
  label: string;
  /** 该形状 `data` 里会出现的东西。 */
  data: Record<string, unknown>;
  /** 属于答案的键 —— **递归地看**（含嵌套层）：必须 ∈ `ANSWER_KEYS`，剥离时必须消失。 */
  answerKeys: string[];
  /** 属于学生的**顶层**键：必须 ∉ `ANSWER_KEYS`，剥离后必须原样留下。 */
  safeKeys: string[];
  /**
   * 🔴 剥离之后 `data` **逐字**该长什么样。
   * 嵌套层的答案（`blanks[*].answers`）只有它能钉住 —— 顶层键集合对第二层是瞎的。
   */
  afterStrip: Record<string, unknown>;
}

const ANSWER_KEY_AUDIT: Record<QuestionType, AnswerShapeSample[]> = {
  // ★ 2026-09-25：**空数组 = 这一格的答案**，不是漏填 ——
  //    这张表审计的是「题型 × 作答值的形状」，而**任务根本没有作答值**
  //    （教师裁定 ①a）。⇒ 它没有任何形状可审计。
  //    ⚠️ 空数组在这里是**可判定的**：文件末尾那条遍历按题型逐个跑，
  //    空数组不会让任何断言变绿，只是不出现在循环里。
  task: [],
  'single-choice': [{
    label: '单选（M3 形状）',
    data: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], correctKeys: ['B'], explanation: '光合作用需要光' },
    answerKeys: ['correctKeys', 'explanation'],
    safeKeys: ['options'],
    afterStrip: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }] },
  }],
  'fill-blank': [
    {
      label: '单空（M3 形状，**不许弱化**）',
      data: { answers: ['光合作用'], explanation: '见课本 P42' },
      answerKeys: ['answers', 'explanation'],
      safeKeys: [],
      afterStrip: {},
    },
    {
      // 🔴 **M4a 的多空形状：答案在第二层。** 这条样本是审查抓出来那个泄漏的直接产物 ——
      //    没有它，`stripAnswers` 只剥顶层也能让整个审计用例全绿。
      label: '多空（M4a：data.blanks[*].answers）',
      data: { blanks: [{ answers: ['H2O', '水'] }, { answers: ['CO2'] }] },
      answerKeys: ['answers'],
      // `blanks` 是**给学生看的**（他要知道有几个空），所以它必须留下 ——
      // 把 `blanks` 整个删掉不是「更安全」，是把这道题变成一道**没有空的填空题**。
      safeKeys: ['blanks'],
      // ⚠️ 剥完必须**保留空的数量与顺序**：两个空还是两个空，只是各自没有了答案。
      afterStrip: { blanks: [{}, {}] },
    },
  ],
  'short-answer': [{
    label: '主观题',
    data: { explanation: '参考答案要点：光照、CO₂、水' },
    answerKeys: ['explanation'],
    safeKeys: [],
    afterStrip: {},
  }],
  // ── M4a 新增的 5 个题型 ──────────────────────────────────────────
  'true-false': [{
    label: '判断题',
    data: { correctKeys: ['T'], explanation: '蒸发吸热' },
    // 判断题**不存 `options`**（选项恒为对/错两个），所以它的 `data` 里只有答案。
    answerKeys: ['correctKeys', 'explanation'],
    safeKeys: [],
    afterStrip: {},
  }],
  'multi-choice': [{
    label: '多选题',
    data: {
      options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }],
      correctKeys: ['A', 'C'],
      partialCredit: 'allow-missing',
      explanation: '甲与丙',
    },
    answerKeys: ['correctKeys', 'explanation'],
    // `partialCredit` 是**给学生看的规则**（他要知道漏选算不算部分给分），不是答案 ——
    // 它决定的是「怎么算分」，不是「哪个选项对」。
    safeKeys: ['options', 'partialCredit'],
    afterStrip: {
      options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }],
      partialCredit: 'allow-missing',
    },
  }],
  order: [{
    label: '排序题',
    data: {
      // ⚠️ 样本里 `items` 的顺序（i1 → i2）与 `correctOrder`（i2 → i1）**刻意不同**：
      // 两者相同是一道「学生什么都不做就满分」的坏题（`validateQuestion` 会拒绝它）。
      items: [{ id: 'i1', text: '甲' }, { id: 'i2', text: '乙' }],
      correctOrder: ['i2', 'i1'],
      explanation: '先乙后甲',
    },
    // 🔴 `correctOrder` **就是答案本身**：泄漏它 = 学生打开 `student-view` 就看到正确顺序。
    answerKeys: ['correctOrder', 'explanation'],
    safeKeys: ['items'],
    afterStrip: { items: [{ id: 'i1', text: '甲' }, { id: 'i2', text: '乙' }] },
  }],
  match: [{
    label: '连线题',
    data: {
      left: [{ id: 'l1', text: '甲' }],
      right: [{ id: 'r1', text: 'A' }],
      pairs: [{ leftId: 'l1', rightId: 'r1' }],
      explanation: '甲对 A',
    },
    // 🔴 `pairs` 是答案（哪一对连哪一对）；`left` / `right` 是必须发给学生的题面。
    // ⚠️ **学生那一侧的作答值不叫 `pairs`**，叫 `links`（裁定 2026-09-23：学生侧字段名
    // 不许借用这张黑名单里的名字，否则「学生答对了」与「答案泄漏了」在判据上无法区分）。
    answerKeys: ['pairs', 'explanation'],
    safeKeys: ['left', 'right'],
    afterStrip: { left: [{ id: 'l1', text: '甲' }], right: [{ id: 'r1', text: 'A' }] },
  }],
  categorize: [{
    label: '归类题',
    data: {
      items: [{ id: 'i1', text: '猫' }],
      zones: [{ id: 'z1', label: '哺乳类' }, { id: 'z2', label: '鸟类' }],
      placement: { i1: 'z1' },
      explanation: '猫是哺乳类',
    },
    // 🔴 `placement` 是答案（哪个条目归到哪个框）；`items` / `zones` 是题面。
    // ⚠️ **学生那一侧的作答值不叫 `placement`**，叫 `assignment`（同上那条裁定）。
    answerKeys: ['placement', 'explanation'],
    safeKeys: ['items', 'zones'],
    afterStrip: {
      items: [{ id: 'i1', text: '猫' }],
      zones: [{ id: 'z1', label: '哺乳类' }, { id: 'z2', label: '鸟类' }],
    },
  }],
  // ★ M4b：绘图题**没有答案键** —— 学生画的东西在 `WorksheetAnswer.value` 里，不在 `data` 里。
  // 本题型在编辑器新建时的初始 `data` 就是 `{}`，所以三个数组全空、`afterStrip` 是 `{}`。
  drawing: [{
    label: '绘图题（M4b：没有答案键，data 恒为空）',
    data: {},
    answerKeys: [],
    safeKeys: [],
    afterStrip: {},
  }],
};

/**
 * 把样本里每个**答案键**对应的值都挖出来（**递归**，判据见 `AnswerShapeSample.answerKeys`）。
 *
 * 用途是那条**形状无关**的值级判据：把挖出来的值 `JSON.stringify` 之后在剥离结果里搜。
 * 它完全不看键名，所以哪怕答案藏在第三层、或者新题型换了别的嵌套写法，它都还能响 ——
 * 而手写的 `afterStrip` 只有在写对的前提下才响。
 */
function collectAnswerValues(
  value: unknown,
  answerKeys: readonly string[],
  out: unknown[] = [],
): unknown[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectAnswerValues(item, answerKeys, out));
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (answerKeys.includes(key)) out.push(child);
    else collectAnswerValues(child, answerKeys, out);
  }
  return out;
}

/**
 * 🔴 **每个题型的答案键都必须 ∈ `ANSWER_KEYS`，且剥离之后逐字消失。**
 *
 * 为什么需要这条：`ANSWER_KEYS` 是一张**黑名单**，而 `normalizeNode` 把 `data`
 * **原样透传** —— 没被列进去的键会不声不响地跟着 `student-view` 发给学生。
 * 当初三种题型的答案键恰好都被覆盖到了，但这是一次**巧合**：规格 §5.4 自己的措辞
 * 是单数的 `answer`，而代码里是复数的 `answers`。加一种答案键叫 `answer` 的题型，
 * 泄漏会**静默**发生，且没有任何编译期检查会红。
 *
 * ⚠️ 这条门只能保证「**已声明**的答案键都在表里」——它挡不住「加了答案键却**不声明**」。
 * 真正的根治是改成 allowlist 投影（按题型列出安全键），那需要另一个决定，不在本批。
 * 所以它是**回归门**，不是证明。
 *
 * 🔴 **M4a：判据是「逐形状」的**（见 `AnswerShapeSample`）。多空填空的答案在**第二层**
 * （`data.blanks[*].answers`），只看顶层键集合的判据够不到它 —— 而 A1 的第一版正是
 * 只剥顶层、只登记单空形状，于是多空题的答案原样发给学生而这条用例**全绿**。
 * 现在每个形状都要给出一份 `afterStrip`（逐字期望）+ 一条形状无关的值级判据。
 */
test('🔴 每个题型的答案键都必须 ∈ ANSWER_KEYS（黑名单漏一个 = 静默泄漏给学生）', () => {
  for (const type of QUESTION_TYPES) {
    const shapes = ANSWER_KEY_AUDIT[type];
    // ★ 2026-09-25：**容器是这条规则的唯一例外，而且必须是显式的**。
    //    `task`（任务）没有 `data`（教师裁定 ①a：任务只是分组 + 一段说明，作答全在小题上）
    //    ⇒ **它没有答案键可登记**，空数组就是它的**答案**，不是漏登记。
    //    ⚠️ 开这个口子**只给它一个**：别的题型仍然必须至少有一条样本 ——
    //    把 `length > 0` 整体删掉会让「新增题型忘了登记」重新变成静默的，
    //    而这条门存在的全部意义就是拦那个。
    if (type === 'task') {
      assert.deepEqual(shapes, [], 'task 没有答案键，它在样本表里必须恰好是空的');
      continue;
    }
    assert.ok(
      shapes && shapes.length > 0,
      `题型「${type}」没有登记答案键样本 —— 新增题型时必须在 ANSWER_KEY_AUDIT 里补一条`,
    );

    for (const sample of shapes) {
      const where: string = `题型「${type}」/ ${sample.label}`;
      const allKeys = Object.keys(sample.data).sort();
      const declared = [...sample.answerKeys, ...sample.safeKeys].sort();

      // 判据 ①：顶层不许有**没被声明**的键。
      // ⚠️ 这里刻意不写成 `deepEqual(declared, allKeys)`：多空形状的 `answers` 在第二层，
      // 不在顶层键集合里 —— 那条写法会把它误判成「声明与样本脱节」。反过来的方向由
      // 下面判据 ② 补上。
      assert.deepEqual(
        allKeys.filter((key) => declared.includes(key)),
        allKeys,
        `${where}：顶层每个键都要被声明成「答案」或「给学生」之一`,
      );
      // 判据 ②：声明过的键必须**真的在样本里出现**（嵌套层也算）。
      // 少了它，一个「声明了但样本里根本没有」的键会让下面所有判据恒真 —— 假绿。
      const serialized = JSON.stringify(sample.data);
      for (const key of declared) {
        assert.ok(
          serialized.includes(`"${key}"`),
          `${where}：声明的键「${key}」在样本里根本没出现 —— 样本与声明脱节了`,
        );
      }

      for (const key of sample.answerKeys) {
        assert.ok((ANSWER_KEYS as readonly string[]).includes(key),
          `${where}：答案键「${key}」不在 ANSWER_KEYS 里 ⇒ student-view 会把它原样下发给学生（规格 §5.4）`);
      }
      for (const key of sample.safeKeys) {
        assert.ok(!(ANSWER_KEYS as readonly string[]).includes(key),
          `${where}：把「${key}」声明成给学生看的，但它却在 ANSWER_KEYS 里 ⇒ 会被一起剥掉，学生拿到残缺的题`);
      }

      // 判据 ③ 行为对照：做成一道真题跑一遍**真实的剥离链路**，与 `afterStrip` **逐字**比对。
      // 逐字（而不是只比键名）是关键：多空形状的漏剥发生在第二层，键名比对看不见。
      const node: QuestionNode = {
        id: `q_${type}`, type, prompt: '题干', inputMode: 'keyboard',
        data: sample.data, children: [],
      };
      const stripped = stripAnswers({ schemaVersion: 1, nodes: [node] });
      assert.deepEqual(
        stripped.nodes[0].data,
        sample.afterStrip,
        `${where}：剥离后的 data 必须逐字等于期望 —— 多一个键是漏剥（泄漏），` +
        '少一个键是多剥（学生拿到残缺的题，例如把 `blanks` 整个删掉）',
      );

      // 判据 ④ 值级兜底（**形状无关**）：把样本里每个答案键的**值**挖出来，剥完之后一个都不许剩。
      // 它不依赖上面那份手写的 `afterStrip` 写得对不对，所以能抓住
      // 「又加了一层嵌套的答案，而 `afterStrip` 也跟着写错了」。
      for (const answerValue of collectAnswerValues(sample.data, sample.answerKeys)) {
        const needle = JSON.stringify(answerValue);
        assert.ok(
          !JSON.stringify(stripped).includes(needle),
          `${where}：答案 ${needle} 还在剥离结果里（规格 §5.4 红线）`,
        );
      }
    }
  }
});
