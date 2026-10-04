import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROMPT_STYLE } from './worksheet-prompt-marks.ts';
import type { WorksheetQuestionNode } from './types.ts';
import { answerView, matchLineGeometry } from './worksheet-answer-view.ts';

/**
 * 教师抽屉里「逐题型的作答呈现」（★ 2026-09-28，教师：「看到的答题信息过于简单……
 * 比如连线题就应该左右框加上中间的线」）。
 *
 * 🔴 这一层是**判据层**：`answer-view.tsx` 只负责画。本仓没有前端测试框架，
 * 画进 JSX 的判据没有任何回归网 —— 而这一层里每一条错了都**不报错**，
 * 只会让教师看到一个**错的结论**：
 *   · 把「漏连的那一对」算错 ⇒ 他去讲一条学生其实连对了的线；
 *   · 把顺序读成「学生看到的初始顺序」⇒ 每个学生看起来都排得一样；
 *   · 把「填了一串空串」当成有内容 ⇒ 抽屉里显示一排空格子（像「他填了空格」）。
 */

function node(type: string, data: Record<string, unknown> = {}, over: Partial<WorksheetQuestionNode> = {}): WorksheetQuestionNode {
  return { id: `q_${type}`, type, prompt: '题干', inputMode: 'keyboard', data, children: [], ...over };
}

/**
 * 一道**有 N 个空**的填空题。
 *
 * 🔴 空的个数**只能从 `data.promptRuns` 推**（`blankLayout`），**不解析题干文本** ——
 * 实测：题干写成 `'{填空域} 和 {填空域}'` 而不给 `promptRuns` 时，`blankLayout` 给出
 * `textCount: 0` ⇒ `readBlankCount` 退到「单空」那一档。第一版夹具就是这么写的，
 * 于是用例红在「只读出 1 个空」上，而**代码是对的**（抽屉要反映题目当下的样子）。
 */
function fillNode(answers: unknown, blanks: number, extra: Record<string, unknown> = {}): WorksheetQuestionNode {
  const mark = '{填空域}';
  const prompt = mark.repeat(blanks);
  const promptRuns = Array.from({ length: blanks }, (_, index) => ({
    start: index * mark.length,
    end: (index + 1) * mark.length,
    ...DEFAULT_PROMPT_STYLE,
    blank: `t${index + 1}`,
  }));
  return node('fill-blank', { promptRuns, answers, ...extra }, { prompt });
}

/* ── 未作答 ─────────────────────────────────────────────────────────── */

test('🔴 未作答 ⇒ none（`isDraftEmpty` 判，与提交那一侧同一个函数）', () => {
  assert.deepEqual(answerView(node('short-answer'), null), { kind: 'none' });
  assert.deepEqual(answerView(node('short-answer'), { format: 'text/v1', text: '' }), { kind: 'none' });
  // ⚠️ 填空题「填了一串空串」**也算空**：自己写一个 `text === ''` 会让它画成一排空格子，
  //    那看起来像「他填了空格」，而不是「他没做」。
  assert.deepEqual(
    answerView(node('fill-blank', { answers: [['H2O']] }), { format: 'fill/v1', text: '', texts: ['', ''] }),
    { kind: 'none' },
  );
});

/**
 * 🔴 **读不出的值 ⇒ none，不猜。** 猜一个「大概是填空」会画出一排空格子 ——
 * 而那与「他没做」长得一模一样。这条是 `draftFromValue` 的兜底支，
 * 值可能是手改过的行 / 上一个版本留下的。
 */
test('🔴 读不出来的值 ⇒ none（不猜一个题型出来）', () => {
  assert.deepEqual(answerView(node('fill-blank', { answers: [['H2O']] }), { format: '未来格式/v9', x: 1 }), { kind: 'none' });
  assert.deepEqual(answerView(node('order'), 42), { kind: 'none' });
});

/* ── 单选 / 判断 ────────────────────────────────────────────────────── */

test('★ 单选：整张选项表都在，标出「学生勾了」与「它是正确答案」两件事', () => {
  const view = answerView(
    node('single-choice', {
      options: [{ key: 'A', text: '水' }, { key: 'B', text: '阳光' }, { key: 'C', text: '石头' }],
      correctKeys: ['B'],
    }),
    { format: 'choice/v1', selected: ['A'] },
  );
  assert.equal(view.kind, 'choice');
  assert.deepEqual(view.kind === 'choice' ? view.options : null, [
    // ⚠️ 顺序取**选项表**的，不是学生点选的顺序 —— 后者逐人不同，
    //    教师横着比一串学生时会以为「每个人选的东西都不一样」。
    { key: 'A', text: '水', picked: true, correct: false },
    { key: 'B', text: '阳光', picked: false, correct: true },
    { key: 'C', text: '石头', picked: false, correct: false },
  ], '学生选了 A（错），正确答案是 B');
});

