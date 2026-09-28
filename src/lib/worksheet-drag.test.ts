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
  dragShifts,
  moveInOrder,
  reorder,
  setPair,
  setPlacement,
  slotIndexAt,
  tapItem,
  tapSource,
  tapTarget,
  type DragLink,
  type DragSelection,
  unplace,
} from './worksheet-drag.ts';

/** 点选态的一个可读写法，省得每条用例都写一遍 `{ kind: 'item', id: … }`。 */
const picked = (id: string): DragSelection => ({ kind: 'item', id });

// ── 1. 点选态：点条目 → 点目标（三个题型共用的那套）───────────────────────

test('🔴 tapSource 的往返：点 A（选中）→ 点 A（取消）→ 点 B（改选）', () => {
  // 这是「点选为主」那一层的最小完备描述（规格 §12 裁定 1）。三步各有各的错法：
  //   · 第二步不取消 ⇒ 学生点错了没有退路（唯一的退路就是再点一次）；
  //   · 第三步不「改选」而是「都要」⇒ 落位时落哪一个是不确定的。
  let selection: DragSelection = clearSelection();
  assert.deepEqual(selection, { kind: 'none' });

  selection = tapSource(selection, 'a');
  assert.deepEqual(selection, picked('a'), '点 A ⇒ 选中 A');

  selection = tapSource(selection, 'a');
  assert.deepEqual(selection, { kind: 'none' }, '再点 A ⇒ 取消（唯一的退路）');

  selection = tapSource(selection, 'a');
  selection = tapSource(selection, 'b');
  assert.deepEqual(selection, picked('b'), '点另一个 ⇒ 改选，不是两个都选');

  // ⚠️ **这条用例曾经声称的第四步（「落位后清空选择」）在自动化上没有任何判据，
  // 那一行断言只是把 `clearSelection()` 的返回值拿来断言它自己（恒真）** ——
  // 2026-09-24 审查抓出，已把名字改成它真正钉的三步。理由与射程：
  //   · 「点目标」（`onTap` 里走 `setPair` / `setPlacement` / `reorder`）与「清空」
  //     （`setSelection(clearSelection())`）都发生在**组件**里（`questions/*.tsx`），
  //     本仓没有 jsdom / testing-library ⇒ 这两行代码**跑不到**，写在这里的断言只能是假绿；
  //   · 真判据在 F1 的真机清单里（报告 §4「未验证」第 1 条），**不得**用这条用例代替。
  // 能钉的只有 `clearSelection()` 自己的契约 —— 见下一条用例。
});

