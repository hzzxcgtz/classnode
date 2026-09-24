/**
 * `worksheet-drag.ts` 的逐条断言 —— 点选态与落位操作的**唯一回归网**。
 *
 * 跑法（本仓没有前端测试框架，用 Node 24 自带的类型擦除直接执行）：
 *
 * ```bash
 * node --test src/lib/worksheet-drag.test.ts
 * ```
 *
 * 🔴 这个文件是本批（D1+D2）**唯一能把判据钉在自动化上的地方**：
 * `use-pointer-drag.ts` 与 7 个作答区组件的 JSX 在本仓没有任何回归网（没有 jsdom、
 * 没有 testing-library），触摸 / 滚动冲突只能真机验（F1 清单）。所以三个题型的
 * 「落位对不对」全部下沉到被本文件测的这几个纯函数里，组件只负责把事件接上来。
 *
 * 带 🔴 的用例是**反向断言**：把对应实现改坏，它们必须变红（报告里记着实测过程）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPair,
  clearSelection,
  moveInOrder,
  reorder,
  setPair,
  setPlacement,
  tapSource,
  unplace,
  type DragLink,
  type DragSelection,
} from './worksheet-drag.ts';

/** 点选态的一个可读写法，省得每条用例都写一遍 `{ kind: 'item', id: … }`。 */
const picked = (id: string): DragSelection => ({ kind: 'item', id });

// ── 1. 点选态：点条目 → 点目标（三个题型共用的那套）───────────────────────

test('🔴 tapSource 的往返：点 A（选中）→ 点 A（取消）→ 点 B（改选）→ 落位后清空', () => {
  // 这是「点选为主」那一层的最小完备描述（规格 §12 裁定 1）。四步各有各的错法：
  //   · 第二步不取消 ⇒ 学生点错了没有退路（唯一的退路就是再点一次）；
  //   · 第三步不「改选」而是「都要」⇒ 落位时落哪一个是不确定的；
  //   · 第四步不清 ⇒ 下一个条目会带着上一次的选中态一起挂上去。
  let selection: DragSelection = clearSelection();
  assert.deepEqual(selection, { kind: 'none' });

  selection = tapSource(selection, 'a');
  assert.deepEqual(selection, picked('a'), '点 A ⇒ 选中 A');

  selection = tapSource(selection, 'a');
  assert.deepEqual(selection, { kind: 'none' }, '再点 A ⇒ 取消（唯一的退路）');

  selection = tapSource(selection, 'a');
  selection = tapSource(selection, 'b');
  assert.deepEqual(selection, picked('b'), '点另一个 ⇒ 改选，不是两个都选');

  // 「点目标（落位）」那一下走的是组件里的 setPair / setPlacement / reorder，
  // 落位之后**必须**调 clearSelection（组件里有对应的一行）。
  selection = clearSelection();
  assert.deepEqual(selection, { kind: 'none' }, '落位后清空选择');
  // ⚠️ 清空**不能**靠再点一次源来实现：落位那一下点的不是源，`tapSource` 走不到。
});

test('clearSelection 每次都返回一个新的空态对象（常量会被调用方共享出去）', () => {
  assert.notEqual(clearSelection(), clearSelection());
  assert.deepEqual(clearSelection(), { kind: 'none' });
});

// ── 2. 排序：▲▼ 与拖动落位 ──────────────────────────────────────────────

test('🔴 moveInOrder 的边界：第一项上移 / 最后一项下移 / 未知 id 都**返回原数组**', () => {
  const order = ['i1', 'i2', 'i3'];
  // 返回**原数组本身**（同一个身份）而不是一份拷贝：setState 拿到同一个身份会跳过重渲染，
  // 那正是我们要的 ——「按了没反应」在屏幕上本来就该什么都没有。
  assert.equal(moveInOrder(order, 'i1', -1), order, '第一项上移是空操作');
  assert.equal(moveInOrder(order, 'i3', 1), order, '最后一项下移是空操作');
  assert.equal(moveInOrder(order, '不存在', -1), order, '未知 id 不抛');
  assert.equal(moveInOrder(order, '不存在', 1), order);
  assert.deepEqual(moveInOrder([], 'i1', 1), [], '空数组也不抛（一道条目全被删掉的坏题）');
  assert.deepEqual(order, ['i1', 'i2', 'i3'], '一次都没有改动入参');
});

test('moveInOrder：真实移动一次只换相邻两个（上移 / 下移各一条）', () => {
  assert.deepEqual(moveInOrder(['i1', 'i2', 'i3'], 'i2', -1), ['i2', 'i1', 'i3']);
  assert.deepEqual(moveInOrder(['i1', 'i2', 'i3'], 'i2', 1), ['i1', 'i3', 'i2']);
  assert.deepEqual(moveInOrder(['i1', 'i2', 'i3'], 'i3', -1), ['i1', 'i3', 'i2']);
});

test('🔴 reorder：越界下标返回原数组，不抛（下标是从 DOM 事件里算出来的）', () => {
  const order = ['i1', 'i2', 'i3'];
  assert.equal(reorder(order, 0, 0), order, '原地不动 ⇒ 原数组');
  assert.equal(reorder(order, -1, 1), order);
  assert.equal(reorder(order, 1, -1), order);
  assert.equal(reorder(order, 3, 1), order);
  assert.equal(reorder(order, 1, 3), order);
  assert.deepEqual(reorder(order, 0, 2), ['i2', 'i3', 'i1'], '把第一项拖到最后');
  assert.deepEqual(reorder(order, 2, 0), ['i3', 'i1', 'i2'], '把最后一项拖到最前');
  assert.deepEqual(order, ['i1', 'i2', 'i3'], '一次都没有改动入参');
});