/**
 * 🔴 **判断题不存 `options`**（规格 §12：`data` 里只有 `correctKeys`）。
 * 读 `data.options` 会回空表 ⇒ 一道判断题**一个选项都画不出来**，
 * 而屏幕上看起来只是「这道题没有选项」——服务端判分与教师预览都走 `TRUE_FALSE_OPTIONS`。
 */
test('★ 判断题：选项来自 `TRUE_FALSE_OPTIONS` 常量（`data` 里根本没有 options）', () => {
  const view = answerView(node('true-false', { correctKeys: ['T'] }), { format: 'choice/v1', selected: ['F'] });
  assert.equal(view.kind, 'choice');
  const options = view.kind === 'choice' ? view.options : [];
  assert.equal(options.length, 2, '对 / 错两个选项都要在');
  assert.deepEqual(options.map((option) => option.picked), [false, true], '学生选了「错」');
  assert.equal(options[0].correct, true, '正确答案是「对」');
});

/* ── 填空 ───────────────────────────────────────────────────────────── */

test('★ 填空：每空的「学生写的字」与「可接受答案」逐空对齐', () => {
  // ⚠️ 夹具的题干里**必须真有两个空标记** —— 空的个数由**题干**推（`readBlankCount`），
  //    而 `draftFromValue` 会把 `texts` 补齐/截断到那个数。第一版夹具写的是 `'题干'`
  //    （一个标记都没有）⇒ 只读出 1 个空，而那是**对的**：抽屉要反映题目**当下**的样子。
  const view = answerView(
    fillNode([['H2O'], ['O2', '氧气']], 2),
    { format: 'fill-multi/v1', texts: ['H2O', '二氧化碳'] },
  );
  assert.equal(view.kind, 'fill');
  assert.deepEqual(view.kind === 'fill' ? view.blanks : null, [
    { label: '第 1 空', text: 'H2O', accepted: ['H2O'] },
    { label: '第 2 空', text: '二氧化碳', accepted: ['O2', '氧气'] },
  ]);
  assert.equal(view.kind === 'fill' ? view.hasTable : null, false);
});

/**
 * 🔴 **单空的老值 `answers: string[]` 也要认。** 它真实存在（`answers` 一开始就是
 * `string[]`），只认 `string[][]` 的话，单空题的「正确答案」那一栏会**整栏消失** ——
 * 而屏幕上看起来只是「老师没填标准答案」。
 */
test('🔴 填空：`answers` 是老的 `string[]` 形状时也读得出来', () => {
  const view = answerView(fillNode(['H2O'], 1), { format: 'fill/v1', text: 'H2O' });
  assert.deepEqual(
    view.kind === 'fill' ? view.blanks : null,
    [{ label: '第 1 空', text: 'H2O', accepted: ['H2O'] }],
  );
});

test('★ 填空：教师没填标准答案 ⇒ `accepted` 是空数组（界面据此**不画**那一栏）', () => {
  const view = answerView(fillNode([], 1), { format: 'fill/v1', text: '随便写的' });
  assert.deepEqual(view.kind === 'fill' ? view.blanks[0].accepted : null, []);
});

test('★ 填空：带表格的题 `hasTable` 为真（界面据此画表格，而不是一排输入框）', () => {
  const view = answerView(
    fillNode([['1']], 1, { table: { rows: [[{ text: 'x' }]] } }),
    { format: 'fill-multi/v1', texts: ['1'] },
  );
  assert.equal(view.kind === 'fill' ? view.hasTable : null, true);
});

/* ── 排序 ───────────────────────────────────────────────────────────── */

/**
 * 🔴 **学生那一栏必须读原始值里的顺序**（`draft.order`），不是题目里的 `items` ——
 * 后者是「学生看到的初始顺序」，人人相同 ⇒ 每个学生看起来都排得一样，
 * 而教师会以为自己看的是他的作答。与 `formatAnswer` 的排序那一支同一条纪律。
 */