test('clearSelection 的契约：只返回空态，且每次都是新对象（不是共享常量）', () => {
  // ⚠️ 名字按它真正钉的东西写。**旧名字逐字是**「clearSelection 每次都返回一个新的空态对象
  //（常量会被调用方共享出去）」—— 名字本身没写错，只是当时**没有任何断言钉着**它声称的性质。
  // ⊘ 2026-09-24 更正：这里原先引的旧名字是「点目标 → 落位并清空」，**那句话在这份文件的历史里
  // 从未作为用例名存在过**（本文件是 58e9b7d 建的，`git show 58e9b7d:src/lib/worksheet-drag.test.ts`
  // 里那两条用例名逐字是上面这一句与「🔴 tapSource 的往返：点 A（选中）→ 点 A（取消）→
  // 点 B（改选）→ 落位后清空」；`git log -S"点目标 → 落位并清空"` 只在引入这行注释的提交上命中）。
  // 它是把**另一条**用例名字的尾巴「→ 落位后清空」改写成了「看起来像」的一句引用 ——
  // 而那句话指向的那一步（落位后清空）本文件钉不住，理由在上一条用例里。
  // 本仓的纪律：引文必须逐字。
  // `notEqual` 在这里**不是重言式**：实现若改成返回一个模块级常量
  //（`const NONE = { kind: 'none' }`），两次调用就是同一个引用 ⇒ 这一条变红。
  // 那正是要挡的：常量会被调用方共享出去，一处改了处处跟着改。
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

// ── 3a. 排序：拖动中的槽位与让位（★ 2026-09-26，教师第 3 条）─────────────

test('slotIndexAt：取离 y 最近的槽位；越出两端就收到两端', () => {
  const centers = [100, 200, 300];
  assert.equal(slotIndexAt(centers, 100), 0);
  assert.equal(slotIndexAt(centers, 190), 1);
  assert.equal(slotIndexAt(centers, 260), 2);
  // 拖到列表上方 / 下方之外 ⇒ 两端（不是 -1：那是「一个槽位都没有」的意思）。
  assert.equal(slotIndexAt(centers, -400), 0);
  assert.equal(slotIndexAt(centers, 9999), 2);
});

test('🔴 slotIndexAt：等距时保留**更靠前**的那一个（拖在两格正中间不许抖）', () => {
  // 这是「不许抖」那条约束在这一层的落实：如果等距时来回取整，手指停在两格中间
  // 会让 `to` 每帧在 i / i+1 之间跳，屏幕上就是其余项反复让位、回位。
  assert.equal(slotIndexAt([0, 10], 5), 0);
  assert.equal(slotIndexAt([0, 10], 4.9), 0);
  assert.equal(slotIndexAt([0, 10], 5.1), 1);
});

test('slotIndexAt：一个槽位都没有 ⇒ -1（调用方按「没有落点」处置，不许抛）', () => {
  assert.equal(slotIndexAt([], 100), -1);
  assert.equal(slotIndexAt(undefined as unknown as number[], 100), -1);
});

test('🔴 dragShifts：均匀间距下就是「各挪一格」，被拖的那一项不动', () => {
  const centers = [0, 10, 20, 30];
  // 把第 2 项（下标 1）拖到下标 3：原来的 3、4 项各往上让一格。
  assert.deepEqual(dragShifts(centers, 1, 3), [0, 0, -10, -10]);
  // 反向：把最后一项拖到最前，中间三项各往下让一格。
  assert.deepEqual(dragShifts(centers, 3, 0), [10, 10, 10, 0]);
  // 没挪动 ⇒ 谁都不动。
  assert.deepEqual(dragShifts(centers, 2, 2), [0, 0, 0, 0]);
});

test('🔴 dragShifts：条目**高度不一**时每项挪的像素不同（这正是它不能写成「挪一个固定高度」的理由）', () => {
  // 排序题的条目会折行（长句子），所以「一格 = 固定 44px」那条捷径是错的：
  // 让位让出的必须是**那一个槽位实际有多高**。
  const centers = [0, 10, 30, 60];
  // 第 1 项（下标 0）拖到下标 2 ⇒ 下标 1 顶到槽 0（-10）、下标 2 顶到槽 1（-20）。
  assert.deepEqual(dragShifts(centers, 0, 2), [0, -10, -20, 0]);
});

test('🔴 dragShifts：越界 / 空表 ⇒ 全 0 的数组，不抛（下标是从 DOM 事件里算出来的）', () => {
  const centers = [0, 10, 20];
  assert.deepEqual(dragShifts(centers, -1, 1), [0, 0, 0]);
  assert.deepEqual(dragShifts(centers, 0, 9), [0, 0, 0]);
  assert.deepEqual(dragShifts([], 0, 0), []);
  assert.deepEqual(dragShifts(undefined as unknown as number[], 0, 1), []);
});

// ── 3b（原来的顺序）／连线的不变量 ──────────────────────────────────────

test('🔴 setPair：同一个左项可以连**多个**右项（一对多）—— 裁定甲把这条反过来了', () => {
  // 🔴 这条用例**原来断言的是相反的结论**（名字叫「同一个左项只能有一条线（改连 ⇒ 顶掉旧的）」）。
  // 教师 2026-09-28 裁定「甲」：连线题要支持一对多 / 多对一 / 多对多 ⇒ 并存，不顶掉。
  const links = setPair([], 'l1', 'r1');
  const both = setPair(links, 'l1', 'r2');
  assert.deepEqual(both, [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l1', rightId: 'r2' }]);
  // 同一条再加一次是**幂等**的（不是再加一条重复的 —— 判分会把它算两次命中）
  assert.deepEqual(setPair(both, 'l1', 'r1'), both);
});
test('🔴 setPair：同一个右项可以被**多个**左项连（多对一）—— 同一条裁定的另一半', () => {
  // 🔴 同样：这条原来断言「旧的被顶掉，不是并存」。
  const links = setPair([], 'l1', 'r1');
  assert.deepEqual(setPair(links, 'l2', 'r1'), [
    { leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r1' },
  ]);
});
test('setPair / clearPair：空 id 不动数据；clearPair 的往返', () => {
  const pairs: DragLink[] = [{ leftId: 'l1', rightId: 'r1' }];
  assert.equal(setPair(pairs, '', 'r1'), pairs, '空左 id ⇒ 原数组');
  assert.equal(setPair(pairs, 'l1', ''), pairs, '空右 id ⇒ 原数组');
  assert.equal(clearPair(pairs, 'l9'), pairs, '没连过 ⇒ 原数组');
  assert.deepEqual(clearPair(pairs, 'l1'), []);
  assert.deepEqual(pairs, [{ leftId: 'l1', rightId: 'r1' }], '不改动入参');
});

// ── 3b. 连线：点一下**右项**（落点）────────────────────────────────────

test('🔴 tapTarget：**没选左项**时点一下已连的右项 ⇒ 断开（教师第 2 条「点一下就能删」）', () => {
  // ★ 2026-09-26。这一条是全批唯一一处「现状与 spec 不符」的修正：
  // spec 的现状写着「点一下已连的右项会走 clearPair」，而代码里 `onTap` 第一句就是
  // `if (!leftId) { … return }` —— **没选左项时点右项什么都不做**。
  // 真实路径是「先点左项 → 再点右项」两步，而那正是教师说的「很不起眼」。
  const pairs: DragLink[] = [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }];
  assert.deepEqual(tapTarget(pairs, null, 'r1'), [{ leftId: 'l2', rightId: 'r2' }], '断开的是连到 r1 的那条');
  assert.deepEqual(pairs, [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }], '不改动入参');
});

test('tapTarget：没选左项时点**没连过**的右项 ⇒ 返回原数组本身（不制造一次无意义的重渲）', () => {
  const pairs: DragLink[] = [{ leftId: 'l1', rightId: 'r1' }];
  // ⚠️ 必须是**同一个身份**：`onChange` 拿到一份新数组会白写一条上传队列。
  assert.equal(tapTarget(pairs, null, 'r2'), pairs);
});

test('🔴 tapTarget：选着左项时点右项 —— 已连的拆**那一条**、没连的连上（不再顶掉别的）', () => {
  // ★ 2026-09-28（裁定甲）：拆的是**这一条**（`removePair`），不是该左项的全部线。
  let links = setPair([], 'l1', 'r1');
  links = setPair(links, 'l1', 'r2');
  // 再点 r1 ⇒ 只拆掉 l1→r1，l1→r2 留着
  assert.deepEqual(tapTarget(links, 'l1', 'r1'), [{ leftId: 'l1', rightId: 'r2' }]);
  // 没连过的右项 ⇒ 连上（并存）
  assert.deepEqual(tapTarget(links, 'l1', 'r3'), [
    { leftId: 'l1', rightId: 'r1' }, { leftId: 'l1', rightId: 'r2' }, { leftId: 'l1', rightId: 'r3' },
  ]);
});
test('tapTarget：空右 id / 非数组 ⇒ 原样返回，不抛', () => {
  const pairs: DragLink[] = [{ leftId: 'l1', rightId: 'r1' }];
  assert.equal(tapTarget(pairs, 'l1', ''), pairs);
  assert.equal(tapTarget(pairs, null, ''), pairs);
  // ⚠️ 入参形状坏掉时（读回的那一侧给的字段不是数组）也**不许抛** ——
  // 抛出去就是整个作答面板白屏。
  assert.equal(tapTarget(undefined as unknown as DragLink[], null, 'r1'), undefined as unknown as DragLink[]);
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

// ── 一次点击（★ 2026-09-28：右往左也能连）────────────────────────────

/** 一个两列的 test double：l* 是左、r* 是右。 */
const sideOf = (id: string) => (id.startsWith('l') ? 'left' as const : id.startsWith('r') ? 'right' as const : null);
const onItem = (id: string) => ({ kind: 'item' as const, id });

test('🔴 tapItem：手里没东西时点任一项 ⇒ 选中它（**从哪一列起手都行**）', () => {
  assert.deepEqual(tapItem([], clearSelection(), 'l1', sideOf), { links: [], selection: onItem('l1') });
  assert.deepEqual(tapItem([], clearSelection(), 'r1', sideOf), { links: [], selection: onItem('r1') }, '右项也能起手');
});

test('🔴 tapItem：**选中右项、点左项 ⇒ 连上**（这就是「右框连到左框」）', () => {
  const out = tapItem([], onItem('r1'), 'l1', sideOf);
  assert.deepEqual(out.links, [{ leftId: 'l1', rightId: 'r1' }], '归一化成 leftId/rightId，不是按起手顺序');
  assert.deepEqual(out.selection, clearSelection(), '连完就松手');
});

test('🔴 tapItem：选中左项、点右项 ⇒ 连上（反方向，同一条规则）', () => {
  assert.deepEqual(tapItem([], onItem('l1'), 'r1', sideOf).links, [{ leftId: 'l1', rightId: 'r1' }]);
});

test('🔴 tapItem：点**同一列**的项 ⇒ 改选，不连线；点中已选那一项 ⇒ 取消', () => {
  assert.deepEqual(tapItem([], onItem('l1'), 'l2', sideOf), { links: [], selection: onItem('l2') });
  assert.deepEqual(tapItem([], onItem('l1'), 'l1', sideOf), { links: [], selection: clearSelection() });
  assert.deepEqual(tapItem([], onItem('r1'), 'r2', sideOf), { links: [], selection: onItem('r2') }, '右列同理');
});

test('🔴 tapItem：已经连过的那一对再点 ⇒ 拆掉那一条', () => {
  const links = [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l1', rightId: 'r2' }];
  assert.deepEqual(tapItem(links, onItem('r1'), 'l1', sideOf).links, [{ leftId: 'l1', rightId: 'r2' }]);
});

test('🔴 tapItem：认不出的 id ⇒ 原样返回（不连线、不动选中）', () => {
  const links = [{ leftId: 'l1', rightId: 'r1' }];
  assert.deepEqual(tapItem(links, onItem('l1'), 'x9', sideOf), { links, selection: onItem('l1') });
});
