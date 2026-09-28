/**
 * 两级题号（任务制）—— `flattenAnswerable` 的用例。
 *
 * 🔴 这个文件存在的理由：「任务」加进题目树之后，**题号与拍平必须分家**。
 * `flattenQuestions` 是「递归展开这棵树」，它展开出来的数组里任务节点与小题**混在一起** ——
 * 全仓有 11 个消费者（spec §十一 数出来的），其中至少四处在拿它的**下标当题号**或
 * 拿它的 **`.length` 当「几道题」**。改动它的返回值会让那 11 处**各自静默地错**。
 * ⇒ 它保持原样，另给一个只吐「可作答的题」的 `flattenAnswerable`。
 *
 * 用例钉住三件事：
 *   1. **任务自己不是一道题**（不出现在结果里）—— 这是「任务不能作答」（裁定 ①a）的代码形态；
 *   2. **每个任务内重排**（裁定 ②b）+ 散题不带前缀；
 *   3. 与 `flattenQuestions` 的**顺序同构**（见 `顺构` 那一条的断言）。
 *
 * ⚠️ 本文件跑在 `node --test`（根目录 `pnpm test:client`）—— 类型擦除直接加载 `.ts`，
 * 所以 import 必须带 `.ts` 后缀，且被加载的文件不能有**运行时** import。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_TYPE,
  correctAnswerLabel,
  correctKeysFromPayload,
  flattenAnswerable,
  flattenQuestions,
  groupAnswerable,
  optionBadge,
  questionTypeLabel,
  questionTypeNickname,
  readOptions,
  wrongSelectedKeys,
} from './worksheet-questions.ts';
import type { WorksheetQuestionNode } from './types.ts';

/** 借题一个最小的合法节点。`children` 默认空（正常数据里非任务节点没有孩子）。 */
function q(id: string, children: WorksheetQuestionNode[] = []): WorksheetQuestionNode {
  return { id, type: 'single-choice', prompt: `题干 ${id}`, inputMode: 'keyboard', data: {}, children };
}

/** 借一个任务容器。`prompt` 是它的**标题**（迁移写的就是「任务一」这种），不是说明文字。 */
function task(id: string, prompt: string, children: WorksheetQuestionNode[]): WorksheetQuestionNode {
  return { id, type: TASK_TYPE, prompt, inputMode: 'keyboard', data: {}, children };
}

/** 只要题号，用例里读起来干净。 */
function headings(nodes: WorksheetQuestionNode[]): string[] {
  return flattenAnswerable(nodes).map((item) => item.heading);
}

/** 只要**组内序号**。 */
function labels(nodes: WorksheetQuestionNode[]): string[] {
  return flattenAnswerable(nodes).map((item) => item.label);
}

/* ── 组内序号（★ 2026-09-29：矩阵按任务分块之后，小题上只画这一个数）──────── */

test('🔴 组内序号：每个任务从 1 起', () => {
  const nodes = [task('t1', '任务一', [q('a'), q('b')]), task('t2', '任务二', [q('c')])];
  assert.deepEqual(labels(nodes), ['1', '2', '1']);
  assert.deepEqual(headings(nodes), ['任务一 · 1', '任务一 · 2', '任务二 · 1']);
});

test('🔴 组内序号：散题沿用**跨全文**的编号 —— 下标推不出它（这个字段存在的理由）', () => {
  // 散题 a、任务一、散题 b：b 的序号是 `2`（散题共用一个计数器），
  // 而它在**自己那一段**里的下标是 0 ⇒ 拿 `index + 1` 当序号会印出一个不存在的「1」。
  const nodes = [q('a'), task('t1', '任务一', [q('c')]), q('b')];
  assert.deepEqual(labels(nodes), ['1', '1', '2']);
  assert.deepEqual(headings(nodes), ['1', '任务一 · 1', '2']);
  // 摆明冲突：最后一道题是它那一段的第 1 项，序号却是 2。
  const lastGroup = groupAnswerable(nodes)[2];
  assert.equal(lastGroup.items.length, 1);
  assert.equal(lastGroup.items[0].label, '2');
});

