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
import { flattenAnswerable, flattenQuestions, groupAnswerable, readOptions, TASK_TYPE } from './worksheet-questions.ts';
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
