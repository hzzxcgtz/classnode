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
  blankCount,
  blankRuns,
  insertBlank,
  isPlainRuns,
  promptRunStyle,
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
  return { start, end, ...DEFAULT_PROMPT_STYLE, blank: false, ...style };
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
  assert.deepEqual(runs[0], { start: 0, end: 9, ...DEFAULT_PROMPT_STYLE, blank: false });
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

// ── 4b. promptRunStyle：渲染端唯一的样式来源 ───────────────────────────

test('promptRunStyle：默认那条写成 color/400/normal，且**不写**下划线与着重号', () => {
  const style = promptRunStyle(DEFAULT_PROMPT_STYLE);
  assert.equal(style.color, '#1e293b');
  assert.equal(style.fontWeight, 400, '400 是**写出来**的，不是省略 —— 省略会把编辑页那个死值放出来');
  assert.equal(style.fontStyle, 'normal');
  assert.equal('textDecoration' in style, false);
  assert.equal('WebkitTextEmphasis' in style, false);
});

test('promptRunStyle：粗 / 斜 / 下划线 / 自定义色', () => {
  assert.equal(promptRunStyle({ ...DEFAULT_PROMPT_STYLE, bold: true }).fontWeight, 700);
  assert.equal(promptRunStyle({ ...DEFAULT_PROMPT_STYLE, italic: true }).fontStyle, 'italic');
  assert.equal(promptRunStyle({ ...DEFAULT_PROMPT_STYLE, underline: true }).textDecoration, 'underline');
  assert.equal(promptRunStyle({ ...DEFAULT_PROMPT_STYLE, color: '#b91c1c' }).color, '#b91c1c');
});

test('🔴 promptRunStyle：着重号**必须**带 `-webkit-` 前缀，且位置是 `under`', () => {
  // 这一条钉的不是「好不好看」，是「**显不显示**」：
  // 老 iPad 的 Safari 15 只认前缀版；而位置若不是 `under`，中文的着重号会挂到字上方
  // 并被行高裁掉。少了任何一条 ⇒ 教师设了着重号，学生端**什么都不显示**、**无一处报错**。
  const style = promptRunStyle({ ...DEFAULT_PROMPT_STYLE, emphasis: true });
  assert.equal(style.WebkitTextEmphasis, "'•'", '前缀版是 Safari 15 唯一认的那一份');
  assert.equal(style.WebkitTextEmphasisPosition, 'under', '位置必须是 under —— over 会被裁掉');
  assert.equal(style.textEmphasis, "'•'", '无前缀那份也写上，将来不必再改一次');
  assert.equal(style.textEmphasisPosition, 'under');
  // ⚠️ 上面那四个断言里，**只有中间那个值**（`'•'`）是取悦眼睛的：
  // CSS 的格式键只有 dot（小）/ circle（大）/ double-circle / triangle / sesame，
  // 中间没有档位，所以这里用的是 `<string>` 形式的一个字符。
  // 教师试过 dot（太小）与 circle（太大）⇒ 2026-09-26 换成 `•`。
  // ⇒ 再调它（`·` / `●` / `◦`）改这两行是**对的**，不要以为自己改坏了用例；
  //   而改**属性名**或 `under` 才是真的改坏了。
  // 🔴 值里那对引号是 `<string>` 语法的一部分 —— 少了它整条声明失效（静默不显示）。
});

// ── 5. isPlainRuns：写库时用它决定这个键要不要留 ───────────────────────

test('isPlainRuns：全是默认样式 ⇒ true（那种情况下不写这个键，库里不留噪音）', () => {
  assert.equal(isPlainRuns(readPromptRuns(undefined, '光合作用')), true);
  assert.equal(isPlainRuns(readPromptRuns([{ start: 0, end: 4, bold: false }], '光合作用')), true);
  assert.equal(isPlainRuns(readPromptRuns([{ start: 0, end: 2, bold: true }], '光合作用')), false);
  assert.equal(isPlainRuns(readPromptRuns([{ start: 0, end: 4, color: '#b91c1c' }], '光合作用')), false);
  assert.equal(isPlainRuns([]), true, '空题干 ⇒ 没有格式可言');
});

// ── 6. 填空区域（★ 2026-09-26，教师：填空在题干文字中间输入）─────────────
//
// 🔴 形状：空 = 一份分段里**带 `blank` 标记的那一条**。
// **不存「第几个空」的编号 —— 顺序即编号**。存编号会多出一种「编号与顺序不一致」
// 的坏数据，而它的表现是**学生填对了却判错**（答案按位置取）。

