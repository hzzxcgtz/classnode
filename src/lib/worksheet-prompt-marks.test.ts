/**
 * 题干行内格式的**逐条断言** —— 区间运算的**唯一回归网**。
 *
 * 跑法（本仓没有前端测试框架，用 Node 24 自带的类型擦除直接执行）：
 *
 * ```bash
 * node --test src/lib/worksheet-prompt-marks.test.ts
 * ```
 *
 * 🔴 为什么判据全在这里：编辑器换成了 contenteditable，而**本仓没有 jsdom、没有浏览器**
 * ⇒ 输入法、光标、DOM 重建在自动化上一片空白。所以「设格式这件事到底改了什么」
 * 全部下沉到 `worksheet-prompt-marks.ts` 的纯函数上，组件只负责把选区接上去。
 *
 * 🔴 形状只有一种：**分段**（`runs`）—— 有序、不重叠、拼满 `[0, text.length)`。
 * 「可选标记列表」那种形状（几条各自带 `bold?: true` 的区间可能叠在一起）会让
 * 「同一个字段两条区间压在一起时听谁的」变成一个没有正确答案的问题。分段形状里
 * 这个问题不存在：任一位置**恰好**属于一条。
 *
 * 带 🔴 的用例是**反向断言**：把对应实现改坏，它们必须变红（变异检验做过，见 ledger）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROMPT_STYLE,
  isPlainRuns,
  rangeColor,
  rangeHasKey,
  readPromptRuns,
  remapRuns,
  setStyleOnRange,
  styleAt,
  type PromptRun,
} from './worksheet-prompt-marks.ts';

/** 一条分段的可读写法：只有 `bold` 的写成 `['0:5','b']`，省得每条都写全五个字段。 */
function run(start: number, end: number, style: Partial<PromptRun> = {}): PromptRun {
  return { start, end, ...DEFAULT_PROMPT_STYLE, ...style };
}

/** 把分段压成一条可读的串，用来一眼看出「切在哪里」：`0-5|5-8b|8-12`。 */
function shape(runs: PromptRun[]): string {
  return runs.map((item) => {
    const flags = [
      item.bold ? 'b' : '',
      item.italic ? 'i' : '',
      item.underline ? 'u' : '',
      item.emphasis ? 'e' : '',
      item.color === DEFAULT_PROMPT_STYLE.color ? '' : 'c',
    ].join('');
    return `${item.start}-${item.end}${flags}`;
  }).join('|');
}

/** 分段必须满足的三条形状不变量（每条用例末尾都查一遍，省得各处重复写）。 */
function assertShape(runs: PromptRun[], length: number) {
  let cursor = 0;
  runs.forEach((item) => {
    assert.equal(item.start, cursor, `分段必须拼满且不重叠（这一条从 ${item.start} 开始，游标在 ${cursor}）`);
    assert.ok(item.end > item.start, '不许有空段');
    cursor = item.end;
  });
  assert.equal(cursor, length, `分段必须正好铺满 0..${length}`);
}

// ── 1. 归一化：读进来的东西一律先变成那一种形状 ─────────────────────────

test('🔴 没有存过格式 ⇒ 一条覆盖全段的默认分段（**不是**空数组）', () => {
  // 「空数组」会让渲染端与每一处区间运算都要处理「没有分段」这一种额外情形 ——
  // 而归一化之后不存在这种情形：任何位置**恰好**属于一条。
  const runs = readPromptRuns(undefined, '光合作用的产物是？');
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], { start: 0, end: 9, ...DEFAULT_PROMPT_STYLE });
  assert.ok(isPlainRuns(runs), '一条默认分段 = 没有格式');
});

test('空题干 ⇒ 空数组（没有位置可以属于任何一条）', () => {
  assert.deepEqual(readPromptRuns(undefined, ''), []);
  assert.deepEqual(readPromptRuns([{ start: 0, end: 3 }], ''), [], '题干空了，存着的分段一并作废');
});