test('🔴 题号与组内序号**不许分家**（每一条题号的尾巴就是它的序号）', () => {
  const nodes = [q('a'), task('t1', '任务一', [q('b'), q('c')]), task('t2', '   ', [q('d')]), q('e')];
  for (const item of flattenAnswerable(nodes)) {
    assert.ok(
      item.heading === item.label || item.heading.endsWith(` · ${item.label}`),
      `题号 ${item.heading} 的尾巴不是它的序号 ${item.label}`,
    );
  }
  // 标题留空 ⇒ 题号就是序号本身（不编一个「任务N」）。
  assert.deepEqual(labels([task('t1', '   ', [q('a')])]), ['1']);
  assert.deepEqual(headings([task('t1', '   ', [q('a')])]), ['1']);
});

test('选择题选项只读取本机上传的配图地址，外部图片地址被丢弃', () => {
  const node = q('image-options');
  node.data.options = [
    { key: 'A', text: '本机图', imageUrl: '/uploads/chat/chat-550e8400-e29b-41d4-a716-446655440000.png' },
    { key: 'B', text: '外链图', imageUrl: 'https://example.com/tracker.png' },
  ];
  assert.deepEqual(readOptions(node), [
    { key: 'A', text: '本机图', imageUrl: '/uploads/chat/chat-550e8400-e29b-41d4-a716-446655440000.png' },
    { key: 'B', text: '外链图' },
  ]);
});

test('没有任务时：题号就是 1..n，不带任何前缀', () => {
  assert.deepEqual(headings([q('a'), q('b'), q('c')]), ['1', '2', '3']);
});

test('一个任务里三道小题：题号带任务标题，且任务内从 1 起', () => {
  const nodes = [task('t1', '任务一', [q('a'), q('b'), q('c')])];
  assert.deepEqual(headings(nodes), ['任务一 · 1', '任务一 · 2', '任务一 · 3']);
});

test('两个任务：**每个任务内各自重排**（裁定 ②b）', () => {
  const nodes = [
    task('t1', '任务一', [q('a'), q('b')]),
    task('t2', '任务二', [q('c')]),
  ];
  assert.deepEqual(headings(nodes), ['任务一 · 1', '任务一 · 2', '任务二 · 1']);
});

test('🔴 任务自己不是一道可作答的题 —— 它不出现在结果里', () => {
  const t1 = task('t1', '任务一', [q('a'), q('b')]);
  const result = flattenAnswerable([q('z'), t1]);
  assert.deepEqual(result.map((item) => item.node.id), ['z', 'a', 'b']);
  // 光有上面一条还不够：长度相等时「多一个任务、少一道题」也能凑齐。再钉一次类型。
  assert.equal(result.filter((item) => item.node.type === TASK_TYPE).length, 0);
});

test('任务标题的空白被去掉 —— 迁移与手输都可能带上', () => {
  assert.deepEqual(headings([task('t1', '  任务一\n', [q('a')])]), ['任务一 · 1']);
});

test('🔴 任务标题留空时**不编前缀**（不造一个「任务N」）', () => {
  // 裁定 ①a：任务的说明/标题允许留空，「纯分组」是合法数据。
  // 编一个序数前缀 = 替教师写他没写过的名字，与「迁移不猜」是同一条纪律。
  assert.deepEqual(headings([task('t1', '   ', [q('a'), q('b')])]), ['1', '2']);
});

test('散题与任务混排：散题自己连续编号、不带前缀', () => {
  const nodes = [q('a'), task('t1', '任务一', [q('b'), q('c')]), q('d')];
  assert.deepEqual(headings(nodes), ['1', '任务一 · 1', '任务一 · 2', '2']);
});

test('手工改过的嵌套（非任务节点带 children）不丢题，沿用同一层序号', () => {
  const nodes = [q('a', [q('a1'), q('a2')]), q('b')];
  assert.deepEqual(headings(nodes), ['1', '2', '3', '4']);
});

test('🔴 顺序同构：拍平结果逐项等于 flattenQuestions 去掉任务节点', () => {
  // 这是本文件最重要的一条 —— 它不重复实现，而是把「两级」与「拍平」钉在一起：
  // 只要有人改了遍历顺序（先孩子再父亲、乱序、漏掉嵌套），这里就红。
  const trees: WorksheetQuestionNode[][] = [
    [],
    [q('a'), q('b')],
    [task('t1', '任务一', [q('a'), q('b')]), task('t2', '任务二', [q('c')])],
    [q('a'), task('t1', '任务一', [q('b'), q('c', [q('c1')])]), q('d')],
    [task('t1', '', [q('a')]), q('b', [q('b1')])],
  ];
  for (const nodes of trees) {
    assert.deepEqual(
      flattenAnswerable(nodes).map((item) => item.node),
      flattenQuestions(nodes).filter((node) => node.type !== TASK_TYPE),
    );
  }
});

