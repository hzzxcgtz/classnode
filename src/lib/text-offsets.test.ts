/**
 * `locateInLengths` 的逐条断言 —— **「选区为什么自己没了」那个 bug 的回归网**。
 *
 * ★ 2026-09-26（交付当天教师报的）：「选好文字设置格式后，就会自动取消刚才的选择，
 * 这样我就没办法相同文字连续设置格式了。」
 *
 * 🔴 根因是**两个坐标系混在一起**：恢复选区时，起点算的是「落在第几个文本节点里的
 * 第几个字符」，而终点那条路是**从元素开头重新数**的 —— 于是把一个「段内偏移」当成了
 * 「从头数的偏移」去加选区长度。只有「起点正好落在**第一个**文本节点里」时两者才碰巧
 * 相等（那时段内偏移 = 从头数的偏移）。
 *
 * 后果不是「差一点」：终点被算到**起点前面** ⇒ `Range.setEnd` 把整个 Range **折成一个
 * 点** ⇒ 选区消失、工具栏全灭 ⇒ 下一个格式按钮点了没反应。
 * 而这正是「先设一样格式、再设第二样」这条最常用的路径。
 *
 * ⚠️ 纯算术，所以它能在这里被钉住 —— 而它活在 DOM 那一侧（本仓没有 jsdom），
 * 原本**一行都跑不到**。同一条纪律：能算的判据一律下沉到能跑 `node --test` 的地方。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateInLengths, type LocatedOffset } from './text-offsets.ts';

/** 把「第几段、段内偏移」换回**从头数的绝对偏移**（用例读起来才看得出对错）。 */
function absolute(lengths: number[], at: LocatedOffset): number {
  let sum = 0;
  for (let i = 0; i < at.index; i += 1) sum += lengths[i];
  return sum + at.offset;
}

/**
 * 🔴 **各段长度必须互不相同**（这里是 2 / 3 / 5）。
 *
 * ⚠️ 这一条是**被一次漏报逼出来的**：最初用的是 `[2, 2, 4]`，而那个 bug 的形状
 *（把「段内偏移」当成「从头数的偏移」）在**前两段等长**时**恰好算不出区别** ——
 * 变异检验里把 `remaining -= lengths[i]` 改成 `remaining -= lengths[0]`，
 * 用例**照样全绿**。等长的段会把这一整类错误掩盖掉。
 * ⇒ 测试数据也要挑：**互不相同**才分得清「第几段」。
 */
const SHAPE = [2, 3, 5];   // 例如「植物」「进行光合」「作用释放的气体」—— 长度两两不同

test('把绝对偏移映射到「第几段、段内偏移」', () => {
  const lengths = SHAPE;
  assert.deepEqual(locateInLengths(lengths, 0), { index: 0, offset: 0 });
  assert.deepEqual(locateInLengths(lengths, 2), { index: 0, offset: 2 }, '正好落在第一段的末尾');
  assert.deepEqual(locateInLengths(lengths, 3), { index: 1, offset: 1 });
  assert.deepEqual(locateInLengths(lengths, 4), { index: 1, offset: 2 });
  assert.deepEqual(locateInLengths(lengths, 5), { index: 1, offset: 3 }, '正好落在第二段的末尾');
  assert.deepEqual(locateInLengths(lengths, 6), { index: 2, offset: 1 });
  assert.deepEqual(locateInLengths(lengths, 10), { index: 2, offset: 5 }, '末尾之后正好是终点');
});

test('🔴 回归：起点不在第一段时，**终点不许跑到起点前面**', () => {
  // 这一条就是那个 bug。旧写法（终点 = **起点的段内偏移** + 选区长度，而终点那条路
  // 是从头数的）在 `SHAPE` 这种「起点落在第二段」的选区上会把终点算到起点**前面** ⇒
  // `setEnd` 把 Range 折成一个点 ⇒ 选区消失、工具栏全灭。
  // ⚠️ 这里断言的是**往返一致 + 不许反序**，而不是某几个具体坐标 —— 前者才是那个 bug
  // 的判据（具体坐标在上面那条用例里单独钉）。
  const lengths = SHAPE;
  const cases: [number, number][] = [[5, 6], [5, 10], [3, 6], [2, 8], [1, 9], [0, 10], [6, 6], [4, 7]];
  cases.forEach(([from, to]) => {
    const start = locateInLengths(lengths, from)!;
    const end = locateInLengths(lengths, to)!;
    assert.equal(absolute(lengths, start), from, `起点必须落回 ${from}`);
    assert.equal(absolute(lengths, end), to, `终点必须落回 ${to}`);
    assert.ok(absolute(lengths, end) >= absolute(lengths, start), `终点跑到起点前面了（${from}..${to}）`);
  });
});

test('一个字符都没有 / 越界 / 坏值：夹紧，不抛', () => {
  // 空题干 ⇒ 没有位置可言（调用方会把光标落在框里）。
  assert.equal(locateInLengths([], 0), null);
  const lengths = [2, 3];
  assert.deepEqual(locateInLengths(lengths, 99), { index: 1, offset: 3 }, '超过末尾 ⇒ 夹到末尾');
  assert.deepEqual(locateInLengths(lengths, -5), { index: 0, offset: 0 }, '负数 ⇒ 夹到开头');
  assert.deepEqual(locateInLengths(lengths, 1.9), { index: 0, offset: 1 }, '小数 ⇒ 向下取整');
  assert.deepEqual(locateInLengths(lengths, Number.NaN), { index: 0, offset: 0 }, 'NaN ⇒ 夹到开头');
});