test('🔴 坏数据一律丢掉，空隙补默认 —— 读的一侧不信任库里的东西', () => {
  // 这些值都可能来自一次手改的库 / 一次半途而废的写入。抛出去是整块面板白屏。
  const runs = readPromptRuns([
    { start: 2, end: 4, bold: true },          // 合法
    { start: 1, end: 3, italic: true },        // 与上一条重叠 ⇒ 切开，后一条让位
    { start: -5, end: 2, underline: true },    // 起点越界 ⇒ 夹紧
    { start: 8, end: 99, emphasis: true },     // 终点越界 ⇒ 夹紧
    { start: 5, end: 5, bold: true },          // 空段 ⇒ 丢
    { start: 6, end: 4, bold: true },          // 反序 ⇒ 丢
    { start: '3', end: 4, bold: true },        // 不是数字 ⇒ 夹紧成 0..4 还是丢掉？见下
    'nonsense',                                 // 不是对象 ⇒ 丢
  ], '0123456789');
  assertShape(runs, 10);
  // 🔴 重叠那一条的处置：**后写的那条让位**（不改前面已经确定的那些）。
  // 形状是硬判据，「谁赢」是产品裁定 —— 选「后到者让位」是因为它让
  // `setStyleOnRange` 的输出天然合法（那边总是先切开再写，不会造出重叠）。
  assert.equal(runs[0].start, 0);
  assert.equal(runs[0].end, 2);
  assert.ok(runs[0].underline, '第一条（夹紧后 0..2）保住了自己的样式');
});

test('相邻的同款分段会合并（否则退一次格就多出一条，越用越碎）', () => {
  const runs = readPromptRuns([
    { start: 0, end: 2, bold: true },
    { start: 2, end: 5, bold: true },
    { start: 5, end: 8, bold: false },
  ], '01234567');
  assert.equal(shape(runs), '0-5b|5-8', '前两条同款 ⇒ 并成一条');
});

// ── 2. 查：光标处 / 选区上的样式 ────────────────────────────────────────

test('styleAt：光标处那一条的样式；落在末尾之后 ⇒ 最后一条（接着打字要接着它的样式）', () => {
  const runs = [run(0, 5), run(5, 9, { bold: true })];
  assert.equal(styleAt(runs, 0).bold, false);
  assert.equal(styleAt(runs, 4).bold, false);
  assert.equal(styleAt(runs, 5).bold, true);
  assert.equal(styleAt(runs, 8).bold, true);
  // 光标在**最后一个字符之后**（最常用的位置：写完接着打）⇒ 跟最后一条。
  assert.equal(styleAt(runs, 9).bold, true, '末尾之后跟最后一条，否则「刚加粗完接着打字」会掉格式');
  assert.deepEqual(styleAt([], 0), DEFAULT_PROMPT_STYLE, '空分段 ⇒ 默认');
});

test('🔴 rangeHasKey：必须**整段**都有才算 —— 只覆盖一半是「设上」不是「取消」', () => {
  const runs = [run(0, 5, { bold: true }), run(5, 9)];
  assert.equal(rangeHasKey(runs, 0, 5, 'bold'), true);
  assert.equal(rangeHasKey(runs, 0, 4, 'bold'), true);
  assert.equal(rangeHasKey(runs, 0, 6, 'bold'), false, '跨到没加粗的那一段 ⇒ 不算「整段都有」');
  assert.equal(rangeHasKey(runs, 4, 6, 'bold'), false);
  assert.equal(rangeHasKey(runs, 5, 9, 'bold'), false);
  // 空选区 ⇒ 什么都不算（裁定 ②：没选中就什么都不做，按钮也不该亮）
  assert.equal(rangeHasKey(runs, 3, 3, 'bold'), false);
  assert.equal(rangeHasKey(runs, 5, 3, 'bold'), false, '反序的选区不许当成整段');
});

test('rangeColor：整段同一个色 ⇒ 那个色；不一致或没选 ⇒ null（按钮不亮）', () => {
  const runs = [run(0, 5, { color: '#b91c1c' }), run(5, 9)];
  assert.equal(rangeColor(runs, 0, 5), '#b91c1c');
  assert.equal(rangeColor(runs, 0, 6), null, '跨两种颜色 ⇒ 说不清是哪个');
  assert.equal(rangeColor(runs, 0, 0), null);
});

// ── 3. 写：给一段选区设样式 ─────────────────────────────────────────────

test('🔴 setStyleOnRange：在一整段默认文字中间设 bold ⇒ 切成三条', () => {
  const text = '植物进行光合作用';
  const runs = readPromptRuns(undefined, text);
  const next = setStyleOnRange(runs, text, 2, 4, { bold: true });
  assert.equal(shape(next), '0-2|2-4b|4-8');
  assertShape(next, 8);
});