test('空树不炸，也不编出任何题号', () => {
  assert.deepEqual(flattenAnswerable([]), []);
});

/* ── 坏形状（手工改过的库行）：必须与 flattenQuestions 一样老实 ────────── */

/**
 * 🔴 这一组钉的是终审 I3：`flattenQuestions` 对 `children` 有 `Array.isArray` 守卫，
 * 而 `flattenAnswerable` 第一版直接 `node.children ?? []` —— 于是一行手改过的数据：
 *   · `children: {}` / `42` / `true` ⇒ **抛** `TypeError: list is not iterable`；
 *   · `children: "ab"`             ⇒ **不抛**，按字符迭代出两个**假题**（`node` 是单字符），
 *                                      下游读 `prompt` / `readOptions` 时再炸或渲染垃圾。
 * 要紧的是它落在**写路径**上（`routes/worksheets.ts` 的 `findQuestion` 没有 try/catch）
 * ⇒ 一份坏数据让学生**每次保存都 500**，而同一份数据喂给 `flattenQuestions` 是读得出来的。
 *
 * ⇒ 两份实现必须**同一条守卫**：不是数组就当没有孩子，与 `flattenQuestions` 逐字同形。
 */
const BAD_CHILDREN: unknown[] = [{}, 42, true, 'ab', null];

function withBadChildren(children: unknown): WorksheetQuestionNode {
  return { id: 't1', type: TASK_TYPE, prompt: '任务一', inputMode: 'keyboard', data: {}, children: children as WorksheetQuestionNode[] };
}

test('🔴 children 不是数组 ⇒ 当作没有孩子，不抛、也不编出假题', () => {
  for (const bad of BAD_CHILDREN) {
    const tree = [withBadChildren(bad), q('z')];
    assert.deepEqual(headings(tree), ['1'], `children=${JSON.stringify(bad)} 时应当只剩散题 z`);
  }
});

test('🔴 坏形状时两份拍平函数给出**同样的题**（一道不多、一道不少）', () => {
  for (const bad of BAD_CHILDREN) {
    const tree = [withBadChildren(bad), q('z')];
    assert.deepEqual(
      flattenAnswerable(tree).map((item) => item.node),
      flattenQuestions(tree).filter((node) => node.type !== TASK_TYPE),
      `children=${JSON.stringify(bad)}`,
    );
  }
});

test('🔴 小题自己带坏 children（非任务节点）同样不抛', () => {
  const broken = { ...q('a'), children: 42 as unknown as WorksheetQuestionNode[] };
  assert.deepEqual(headings([broken, q('b')]), ['1', '2']);
});

/* ── 分组：学生端按任务把小题归拢（教师 2026-09-25 的裁定）─────────────── */

/**
 * 学生端「任务名自己占一行」需要的是**分组**，不是一个扁平的列表。
 * 分组的规则只有一份，与题号同一个函数族 —— 各写一份必然漂移
 *（症状：屏幕上分组与题号对不上，而两处都不报错）。
 */
test('一个任务一组，标题就是它（去空白）的 `prompt`', () => {
  const groups = groupAnswerable([
    task('t1', '任务一', [q('a'), q('b')]),
    task('t2', '任务二', [q('c')]),
  ]);
  assert.deepEqual(groups.map((g) => g.title), ['任务一', '任务二']);
  assert.deepEqual(groups.map((g) => g.items.map((i) => i.heading)), [['任务一 · 1', '任务一 · 2'], ['任务二 · 1']]);
});

test('🔴 连续散题合成**一组**，不给它编标题（`title: null`）', () => {
  // 散题是老数据/手工做的库才有的形态。它们不属于任何任务，所以「这一段的标题」是
  // **没有**，而不是「任务一」那种编出来的名字（与「迁移不猜」同一条纪律）。
  const groups = groupAnswerable([q('a'), q('b'), task('t1', '任务一', [q('c')]), q('d')]);
  assert.deepEqual(groups.map((g) => g.title), [null, '任务一', null]);
  assert.deepEqual(groups.map((g) => g.items.map((i) => i.node.id)), [['a', 'b'], ['c'], ['d']]);
});