test('🔴 空**不会**与左右同款的普通文字合并（合并判据必须算上 blank）', () => {
  // 漏了这一条的症状：教师插的那个空**当场消失**，变回一串普通下划线，
  // 而屏幕上看起来「只是空短了一点」—— 直到学生端再也画不出那个框。
  // ⚠️ 跨度必须落在题干长度之内（这里是 10 个字）—— 超出去会被 `clampIndex` 夹掉，
  // 于是「三段」变成「两段」，用例验的就不是它想验的东西了（我第一版就这么写错过）。
  const runs = readPromptRuns([
    { start: 0, end: 4, blank: false },
    { start: 4, end: 8, blank: true },
    { start: 8, end: 10, blank: false },
  ], '光合作用需要哪些条件？');
  assert.equal(runs.length, 3, '三段样式完全相同，但中间那段是空 ⇒ 不许并成一段');
  assert.equal(blankCount(runs), 1);
  assert.deepEqual(blankRuns(runs).map(item => [item.start, item.end]), [[4, 8]], '中间那一段是空');
});

test('🔴 `isPlainRuns`：一个空**不算**「没有格式」', () => {
  // 这一条与上一条是两个不同的入口，都会让空消失：
  // `isPlainRuns` 为真 ⇒ 调用方（编辑器）**不写 `promptRuns` 这个键** ⇒ 空全没了。
  const withBlank = readPromptRuns([{ start: 0, end: 8, blank: true }], '光合作用需要条件');
  assert.equal(isPlainRuns(withBlank), false, '一个空也是「有东西要存」');
  assert.equal(isPlainRuns(readPromptRuns([{ start: 0, end: 8, blank: false }], '光合作用需要条件')), true);
});

test('blankRuns / blankCount：顺序 = 在题干里出现的先后（这就是「第几个空」）', () => {
  const runs = readPromptRuns([
    { start: 0, end: 4, blank: false },
    { start: 4, end: 8, bold: true, blank: true },
    { start: 8, end: 10, blank: false },
    { start: 10, end: 13, blank: true },
  ], '植物光合作用释放的气体是？');
  const blanks = blankRuns(runs);
  assert.equal(blanks.length, 2);
  assert.deepEqual(blanks.map(run => [run.start, run.end]), [[4, 8], [10, 13]], '按题干顺序');
  assert.equal(blankCount(runs), 2);
  assert.equal(blankCount(readPromptRuns(undefined, '植物光合作用')), 0, '没有空 ⇒ 0');
});

test('读脏数据：`blank` 认不出的一律当**不是空**（不是乱猜成空）', () => {
  const runs = readPromptRuns([
    { start: 0, end: 2, blank: 'yes' },
    { start: 2, end: 4, blank: 1 },
    { start: 4, end: 8, blank: true },
  ], '植物光合作用释放');
  assert.equal(blankCount(runs), 1, '只有严格 `=== true` 才算空');
  assert.equal(blankRuns(runs)[0].start, 4);
});

test('🔴 remapRuns 不许把 `blank` 弄丢：在空的前面写字，空还是空（只是挪了位置）', () => {
  const text = '光合作用需要____条件';
  const runs = readPromptRuns([{ start: 6, end: 10, blank: true }], text);
  const next = remapRuns(runs, text, '光合作用需要X____条件');
  assert.equal(blankCount(next), 1, '插字不该把空弄没');
  assert.deepEqual(blankRuns(next).map(run => [run.start, run.end]), [[7, 11]], '空跟着往后挪了一格');
  // 🔴 **已知问题（2026-09-26，尚未解决）：在空的内部打字会把它切成两个空。**
  //
  // 「保住那个空」需要「这几条分段属于同一个空」这个信息，而现在**没有这个信息**：
  // 同样的三条「挨着的、都带 `blank` 的分段」，既可能是「一个空被切成三截」，
  // 也可能是「三个空连着排」（**迁移的输出正好是后者**）。
  // 我一度按前者处理（并回一条），结果把迁移追加的多个空**并成了一个** ——
  // 撤掉了。真正的修法是给空一个标识，见 ledger 里那条 ruling。
  //
  // 在那之前：编辑器**拦住**这条路径（spec 第 4 步：空内部不许落光标、退格整个删掉），
  // 而这里钉住的是「纯函数不猜」——它只按规则挪区间，不试图猜哪几条是同一个空。
  const insideText = '光合作用需要__X__条件';
  const inside = remapRuns(runs, text, insideText);
  assert.equal(blankCount(inside), 2, '⚠️ 切成两个 —— 已知问题，由编辑器拦，不由纯函数猜');
  // 而**紧贴边界**打字是正常路径：不改变空的数量，空本身也不变长。
  const atEdge = remapRuns(runs, text, '光合作用需要____条件X');
  assert.equal(blankCount(atEdge), 1, '紧贴边界打字不改变空的数量');
  assert.equal(blankRuns(atEdge)[0].end, 10, '空本身也没变长');
});