test('🔴 已经整段加粗了再设一次 bold=true ⇒ 返回**原数组**（身份不变，调用方靠它决定要不要写库）', () => {
  const text = '光合作用';
  const runs = setStyleOnRange(readPromptRuns(undefined, text), text, 0, 4, { bold: true });
  const again = setStyleOnRange(runs, text, 0, 4, { bold: true });
  assert.equal(again, runs, '没变就必须是同一个身份 —— 白写一次是一条无意义的上传');
});

test('设 bold=false 把加粗清掉，清完与左右合并回一条', () => {
  const text = '植物进行光合作用';
  const runs = setStyleOnRange(readPromptRuns(undefined, text), text, 2, 4, { bold: true });
  const cleared = setStyleOnRange(runs, text, 2, 4, { bold: false });
  assert.equal(shape(cleared), '0-8');
  assert.ok(isPlainRuns(cleared), '全清掉 ⇒ 又变回「没有格式」');
});

test('🔴 color 是**覆盖**不是并存：同一段文字上永远只有一个颜色', () => {
  const text = '光合作用';
  const red = setStyleOnRange(readPromptRuns(undefined, text), text, 0, 4, { color: '#b91c1c' });
  const blue = setStyleOnRange(red, text, 0, 4, { color: '#1d4ed8' });
  assert.equal(blue.length, 1);
  assert.equal(blue[0].color, '#1d4ed8');
  assert.equal(shape(blue), '0-4c', '两个颜色并存这条用例必须红');
});

test('一次设多个字段（工具栏点一下同时改粗细和颜色）', () => {
  const text = '光合作用';
  const next = setStyleOnRange(readPromptRuns(undefined, text), text, 1, 3, { bold: true, color: '#15803d' });
  assert.equal(shape(next), '0-1|1-3bc|3-4');
});

test('选区跨多条分段 ⇒ 每一条都按补丁改', () => {
  const text = '0123456789';
  let runs = readPromptRuns(undefined, text);
  runs = setStyleOnRange(runs, text, 2, 4, { bold: true });
  runs = setStyleOnRange(runs, text, 6, 8, { italic: true });
  const next = setStyleOnRange(runs, text, 3, 7, { underline: true });
  // ⚠️ `2-3` 是 **b 不是 bu** —— 选区从 3 开始，`[2,3)` 不在里面。
  // （我第一版期望里把它也写上了下划线，是手算时把选区左边界当成了 2。）
  assert.equal(shape(next), '0-2|2-3b|3-4bu|4-6u|6-7iu|7-8i|8-10');
  assertShape(next, 10);
});

test('🔴 空选区 / 反序 / 越界 ⇒ **原数组**，不抛（裁定 ②：没选中就什么都不做）', () => {
  const text = '光合作用';
  const runs = readPromptRuns(undefined, text);
  assert.equal(setStyleOnRange(runs, text, 2, 2, { bold: true }), runs);
  assert.equal(setStyleOnRange(runs, text, 3, 1, { bold: true }), runs);
  assert.equal(setStyleOnRange(runs, text, -5, 99, { bold: true }).length, 1, '越界夹紧成整段——它仍然是一次合法的设置');
  assert.equal(setStyleOnRange(runs, text, 0, 4, {}), runs, '空补丁 ⇒ 什么都没改');
});

// ── 4. 编辑之后挪区间（最易错的一处）────────────────────────────────────

test('🔴 末尾接着打字 ⇒ 最后一条变长（刚加粗完接着打，格式要跟着）', () => {
  const text = '光合作用';
  const runs = setStyleOnRange(readPromptRuns(undefined, text), text, 2, 4, { bold: true });
  const next = remapRuns(runs, text, '光合作用哦');
  assert.equal(shape(next), '0-2|2-5b');
  assertShape(next, 5);
});

test('🔴 在中间插入 ⇒ 插入的字跟随**前一个字符**的样式', () => {
  const text = 'abcd';
  const runs = setStyleOnRange(readPromptRuns(undefined, text), text, 0, 2, { bold: true });
  // 在 c 前面插入 X（位置 2，正是加粗段的右边界）⇒ 跟随前一个字符（b，加粗）
  const next = remapRuns(runs, text, 'abXcd');
  assert.equal(shape(next), '0-3b|3-5');
  // 在 a 前面插入 Y（位置 0，段首）⇒ 没有「前一个字符」，跟随**第一条**
  const head = remapRuns(runs, text, 'Yabcd');
  assert.equal(shape(head), '0-3b|3-5');
});