test('🔴 排序：学生那一栏读的是**他的**顺序，不是题目里的初始顺序', () => {
  const view = answerView(
    node('order', {
      items: [{ id: 'i1', text: '甲' }, { id: 'i2', text: '乙' }, { id: 'i3', text: '丙' }],
      correctOrder: ['i3', 'i1', 'i2'],
    }),
    { format: 'order/v1', order: ['i2', 'i3', 'i1'] },
  );
  assert.equal(view.kind, 'order');
  assert.deepEqual(view.kind === 'order' ? view.student : null, ['乙', '丙', '甲'], '按学生排的顺序');
  assert.deepEqual(view.kind === 'order' ? view.correct : null, ['丙', '甲', '乙'], '正确答案另列一栏');
});

/**
 * ★ 条目**没写文字**（教师加了一条还没来得及填）⇒ 显示它的 id，不显示空白。
 * 空白会让教师以为「学生交了一条空的」，而事实是那条根本没内容可显示
 *（与 `formatAnswer` 的「选项对不上时退回 key 本身」同一条纪律）。
 *
 * ⚠️ 这里**不测**「值里有一个题目已经没有的 id」：`draftFromValue` 会把 `order` 与题目
 *    对齐（题里有的补进来、认不出的丢掉），所以那种 id 根本到不了这一层 ——
 *    要紧的是「他到底排过没有」，而那是 `formatAnswer` 读**原始值**在管的事。
 */
test('★ 排序：条目的文字是空的 ⇒ 退回 id 本身（不显示空白）', () => {
  const view = answerView(
    node('order', { items: [{ id: 'i1', text: '甲' }, { id: 'i2', text: '' }], correctOrder: ['i1', 'i2'] }),
    { format: 'order/v1', order: ['i1', 'i2'] },
  );
  assert.deepEqual(view.kind === 'order' ? view.student : null, ['甲', 'i2']);
});

/* ── 连线 ───────────────────────────────────────────────────────────── */

/**
 * 教师这一轮的原话就是连线题：「应该左右框加上中间的线」。所以这一条钉的是
 * 「学生到底连了哪几对、哪一对是错的、哪几对漏了」这三件事。
 */
test('★ 连线：学生连的线 + 每对的对错 + 漏连的那几对', () => {
  const view = answerView(
    node('match', {
      left: [{ id: 'l1', text: '水' }, { id: 'l2', text: '二氧化碳' }],
      right: [{ id: 'r1', text: 'H2O' }, { id: 'r2', text: 'CO2' }],
      pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }],
    }),
    { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r2' }] },
  );
  assert.equal(view.kind, 'match');
  assert.deepEqual(view.kind === 'match' ? view.left.map((entry) => entry.text) : null, ['水', '二氧化碳']);
  assert.deepEqual(view.kind === 'match' ? view.right.map((entry) => entry.text) : null, ['H2O', 'CO2']);
  assert.deepEqual(view.kind === 'match' ? view.links : null, [
    // 学生把「水」连到了「CO2」—— 那不在 pairs 里 ⇒ ok 为假。
    { leftId: 'l1', rightId: 'r2', ok: false },
  ]);
  assert.deepEqual(
    view.kind === 'match' ? view.missed : null,
    [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }],
    '🔴 正确答案里学生一对都没连上 ⇒ 两对都进 missed（纯集合差）',
  );
});

test('★ 连线：连对的那些 `ok` 为真（阳性对照）', () => {
  const view = answerView(
    node('match', {
      left: [{ id: 'l1', text: '水' }],
      right: [{ id: 'r1', text: 'H2O' }],
      pairs: [{ leftId: 'l1', rightId: 'r1' }],
    }),
    { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }] },
  );
  assert.deepEqual(view.kind === 'match' ? view.links : null, [{ leftId: 'l1', rightId: 'r1', ok: true }]);
  assert.deepEqual(view.kind === 'match' ? view.missed : null, [], '连全了 ⇒ 没有漏连');
});

/* ── 归类 ───────────────────────────────────────────────────────────── */

test('★ 归类：按框分组，每条标出「放对了没有」，没归的进 loose', () => {
  const view = answerView(
    node('categorize', {
      items: [{ id: 'i1', text: '猫' }, { id: 'i2', text: '麻雀' }, { id: 'i3', text: '狗' }],
      zones: [{ id: 'z1', label: '哺乳类' }, { id: 'z2', label: '鸟类' }],
      placement: { i1: 'z1', i2: 'z2', i3: 'z1' },
    }),
    { format: 'categorize/v1', assignment: { i1: 'z1', i2: 'z1' } },
  );
  assert.equal(view.kind, 'categorize');
  assert.deepEqual(view.kind === 'categorize' ? view.zones : null, [
    { id: 'z1', label: '哺乳类', items: [{ text: '猫', ok: true }, { text: '麻雀', ok: false }] },
    { id: 'z2', label: '鸟类', items: [] },
  ], '学生把「麻雀」放进了哺乳类（错）');
  assert.deepEqual(view.kind === 'categorize' ? view.loose : null, ['狗'], '「狗」他一条都没归');
});