// ── 3. 连线：两条不变量（左项唯一、**右项也唯一**）──────────────────────

test('🔴 setPair 的不变量一：同一个左项只能有一条线（改连 ⇒ 顶掉旧的）', () => {
  const pairs: DragLink[] = [{ leftId: 'l1', rightId: 'r1' }];
  assert.deepEqual(setPair(pairs, 'l1', 'r2'), [{ leftId: 'l1', rightId: 'r2' }]);
  assert.deepEqual(pairs, [{ leftId: 'l1', rightId: 'r1' }], '不改动入参');
});

test('🔴 setPair 的不变量二：同一个右项也只能被一个左项占用（旧的被顶掉，不是并存）', () => {
  // 并存 ⇒ 学生提交 `[{l1,r1},{l2,r1}]`，而服务端 `judgeMatch` 对「端点被用到两次」的
  // 处置是**用到它的那些线一条都不算对**：学生看着自己连上了，拿到的是 0 分。
  const pairs: DragLink[] = [{ leftId: 'l1', rightId: 'r1' }];
  const next = setPair(pairs, 'l2', 'r1');
  assert.deepEqual(next, [{ leftId: 'l2', rightId: 'r1' }], '同一个右项只能被一个左项占用');
  assert.equal(next.filter((pair) => pair.rightId === 'r1').length, 1);
  // 阳性对照：连到一个**没有人占用**的右项时，两条线都该在（不是「永远只留一条」）。
  assert.deepEqual(setPair(next, 'l1', 'r2'), [{ leftId: 'l2', rightId: 'r1' }, { leftId: 'l1', rightId: 'r2' }]);
});

test('setPair / clearPair：空 id 不动数据；clearPair 的往返', () => {
  const pairs: DragLink[] = [{ leftId: 'l1', rightId: 'r1' }];
  assert.equal(setPair(pairs, '', 'r1'), pairs, '空左 id ⇒ 原数组');
  assert.equal(setPair(pairs, 'l1', ''), pairs, '空右 id ⇒ 原数组');
  assert.equal(clearPair(pairs, 'l9'), pairs, '没连过 ⇒ 原数组');
  assert.deepEqual(clearPair(pairs, 'l1'), []);
  assert.deepEqual(pairs, [{ leftId: 'l1', rightId: 'r1' }], '不改动入参');
});

// ── 4. 归类：落框与取回 ────────────────────────────────────────────────

test('🔴 setPlacement / unplace 的往返：一个条目只能在一个框里（放另一个框是覆盖）', () => {
  const placement: Record<string, string> = { i1: 'z1' };
  const moved = setPlacement(placement, 'i1', 'z2');
  assert.deepEqual(moved, { i1: 'z2' }, '放进另一个框 ⇒ 覆盖，不是「两个框里都有」');
  assert.equal(Object.keys(moved).length, 1, '一个条目同时落在两个框里 ⇒ 判分只认一个、界面画两个');
  assert.deepEqual(unplace(moved, 'i1'), {}, '取回条目池');
  // 多个条目互不影响（框是能装很多个的，与连线的「右项唯一」不同）。
  assert.deepEqual(setPlacement({ i1: 'z1' }, 'i2', 'z1'), { i1: 'z1', i2: 'z1' });
  assert.deepEqual(placement, { i1: 'z1' }, '不改动入参');
});

test('unplace：本来就不在框里 ⇒ 返回原对象（不制造一次无意义的重渲染）', () => {
  const placement = { i1: 'z1' };
  assert.equal(unplace(placement, 'i2'), placement);
});

// ── 5. 所有函数都不改入参 ───────────────────────────────────────────────

test('🔴 所有函数都返回新对象 / 新数组，绝不就地改入参', () => {
  // 就地改会让 React 拿到同一个身份 ⇒ 屏幕不重画，而「数据其实变了」——
  // 那是「拖了但没动」这类症状里最难查的一种。
  const order = ['i1', 'i2', 'i3'];
  const pairs: DragLink[] = [{ leftId: 'l1', rightId: 'r1' }];
  const placement: Record<string, string> = { i1: 'z1' };
  const orderSnapshot = order.slice();
  const pairsSnapshot = pairs.map((pair) => ({ ...pair }));
  const placementSnapshot = { ...placement };

  reorder(order, 0, 2);
  moveInOrder(order, 'i2', -1);
  setPair(pairs, 'l1', 'r2');
  clearPair(pairs, 'l1');
  setPlacement(placement, 'i1', 'z2');
  unplace(placement, 'i1');

  assert.deepEqual(order, orderSnapshot);
  assert.deepEqual(pairs, pairsSnapshot);
  assert.deepEqual(placement, placementSnapshot);
  // 返回的必须是**另一个**身份（否则 React 不重画）。
  assert.notEqual(reorder(order, 0, 2), order);
  assert.notEqual(setPair(pairs, 'l1', 'r2'), pairs);
  assert.notEqual(setPlacement(placement, 'i1', 'z2'), placement);
});