test('🔴 删除被加粗覆盖的一段 ⇒ 那一条缩掉；删到空了就整条消失', () => {
  const text = 'abcd';
  const runs = setStyleOnRange(readPromptRuns(undefined, text), text, 1, 3, { bold: true });
  assert.equal(shape(remapRuns(runs, text, 'ad')), '0-2', 'b、c 都删了 ⇒ 没有加粗的字了');
  // 删掉末尾的 d ⇒ 加粗仍在 b、c 上（下标 1..3）。
  // ⚠️ 这一条**我第一版写错过**（写成 `0-2|2-3b`，那等于说加粗跑到了 c 一个人身上），
  // 是照着「公共前缀优先」的归属规则手算一遍才对上的 —— 别凭印象改。
  assert.equal(shape(remapRuns(runs, text, 'abc')), '0-1|1-3b', '删掉 d ⇒ 只剩 b、c 是粗的');
});

test('🔴 删除跨越格式边界的一段 ⇒ 两条都缩，且**不会**被错误地并成一条', () => {
  const text = 'abcd';
  const runs = setStyleOnRange(readPromptRuns(undefined, text), text, 0, 2, { bold: true });
  // 删掉 b 和 c（跨过加粗边界）⇒ 剩 a（粗）d（不粗）
  assert.equal(shape(remapRuns(runs, text, 'ad')), '0-1b|1-2');
});

test('全选替换 ⇒ 新文字用替换点前一个字符的样式', () => {
  const text = 'abcd';
  const runs = setStyleOnRange(readPromptRuns(undefined, text), text, 0, 4, { bold: true });
  const next = remapRuns(runs, text, '新题干');
  assert.equal(shape(next), '0-3b', '整段都被替换 ⇒ 一整条（样式取替换点处的那份）');
});

test('删空 ⇒ 空数组；文本没变 ⇒ 原数组', () => {
  const text = 'abcd';
  const runs = readPromptRuns(undefined, text);
  assert.deepEqual(remapRuns(runs, text, ''), []);
  assert.equal(remapRuns(runs, text, text), runs, '没变就必须是同一个身份');
});

test('🔴 remapRuns 的输出仍必须满足形状三条不变量（每一次编辑之后都要）', () => {
  const text = '植物进行光合作用释放的气体是氧气';
  let runs = readPromptRuns(undefined, text);
  runs = setStyleOnRange(runs, text, 2, 6, { bold: true });
  runs = setStyleOnRange(runs, text, 8, 12, { color: '#b91c1c', underline: true });
  // 一串真实的编辑：末尾追加、撤销回去、中间插字、砍掉后半、从中间删一段、清空。
  // ⚠️ 写成「一串新文本」而不是「一串 (前, 后) 对」—— 后者我第一版就写错了
  //（第 4 步的前一版写回了原始的 `text`，链断在那里），而链一断，这条用例
  // 验的就不再是同一条演化路径了。
  const edits = [
    `${text}？`,
    text,
    text.slice(0, 3) + 'X' + text.slice(5),
    text.slice(0, 10),
    '植物' + text.slice(4),
    '',
  ];
  let current = text;
  for (const nextText of edits) {
    runs = remapRuns(runs, current, nextText);
    current = nextText;
    assertShape(runs, nextText.length);
  }
});

// ── 5. isPlainRuns：写库时用它决定这个键要不要留 ───────────────────────

test('isPlainRuns：全是默认样式 ⇒ true（那种情况下不写这个键，库里不留噪音）', () => {
  assert.equal(isPlainRuns(readPromptRuns(undefined, '光合作用')), true);
  assert.equal(isPlainRuns(readPromptRuns([{ start: 0, end: 4, bold: false }], '光合作用')), true);
  assert.equal(isPlainRuns(readPromptRuns([{ start: 0, end: 2, bold: true }], '光合作用')), false);
  assert.equal(isPlainRuns(readPromptRuns([{ start: 0, end: 4, color: '#b91c1c' }], '光合作用')), false);
  assert.equal(isPlainRuns([]), true, '空题干 ⇒ 没有格式可言');
});