test('🔴 setStyleOnRange 作用在一个空上 ⇒ 它仍是空（加粗一个空不该把它变成普通文字）', () => {
  const text = '光合作用需要____条件';
  const runs = readPromptRuns([{ start: 6, end: 10, blank: true }], text);
  const bold = setStyleOnRange(runs, text, 6, 10, { bold: true });
  assert.equal(blankCount(bold), 1);
  assert.equal(blankRuns(bold)[0].bold, true, '格式与「是空」是两件事，可以同时成立');
});

test('🔴 挨着的空**各算一个**（迁移的输出就是连着追加的多个空）', () => {
  // ⚠️ 这一条**反过来钉住了我一度写错的那条规则**：我曾让「两条挨着的空」并成一条
  //（想防「一个空被切开」），而**迁移正是把 N 个空连着追加到题干末尾**
  //（`'________'.repeat(3)`）⇒ 那条规则把三个空并成了一个，学生只剩一格可填。
  // 现在：挨着 = 各自算一个 ✓
  const text = '植物需要' + '________'.repeat(3);
  const runs = readPromptRuns([
    { start: 4, end: 12, blank: true },
    { start: 12, end: 20, blank: true },
    { start: 20, end: 28, blank: true },
  ], text);
  assert.equal(blankCount(runs), 3, '三个挨着的空就是三个空');
  assert.deepEqual(blankRuns(runs).map(run => [run.start, run.end]), [[4, 12], [12, 20], [20, 28]]);
});

test('⚠️ 只给空的一半设样式 ⇒ 会碎成两个（**已知问题**，与上一条同一个根因）', () => {
  // 这是真实的教师操作（选中空的一半点加粗），而它现在会把这一个空切成两个 ——
  // 因为纯函数**分不清**「一个空被切开」与「两个空挨着」（见 ledger 的那条 ruling）。
  // 修法是给空一个标识；在那之前由编辑器把这条路径拦住（spec 第 4 步）。
  // ⇒ 这条用例钉的是**当前行为**，改设计时它必须跟着变。
  const text = '光合作用需要____条件';
  const runs = readPromptRuns([{ start: 6, end: 10, blank: true }], text);
  const half = setStyleOnRange(runs, text, 6, 8, { bold: true });
  assert.equal(blankCount(half), 2, '⚠️ 已知问题：一半加粗会把它切成两个空');
});

test('insertBlank：在光标处插一个空 —— 文本多出占位、那一段被标记，其余一个字不动', () => {
  const text = '植物光合作用释放的气体是？';
  const runs = readPromptRuns(undefined, text);
  const result = insertBlank(runs, text, text.length, text.length, '________');
  assert.equal(result.text, '植物光合作用释放的气体是？________');
  assert.equal(blankCount(result.runs), 1);
  const [blank] = blankRuns(result.runs);
  assert.equal(result.text.slice(blank.start, blank.end), '________', '空那一段就是那段占位');
  assert.equal(blank.bold || blank.italic || blank.underline || blank.emphasis, false, '空本身不带格式');
  assertShape(result.runs, result.text.length);
});

test('insertBlank：有选区时**替换**选区（与打字同一条规矩）', () => {
  const text = '植物光合作用释放的气体是？';
  const runs = readPromptRuns(undefined, text);
  const result = insertBlank(runs, text, 2, 6, '____');
  assert.equal(result.text, '植物____释放的气体是？');
  assert.equal(blankCount(result.runs), 1);
  assertShape(result.runs, result.text.length);
});

test('insertBlank：连续插两个空 ⇒ 两个空，顺序就是插的先后', () => {
  const text = '植物需要____和____';
  let runs = readPromptRuns(undefined, text);
  let current = text;
  let step = insertBlank(runs, current, 4, 4, '____');
  runs = step.runs; current = step.text;
  step = insertBlank(runs, current, current.length, current.length, '____');
  runs = step.runs; current = step.text;
  assert.equal(blankCount(runs), 2);
  assert.equal(current, '植物需要________和________');
  assertShape(runs, current.length);
});
