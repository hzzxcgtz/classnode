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
import { flattenAnswerable, flattenQuestions, TASK_TYPE } from './worksheet-questions.ts';
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