test('★ 归类：放进了**不存在的框**的条目也进 loose（教师改题删了那个框）', () => {
  const view = answerView(
    node('categorize', {
      items: [{ id: 'i1', text: '猫' }, { id: 'i2', text: '狗' }],
      zones: [{ id: 'z1', label: '哺乳类' }],
      placement: { i1: 'z1', i2: 'z1' },
    }),
    { format: 'categorize/v1', assignment: { i1: 'z1', i2: 'gone' } },
  );
  assert.deepEqual(view.kind === 'categorize' ? view.loose : null, ['狗']);
});

/* ── 问答 / 绘图 ────────────────────────────────────────────────────── */

test('★ 问答：原文照给（不 trim 掉学生写的换行与空格）', () => {
  const view = answerView(node('short-answer'), { format: 'text/v1', text: '  第一行\n第二行  ' });
  assert.deepEqual(view, { kind: 'text', text: '  第一行\n第二行  ' });
});

test('★ 绘图：走 ink 那一支，值原样交给界面画（判据只认 format，不看题型）', () => {
  // ⚠️ `points` 是 **[x, y] 元组**（归一化 0..1），不是 `{x, y}` 对象 ——
  //    第一版夹具写成了对象 ⇒ `readPoint` 整笔丢掉 ⇒ `strokes: []` ⇒ 被当成「没画过」。
  //    那也是对的：一笔都没有 = 空，与选择/连线/归类同一条口径。
  const ink = { format: 'ink/v1', canvas: { w: 100, h: 50 }, strokes: [{ color: '#000', width: 2, points: [[0.1, 0.2]] }] };
  const view = answerView(node('drawing'), ink);
  assert.equal(view.kind, 'ink', '🔴 按 format 判，不按 node.type —— 教师把题改成键盘之后那幅画仍要画得出来');
});

test('★ 照片作答：教师端拿到可直接显示的本机图片地址', () => {
  const url = '/uploads/chat/chat-123e4567-e89b-42d3-a456-426614174000.webp';
  assert.deepEqual(
    answerView(node('short-answer', {}, { inputMode: 'photo' }), { format: 'photo/v1', url }),
    { kind: 'photo', url },
  );
});

/* ── 连线的几何（★ 教师：「左框和右框中的顺序不能变，要按照原题中的顺序」）── */

/**
 * 🔴 **两栏各自按原题顺序排，纵坐标一律取下标的** —— 这是教师那一条要求的落点。
 * 上一版把每一对画成一行（零测量），代价是右栏的顺序被连线打乱了。
 *
 * 这条用例同时钉住「行高固定 ⇒ 位置可从下标算」这件事：它是**不测量 DOM** 的全部依据。
 */
test('🔴 连线几何：两栏各按原题顺序，纵坐标由下标算（不测量 DOM）', () => {
  const left = [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }];
  const right = [{ id: 'r1' }, { id: 'r2' }];
  const { lines, height } = matchLineGeometry(
    left, right,
    [
      // ⚠️ 故意让「第 1 个左框」连到「第 2 个右框」—— 这条线是**斜的**，
      //    而斜线正是「按原题顺序排两栏」必然会产生的东西。
      { leftId: 'l1', rightId: 'r2', ok: false },
      { leftId: 'l3', rightId: 'r1', ok: true },
    ],
    { rowHeight: 30, gap: 6, gutter: 46 },
  );
  // 行距 36：第 0 行中心 15、第 1 行中心 51、第 2 行中心 87。
  assert.deepEqual(lines, [
    { x1: 0, y1: 15, x2: 46, y2: 51, ok: false },
    { x1: 0, y1: 87, x2: 46, y2: 15, ok: true },
  ]);
  assert.equal(height, 3 * 36 - 6, '高度由**较长的那一栏**决定（左栏 3 条）');
});

test('连线几何：某一端不在栏里（教师改题删了那个条目）⇒ 那一条不画', () => {
  const { lines } = matchLineGeometry(
    [{ id: 'l1' }], [{ id: 'r1' }],
    [{ leftId: 'l1', rightId: 'gone', ok: true }],
    { rowHeight: 30, gap: 6, gutter: 46 },
  );
  assert.deepEqual(lines, [], '画一条指向空处的线会让教师找一个屏幕上不存在的东西');
});