test('🔴 任务标题留空 ⇒ 这一组**没有标题行**（与题号无前缀同一件事）', () => {
  assert.deepEqual(groupAnswerable([task('t1', '   ', [q('a')])]).map((g) => g.title), [null]);
});

test('所有可作答的题恰好出现一次，顺序与 `flattenAnswerable` 逐项相同', () => {
  const nodes = [q('a'), task('t1', '任务一', [q('b'), q('c')]), q('d')];
  assert.deepEqual(
    groupAnswerable(nodes).flatMap((g) => g.items.map((i) => i.node.id)),
    flattenAnswerable(nodes).map((i) => i.node.id),
  );
});

test('空树 / 只有任务没有小题 ⇒ 零组或空组，都不编东西', () => {
  assert.deepEqual(groupAnswerable([]), []);
  assert.deepEqual(groupAnswerable([task('t1', '任务一', [])]), [{ title: '任务一', description: null, items: [] }]);
});

/* ── 任务描述（教师裁定 2026-09-25：任务容器要能写一段说明）──────────────── */

test('★ 分组带上任务的**描述**（`data.description`），散题那一段没有描述', () => {
  const withDesc: WorksheetQuestionNode = {
    ...task('t1', '任务一', [q('a')]),
    data: { description: '读下面的材料，回答 1–3 题' },
  };
  const groups = groupAnswerable([withDesc, q('b')]);
  assert.equal(groups[0].description, '读下面的材料，回答 1–3 题');
  assert.equal(groups[1].description, null, '散题那一段没有标题、也没有描述');
});

test('描述的空白被去掉；留空 / 非字符串 / 缺字段 ⇒ 一律 `null`（不编内容）', () => {
  const cases: unknown[] = [undefined, '', '   ', 42, null, {}, []];
  for (const description of cases) {
    const node = { ...task('t1', '任务一', [q('a')]), data: description === undefined ? {} : { description } };
    assert.equal(groupAnswerable([node])[0].description, null, `description=${JSON.stringify(description)}`);
  }
  const padded = { ...task('t2', '任务二', [q('b')]), data: { description: '  两边有空白\n' } };
  assert.equal(groupAnswerable([padded])[0].description, '两边有空白');
});

/* ── 学生端的选项记号（教师 2026-09-27：「学生页面中两个选项不要使用 T 和 F，只勾勾和叉叉」）── */

test('🔴 判断题的选项记号画成 ✓ / ✗，而不是协议里的 T / F', () => {
  assert.equal(optionBadge('true-false', 'T'), '✓');
  assert.equal(optionBadge('true-false', 'F'), '✗');
});

test('其它题型的记号原样回 key（A/B/C/D 是学生要在题干里找的东西，一个字母都不许动）', () => {
  for (const type of ['single-choice', 'multi-choice', 'fill-blank', 'order']) {
    for (const key of ['A', 'B', 'D', 'Z']) assert.equal(optionBadge(type, key), key, `${type}/${key}`);
  }
});

/* ── 答错时在哪些选项上打叉（教师：选择和判断答错后也要给叉叉和正确答案）──────── */

test('🔴 没拿到正确答案（没判分 / 全对）⇒ **一个都不打叉**', () => {
  // 🔴 这条闸非有不可：`correctKeys` 为空时若照「选中的都不对」处理，一道**还没提交**的题
  // 会把学生勾过的每一个选项都打上叉 —— 而那正是「界面在说假话」。
  assert.deepEqual(wrongSelectedKeys(['A'], []), []);
  assert.deepEqual(wrongSelectedKeys(['A', 'C'], []), [], '多选也一样');
});

test('单选 / 判断选错 ⇒ 只有那一个', () => {
  assert.deepEqual(wrongSelectedKeys(['A'], ['B']), ['A'], '判断题就是 T/F 两个 key，同一支');
  assert.deepEqual(wrongSelectedKeys(['T'], ['F']), ['T']);
});

test('🔴 多选：选错的打叉，选对的**不打**', () => {
  assert.deepEqual(wrongSelectedKeys(['A', 'D'], ['A', 'C']), ['D'], 'A 是对的 ⇒ 不许打叉');
  assert.deepEqual(wrongSelectedKeys(['B', 'D'], ['A', 'C']), ['B', 'D']);
});

test('🔴 多选**漏选**（只对了一部分）⇒ 空：他没有选错任何一个', () => {
  // 该告诉他的是「正确答案是 A、C」（下方那块提示区），不是给已选的打叉。
  assert.deepEqual(wrongSelectedKeys(['A'], ['A', 'C']), []);
});

test('顺序无关：作答值是学生的点击顺序，逐人不同', () => {
  assert.deepEqual(wrongSelectedKeys(['C', 'A'], ['A', 'C']), []);
});

test('🔴 「正确答案」那句话：判断题翻成「对 / 错」，其余题型原样回 key', () => {
  // 判断题的 key 是协议里的 T/F（不能改，见 TRUE_FALSE_OPTIONS）—— 而「正确答案 T」
  // 对一个小学生是噪声。抽屉那边同一条口径：判断题只印「对」、不印 key。
  assert.equal(correctAnswerLabel('true-false', ['T']), '对');
  assert.equal(correctAnswerLabel('true-false', ['F']), '错');
  // ⚠️ 其余题型不翻：题干里就是用字母指代选项的，翻成选项文字反而对不上。
  assert.equal(correctAnswerLabel('single-choice', ['B']), 'B');
  assert.equal(correctAnswerLabel('multi-choice', ['A', 'C']), 'A、C', '多选用顿号连');
});

test('🔴 服务端那串答案按下标**数值**排好 —— 字典序会把第 11 个答案排到第 2 位', () => {
  // 屏幕上它只是一串「正确答案」，顺序错了没人看得出来。
  assert.deepEqual(correctKeysFromPayload({ 0: 'A', 2: 'C' }), ['A', 'C']);
  assert.deepEqual(correctKeysFromPayload({ 10: 'K', 2: 'C' }), ['C', 'K'], '数值序，不是字典序');
  assert.deepEqual(correctKeysFromPayload(undefined), []);
  assert.deepEqual(correctKeysFromPayload({}), []);
  assert.deepEqual(correctKeysFromPayload({ 0: '' }), [], '空串不该在「正确答案」里留一个空档');
});

test('🔴 判断题上认不出的 key 必须把 key 原样吐回来，不许画成空白', () => {
  // 来路有两条，都不报错：手工改过的库行、以及将来真加了第三态（「无法判断」之类）。
  // 回空串的后果是那个格子**什么都没有** —— 学生看到一个没有记号的选项，
  // 而屏幕上没有任何报错（本仓最防的那一类）。
  assert.equal(optionBadge('true-false', 'X'), 'X');
  assert.notEqual(optionBadge('true-false', 'X'), '');
});

// ── 题型别名（★ 2026-09-28，教师给的对照表）────────────────────────────

test('🔴 questionTypeNickname：教师给的八个别名逐字对上', () => {
  assert.equal(questionTypeNickname('single-choice'), '慧眼选择');
  assert.equal(questionTypeNickname('multi-choice'), '慧眼选择', '多选题也是选择题');
  assert.equal(questionTypeNickname('fill-blank'), '开心填空');
  assert.equal(questionTypeNickname('match'), '巧手连线');
  assert.equal(questionTypeNickname('categorize'), '分类达人');
  assert.equal(questionTypeNickname('true-false'), '真假侦探');
  assert.equal(questionTypeNickname('order'), '顺序高手');
  assert.equal(questionTypeNickname('short-answer'), '妙语问答');
  assert.equal(questionTypeNickname('drawing'), '创意画板');
});

test('🔴 questionTypeNickname：别名与正式名**都要留着**（两件不同的东西）', () => {
  // 教师端用正式名（对得上教材与教研的用词），学生端用别名。
  assert.equal(questionTypeLabel('fill-blank'), '填空题');
  assert.equal(questionTypeNickname('fill-blank'), '开心填空');
  assert.notEqual(questionTypeLabel('fill-blank'), questionTypeNickname('fill-blank'));
});

test('🔴 questionTypeNickname：表里没有的（任务容器 / 手工改过的行）⇒ 回落，不返回空串', () => {
  // ⚠️ 回落成空串会让那一行只剩一个图标，而屏幕上不会报任何错。
  assert.equal(questionTypeNickname('task'), 'task');
  assert.equal(questionTypeNickname('没见过的题型'), '没见过的题型');
  assert.equal(questionTypeNickname(''), '');
});
