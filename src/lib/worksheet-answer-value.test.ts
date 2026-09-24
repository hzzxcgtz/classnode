/**
 * `worksheet-answer-value.ts` 的逐条断言 —— **8 个题型的作答值与输入态**的唯一回归网。
 *
 * 跑法（本仓没有前端测试框架，用 Node 24 自带的类型擦除直接执行）：
 *
 * ```bash
 * node --test src/lib/worksheet-answer-value.test.ts
 * ```
 *
 * ⚠️ 为什么值得单独成文件：这一段**错了不报错**。
 *   · `buildAnswerValue` 的字段名写错（`links` 写成 `pairs`）⇒ 服务端判分器读不到那个键
 *     ⇒ 那道题**永远判错**，而界面上一切正常、没有任何异常与日志；
 *   · `emptyDraftFor` 少给一个空的填空 ⇒ 学生**填不了**那个空（那一格不在屏幕上）；
 *   · `draftFromValue` 读不回 ⇒ 刷新之后作答**画成空白**（与「学生没写过」无法区分）。
 *
 * 判据全部下沉在这里的理由写在文件头上：JSX 那一半（7 个作答区组件）在本仓
 * **没有任何回归网**（没有 jsdom、没有 testing-library），所以能从组件里挪出来的
 * 判断一律挪到这里。带 🔴 的用例是**反向断言**：把对应实现改坏，它们必须变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnswerValue,
  draftFromValue,
  emptyDraftFor,
  isDraftEmpty,
  isMultiBlank,
  readBlankCount,
  readCategorizeItems,
  readCategorizeZones,
  readEntries,
  readMatchLeft,
  readMatchRight,
  readOrderItems,
  type AnswerDraft,
} from './worksheet-answer-value.ts';
import type { InkCanvas, InkStroke } from './worksheet-ink.ts';
import type { WorksheetQuestionNode } from './types.ts';

// ── 脚手架 ──────────────────────────────────────────────────────────────

function node(type: string, data: Record<string, unknown> = {}): WorksheetQuestionNode {
  return { id: `q_${type}`, type, prompt: '题干', inputMode: 'keyboard', data, children: [] };
}

/**
 * 作答方式 = 手写的节点（★ M4b）—— `worksheet-ink.ts` 的 `isInkNode` 认的就是它。
 * ⚠️ 与 `node()` 只差 `inputMode` 一个字段：本文件里好几条用例的**全部区别**就在这一个字段上
 *（「键盘问答是 text 起点、手写问答是 ink 起点」），所以它们必须能被并排放在一起看。
 */
function handwritingNode(type: string, data: Record<string, unknown> = {}): WorksheetQuestionNode {
  return { ...node(type, data), inputMode: 'handwriting' };
}

/** 绘图题（★ M4b 新题型）。它的 `inputMode` 是什么都不影响结论 —— 判据看 `node.type`。 */
const drawingNode = () => node('drawing', {});

/** 一笔：两个点 + 本批唯一那个常量色 / 常量粗细（裁定 2）。 */
const STROKE: InkStroke = { color: '#1f2937', width: 0.016, points: [[0.1, 0.2], [0.3, 0.4]] };

/**
 * 学生作答那一刻**量出来**的框。⚠️ 它**刻意不等于**任何一道题的默认框
 *（绘图题 320×240 / 手写问答 320×160）—— 相等的话「用 `draft.box`」与
 * 「用 `defaultInkBox(node)`」两种写法在那条用例上**同结果**，那条用例就成了假保证。
 */
const DRAWN_BOX: InkCanvas = { w: 300, h: 200 };

const ITEMS = [
  { id: 'i1', text: '甲' },
  { id: 'i2', text: '乙' },
  { id: 'i3', text: '丙' },
];
const LEFT = [{ id: 'l1', text: '左一' }, { id: 'l2', text: '左二' }];
const RIGHT = [{ id: 'r1', text: '右一' }, { id: 'r2', text: '右二' }];
const ZONES = [{ id: 'z1', label: '框一' }, { id: 'z2', label: '框二' }];

const orderNode = () => node('order', { items: ITEMS, correctOrder: ['i2', 'i1', 'i3'] });
const matchNode = () => node('match', { left: LEFT, right: RIGHT, pairs: [{ leftId: 'l1', rightId: 'r2' }] });
const categorizeNode = () => node('categorize', { items: ITEMS, zones: ZONES, placement: { i1: 'z2' } });
const fillNode = () => node('fill-blank', { answers: ['光合作用'] });
const fillMultiNode = () => node('fill-blank', { blanks: [{ answers: ['H2O'] }, { answers: ['CO2'] }] });
const fillThreeNode = () => node('fill-blank', {
  blanks: [{ answers: ['甲'] }, { answers: ['乙'] }, { answers: ['丙'] }],
});

// ── 1. 读条目：三处键名（`text` / `label`）必须与服务端一致 ───────────────

test('🔴 读条目：`items`/`left`/`right` 读 `text`，`zones` 读 `label`', () => {
  // 服务端与编辑器内核读的是同一对键名（`readItemIds` / `EntryTextField`）。
  // 这里读错一个键名 ⇒ 学生端画出一列没有文字的条目，而教师端预览里一切正常 ——
  // 「预览里长这样、学生那里不是」，没有任何报错。
  assert.deepEqual(readOrderItems(orderNode()), ITEMS);
  assert.deepEqual(readMatchLeft(matchNode()), LEFT);
  assert.deepEqual(readMatchRight(matchNode()), RIGHT);
  assert.deepEqual(readCategorizeItems(categorizeNode()), ITEMS);
  // ⚠️ `zones` 的文本键名是 `label`，但**读出来一律归一成 `text`**（界面只有一个形状）——
  // 所以下面这条断言同时钉住了「读了 `label`」与「归一化成了 `text`」。
  assert.deepEqual(readCategorizeZones(categorizeNode()), [
    { id: 'z1', text: '框一' },
    { id: 'z2', text: '框二' },
  ]);
  // 反证：`zones` 用 `text` 读 ⇒ 全是空串（服务端与编辑器都写 `label`）。
  assert.deepEqual(
    readEntries(ZONES, 'text'),
    [{ id: 'z1', text: '' }, { id: 'z2', text: '' }],
  );
});

test('读条目：坏形状一律丢掉，不抛（渲染路径上一次 TypeError 就是白屏）', () => {
  assert.deepEqual(readEntries(null, 'text'), []);
  assert.deepEqual(readEntries('不是数组', 'text'), []);
  assert.deepEqual(readEntries([null, 42, { text: '没 id' }, { id: '', text: '空 id' }], 'text'), []);
  // 好条目必须留下（同一条数组里的坏元素不该把好的一起作废）。
  assert.deepEqual(readEntries([{ id: 'a', text: '甲' }, { id: 'b' }], 'text'), [
    { id: 'a', text: '甲' },
    { id: 'b', text: '' },
  ]);
});

test('填空题的单空 / 多空判据与空数：判据必须是 `Array.isArray(data.blanks)`', () => {
  // 🔴 与服务端 `judgeFillBlank` / `VALIDATORS` **逐字一致**：两处用不同的判据会让一道题
  // 「校验时按多空、判分时按单空」，而它只表现为分数不对。
  assert.equal(isMultiBlank(fillNode()), false);
  assert.equal(readBlankCount(fillNode()), 1);
  assert.equal(isMultiBlank(fillMultiNode()), true);
  assert.equal(readBlankCount(fillMultiNode()), 2);
  // 教师建了题但一个空都没填 ⇒ 0 个（与服务端「空数组判错」对齐），**不四舍五入成 1**。
  assert.equal(readBlankCount(node('fill-blank', { blanks: [] })), 0);
  // 坏形状（`blanks` 不是数组）落回单空那一支。
  assert.equal(readBlankCount(node('fill-blank', { blanks: '两个' })), 1);
});

// ── 2. emptyDraftFor：每个题型的起点 ────────────────────────────────────

test('emptyDraftFor：8 个题型各给一个能直接渲染的起点', () => {
  assert.deepEqual(emptyDraftFor(node('single-choice', { options: [{ key: 'A', text: '甲' }] })),
    { kind: 'choice', selected: [] });
  assert.deepEqual(emptyDraftFor(node('true-false')), { kind: 'choice', selected: [] });
  assert.deepEqual(emptyDraftFor(node('multi-choice', { options: [{ key: 'A', text: '甲' }] })),
    { kind: 'choice', selected: [] });
  assert.deepEqual(emptyDraftFor(fillNode()), { kind: 'fill', texts: [''] });
  assert.deepEqual(emptyDraftFor(fillMultiNode()), { kind: 'fill', texts: ['', ''] });
  assert.deepEqual(emptyDraftFor(node('short-answer')), { kind: 'text', text: '' });
  assert.deepEqual(emptyDraftFor(matchNode()), { kind: 'match', links: [] });
  assert.deepEqual(emptyDraftFor(categorizeNode()), { kind: 'categorize', assignment: {} });
});

test('🔴 emptyDraftFor：排序题的起点是 `data.items` 的**存储顺序**（不是空的、不是正确顺序）', () => {
  // 两条一起看才成立：起点必须是学生看到的那一列（否则屏幕上少条目），
  // 而「什么都不做就满分」由服务端的 `validateQuestion` 挡（它拒绝两者相同）。
  // 这里若给了 `correctOrder`，学生端一进页面就是满分顺序 —— 一次静默的送分。
  assert.deepEqual(emptyDraftFor(orderNode()), { kind: 'order', order: ['i1', 'i2', 'i3'] });
});

test('🔴 emptyDraftFor：未知题型**必须**给一个能安全渲染的默认值，不能 undefined', () => {
  // `worksheet-panel.tsx` 今天写死 `?? { selected: '', text: '' }`，那个回落点换成本函数时
  // 不许漏 —— 漏了的表现是库里一行手改过的题型让整个面板**白屏**，
  // 而白屏的学生会以为「老师没布置」。
  const draft = emptyDraftFor(node('ink'));
  assert.ok(draft && typeof draft === 'object' && typeof draft.kind === 'string');
  assert.deepEqual(draft, { kind: 'text', text: '' });
});

// ── 3. isDraftEmpty：空白字符不算内容 ───────────────────────────────────

test('isDraftEmpty：逐题型判「这一份输入态里有东西吗」', () => {
  assert.equal(isDraftEmpty({ kind: 'choice', selected: [] }), true);
  assert.equal(isDraftEmpty({ kind: 'choice', selected: ['B'] }), false);
  assert.equal(isDraftEmpty({ kind: 'text', text: '   ' }), true, '全是空白等于没写');
  assert.equal(isDraftEmpty({ kind: 'text', text: ' 叶片 ' }), false);
  assert.equal(isDraftEmpty({ kind: 'fill', texts: ['', '  '] }), true);
  assert.equal(isDraftEmpty({ kind: 'fill', texts: ['', 'H2O'] }), false, '只填了一半也是「有内容」——服务端会判半对');
  assert.equal(isDraftEmpty({ kind: 'match', links: [] }), true);
  assert.equal(isDraftEmpty({ kind: 'match', links: [{ leftId: 'l1', rightId: 'r1' }] }), false);
  assert.equal(isDraftEmpty({ kind: 'categorize', assignment: {} }), true);
  assert.equal(isDraftEmpty({ kind: 'categorize', assignment: { i1: 'z1' } }), false);
  // 排序：只有「一个条目都没有」（一道坏题）才算空 —— 起点本身是一份合法作答。
  assert.equal(isDraftEmpty({ kind: 'order', order: [] }), true);
  assert.equal(isDraftEmpty({ kind: 'order', order: ['i1'] }), false);
});

// ── 4. buildAnswerValue：字段名就是协议 ─────────────────────────────────

test('🔴 buildAnswerValue：每个题型的**字段名**（协议），一个都不许改', () => {
  // 服务端判分器按这些键名取值（`judge*`），改错了不报错 —— 那道题永远判错。
  assert.deepEqual(
    buildAnswerValue(node('single-choice', { options: [] }), { kind: 'choice', selected: ['B'] }),
    { format: 'choice/v1', selected: ['B'] },
  );
  // 判断题与单选共用同一个形状（规格 §12）。
  assert.deepEqual(
    buildAnswerValue(node('true-false'), { kind: 'choice', selected: ['T'] }),
    { format: 'choice/v1', selected: ['T'] },
  );
  assert.deepEqual(
    buildAnswerValue(node('multi-choice', { options: [] }), { kind: 'choice', selected: ['A', 'C'] }),
    { format: 'choice/v1', selected: ['A', 'C'] },
  );
  // 单空仍是 `fill/v1` + `text`（服务端的单空分支读的就是 `text`，形状不许动）。
  assert.deepEqual(
    buildAnswerValue(fillNode(), { kind: 'fill', texts: ['光合作用'] }),
    { format: 'fill/v1', text: '光合作用' },
  );
  assert.deepEqual(
    buildAnswerValue(fillMultiNode(), { kind: 'fill', texts: ['H2O', 'CO2'] }),
    { format: 'fill-multi/v1', texts: ['H2O', 'CO2'] },
  );
  assert.deepEqual(
    buildAnswerValue(node('short-answer'), { kind: 'text', text: '因为…' }),
    { format: 'text/v1', text: '因为…' },
  );
  assert.deepEqual(
    buildAnswerValue(orderNode(), { kind: 'order', order: ['i2', 'i1', 'i3'] }),
    { format: 'order/v1', order: ['i2', 'i1', 'i3'] },
  );
  // 🔴 `links` / `assignment` 是**已下的裁定**：同名键在教师的答案里指 `pairs` / `placement`，
  // 撞名会把「学生答对了」读成「答案泄漏了」。
  assert.deepEqual(
    buildAnswerValue(matchNode(), { kind: 'match', links: [{ leftId: 'l1', rightId: 'r2' }] }),
    { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r2' }] },
  );
  assert.deepEqual(
    buildAnswerValue(categorizeNode(), { kind: 'categorize', assignment: { i1: 'z1' } }),
    { format: 'categorize/v1', assignment: { i1: 'z1' } },
  );
});

test('buildAnswerValue 的「空」判据逐题型写清（写错 = 一个必然失败的按钮）', () => {
  // 服务端对「没作答就提交」回 400「请先作答再提交本题」，而那个 400 是**学生点了才发生的**。
  assert.equal(buildAnswerValue(node('single-choice', { options: [] }), { kind: 'choice', selected: [] }), null);
  assert.equal(buildAnswerValue(fillNode(), { kind: 'fill', texts: [''] }), null);
  assert.equal(buildAnswerValue(fillNode(), { kind: 'fill', texts: ['   '] }), null, '全空白等于没填');
  assert.equal(buildAnswerValue(fillMultiNode(), { kind: 'fill', texts: ['', ' '] }), null);
  assert.equal(buildAnswerValue(node('short-answer'), { kind: 'text', text: ' \n ' }), null);
  assert.equal(buildAnswerValue(fillMultiNode(), { kind: 'fill', texts: ['H2O', ''] }) !== null, true,
    '只填了一半**可以提交** —— 服务端会判半对');
  assert.equal(buildAnswerValue(matchNode(), { kind: 'match', links: [] }), null);
  assert.equal(buildAnswerValue(categorizeNode(), { kind: 'categorize', assignment: {} }), null);
});

test('🔴 buildAnswerValue：排序题**永远不为 null**（初始顺序本身就是一份合法作答）', () => {
  const value = buildAnswerValue(orderNode(), emptyDraftFor(orderNode()));
  assert.deepEqual(value, { format: 'order/v1', order: ['i1', 'i2', 'i3'] },
    '回 null ⇒ 学生连提交都点不了，而他那个顺序是合法的');
});

test('buildAnswerValue：未知题型不产生作答（编一种格式会让它「已提交」地出现在看板上）', () => {
  assert.equal(buildAnswerValue(node('ink'), { kind: 'text', text: '画了一笔' }), null);
  assert.equal(buildAnswerValue(node('drawing'), { kind: 'choice', selected: ['A'] }), null);
});

test('🔴 buildAnswerValue：输入态的 kind 与题型对不上时回 null（不「尽力读一读」）', () => {
  // 题被改过 / 状态来自上一个版本时，读出来的东西会被当成学生的作答存进库 ——
  // 而屏幕上根本没有那个控件（学生没动过它，却「答了」）。
  assert.equal(buildAnswerValue(matchNode(), { kind: 'order', order: ['i1'] }), null);
  assert.equal(buildAnswerValue(node('short-answer'), { kind: 'choice', selected: ['A'] }), null);
  assert.equal(buildAnswerValue(orderNode(), { kind: 'categorize', assignment: { i1: 'z1' } }), null);
  // ⚠️ 反面：**同一个家族的**两种题型是合法的（判断题的 draft 就是 `choice`）。
  assert.notEqual(buildAnswerValue(node('true-false'), { kind: 'choice', selected: ['F'] }), null);
});

test('buildAnswerValue：多空填空按 **blanks 的位数**截断（多出来的空服务端读不到）', () => {
  assert.deepEqual(
    buildAnswerValue(fillMultiNode(), { kind: 'fill', texts: ['H2O', 'CO2', '多出来的'] }),
    { format: 'fill-multi/v1', texts: ['H2O', 'CO2'] },
  );
});

// ── 5. draftFromValue：读回输入态（刷新后「做好的题还在」的那一半）──────────

test('draftFromValue：三种老格式逐字读回（选择 / 填空 / 问答）', () => {
  assert.deepEqual(
    draftFromValue(node('single-choice', { options: [] }), { format: 'choice/v1', selected: ['B'] }),
    { kind: 'choice', selected: ['B'] },
  );
  assert.deepEqual(draftFromValue(node('multi-choice', { options: [] }), { format: 'choice/v1', selected: ['A', 'B'] }),
    { kind: 'choice', selected: ['A', 'B'] });
  assert.deepEqual(draftFromValue(fillNode(), { format: 'fill/v1', text: 'H2O' }), { kind: 'fill', texts: ['H2O'] });
  assert.deepEqual(draftFromValue(node('short-answer'), { format: 'text/v1', text: '因为' }), { kind: 'text', text: '因为' });
  assert.deepEqual(draftFromValue(matchNode(), { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r2' }] }),
    { kind: 'match', links: [{ leftId: 'l1', rightId: 'r2' }] });
  assert.deepEqual(draftFromValue(categorizeNode(), { format: 'categorize/v1', assignment: { i1: 'z1' } }),
    { kind: 'categorize', assignment: { i1: 'z1' } });
});

test('🔴 draftFromValue：单空值读进多空题 ⇒ 补成与空数等长的一列（不许少一个框）', () => {
  // 教师把一道填空题从单空改成多空、而学生那份旧作答只有一个 `text`：
  // 长度对不齐的表现是**屏幕上少一个输入框**（学生填不了那个空）。
  assert.deepEqual(draftFromValue(fillMultiNode(), { format: 'fill/v1', text: 'H2O' }),
    { kind: 'fill', texts: ['H2O', ''] });
  // 反过来（多空值读进单空题）⇒ 截到 1 个，多的丢掉。
  assert.deepEqual(draftFromValue(fillNode(), { format: 'fill-multi/v1', texts: ['H2O', 'CO2'] }),
    { kind: 'fill', texts: ['H2O'] });
});

test('🔴 draftFromValue：多空填空的**空串不许被吞掉**（位置就是判据）', () => {
  // 🔴 这是本文件第二次抓到「按下标错位」那一族的缺陷（第一次是 M3 的合并顺序）。
  // 修之前 `texts` 走的是 `readStringList`（**丢空串**），于是每个空往前挪一格：
  //
  //   实测（审查者的探针，2026-09-24 修之前）：
  //     只填第 2 空（两空）: 落库 ["","H2O"] → 刷新后显示 ["H2O",""]      ❌
  //     填 1、3（三空）:      落库 ["甲","","丙"] → 刷新后显示 ["甲","丙",""] ❌
  //     只填第 1 空 / 全填:  不变                                         ✅
  //
  // 真机路径：教师在填空题上点一次「＋ 增加一个空」→ 学生**只填第 2 空** →
  // 自动保存落库 → **刷新** → 屏幕上第 1 空显示 H2O、第 2 空是空的 →
  // 学生照屏幕去改 ⇒ 把**错位的那一份**写回库 ⇒ 第 2 空的答案真的没了。
  // 全程无异常、无日志 —— 所以这几条断言必须逐字钉住**位置**，不是「有没有内容」。
  assert.deepEqual(draftFromValue(fillMultiNode(), { format: 'fill-multi/v1', texts: ['', 'H2O'] }),
    { kind: 'fill', texts: ['', 'H2O'] }, '只填第 2 空 ⇒ 第 2 空还得是 H2O');
  assert.deepEqual(draftFromValue(fillThreeNode(), { format: 'fill-multi/v1', texts: ['甲', '', '丙'] }),
    { kind: 'fill', texts: ['甲', '', '丙'] }, '跳过第 2 空 ⇒ 第 3 空不许往前挤');
  assert.deepEqual(draftFromValue(fillThreeNode(), { format: 'fill-multi/v1', texts: ['', '', '丙'] }),
    { kind: 'fill', texts: ['', '', '丙'] });
  // 长度不足 ⇒ 尾部补空（补位是**从后面**补，不能反过来把已有的往前挪）。
  assert.deepEqual(draftFromValue(fillThreeNode(), { format: 'fill-multi/v1', texts: ['甲'] }),
    { kind: 'fill', texts: ['甲', '', ''] });
  // 全空（学生把两个空都删干净了）⇒ 仍然是**两个**空框，不是零个。
  assert.deepEqual(draftFromValue(fillMultiNode(), { format: 'fill-multi/v1', texts: ['', ''] }),
    { kind: 'fill', texts: ['', ''] });
  // `texts: []`（一份没填过的多空作答）⇒ 也要补成与空数等长，不能回落去读 `text`
  //（多空值里没有那个键 ⇒ 整列变空、连框都不见了）。
  // ⊘ 2026-09-24 更正：括号里那半句**是反事实的** —— 回落去读 `text` 得到 `[]`，而下面
  // 那个按 `count` 补位的循环照样补满，两种判据在这条断言上**同结果**（本条在两种判据下
  // 都绿，它并不区分它们）。判据本体已退回 `length > 0`，理由与实测写在
  // `worksheet-answer-value.ts` 的 `draftFromValue` 那一段注释上。
  assert.deepEqual(draftFromValue(fillMultiNode(), { format: 'fill-multi/v1', texts: [] }),
    { kind: 'fill', texts: ['', ''] });
  // 坏元素（不是字符串）⇒ 落成空串**占住它那个位子**，不许丢掉它（丢掉就是错位）。
  assert.deepEqual(draftFromValue(fillThreeNode(), { format: 'fill-multi/v1', texts: ['甲', 42, '丙'] }),
    { kind: 'fill', texts: ['甲', '', '丙'] });
});

test('draftFromValue：读-写往返', () => {
  // ⚠️ **这条用例曾经是一条假保证，留痕如下（2026-09-24 审查抓出）**：
  // 它的名字声称「一律回到同一份输入态」，而填空那一格的夹具是 `texts: ['H2O', '']`
  //（**只有尾部空**）—— 尾部空恰好被补位 `texts[index] ?? ''` **意外修好**，
  // 所以它在 `readStringList` 吞空串的缺陷下**照绿**。也就是说：它在断言一个
  // **它没有覆盖到的性质**，而真缺陷（内部的空被吞掉 ⇒ 按下标错位）就藏在它旁边。
  // 上面的「多空填空的空串不许被吞掉」那条用例现在是真正的判据；这里补上内部空的夹具，
  // 让这条往返用例真的覆盖它名字里的射程。
  const cases: Array<[WorksheetQuestionNode, Parameters<typeof buildAnswerValue>[1]]> = [
    [node('multi-choice', { options: [] }), { kind: 'choice', selected: ['A', 'C'] }],
    [fillMultiNode(), { kind: 'fill', texts: ['H2O', ''] }],
    [fillMultiNode(), { kind: 'fill', texts: ['', 'H2O'] }],
    [fillThreeNode(), { kind: 'fill', texts: ['甲', '', '丙'] }],
    [fillNode(), { kind: 'fill', texts: ['光合作用'] }],
    [orderNode(), { kind: 'order', order: ['i3', 'i1', 'i2'] }],
    [matchNode(), { kind: 'match', links: [{ leftId: 'l2', rightId: 'r1' }] }],
    [categorizeNode(), { kind: 'categorize', assignment: { i1: 'z2', i2: 'z1' } }],
    // ★ M4b：笔迹也走这条往返 —— `canvas` 与每一笔的几何必须**逐字**回来
    //（`box` 是这条往返里唯一一个「不是空的、又不是学生输入」的字段，最容易在转换中丢掉）。
    [drawingNode(), { kind: 'ink', box: DRAWN_BOX, strokes: [STROKE] }],
    [handwritingNode('short-answer'), { kind: 'ink', box: DRAWN_BOX, strokes: [STROKE] }],
  ];
  cases.forEach(([target, draft]) => {
    const value = buildAnswerValue(target, draft);
    assert.notEqual(value, null);
    assert.deepEqual(draftFromValue(target, value), draft, `${target.type} 读-写往返必须无损`);
  });
});

test('🔴 draftFromValue：排序题裁掉已删条目，并把新加的条目补在后面', () => {
  // 三种结果都要对：删掉的那个 id 不许再出现在屏幕上（它会画成一个没有文字的条目），
  // 新加的条目必须出现（否则教师加了条目，学生永远交不出满分的排序）。
  assert.deepEqual(draftFromValue(orderNode(), { format: 'order/v1', order: ['i3', 'i9', 'i1'] }),
    { kind: 'order', order: ['i3', 'i1', 'i2'] });
  assert.deepEqual(draftFromValue(orderNode(), { format: 'order/v1', order: [] }),
    { kind: 'order', order: ['i1', 'i2', 'i3'] }, '空顺序 ⇒ 回到显示顺序，不是画一列空的');
  // ⚠️ 重复 id（手改过的行）：不去重 ⇒ React 的 `key` 撞车（同一条渲染两次），
  // 而它同时也让服务端那句「长度相等」必然判错。只留第一次出现的位置。
  assert.deepEqual(draftFromValue(orderNode(), { format: 'order/v1', order: ['i3', 'i3', 'i1'] }),
    { kind: 'order', order: ['i3', 'i1', 'i2'] });
});

test('🔴 draftFromValue：连线的旧 id 裁掉，端点重复的只留第一条', () => {
  // 重复端点会被服务端 `judgeMatch` 整条判错（用到它的那些线一条都不算对）——
  // 学生看着两条线拿 0 分，教师查不出来。
  assert.deepEqual(
    draftFromValue(matchNode(), {
      format: 'match/v1',
      links: [{ leftId: 'l1', rightId: 'r2' }, { leftId: 'l9', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }],
    }),
    { kind: 'match', links: [{ leftId: 'l1', rightId: 'r2' }] },
  );
});

test('draftFromValue：归类的旧条目 / 旧框裁掉', () => {
  assert.deepEqual(
    draftFromValue(categorizeNode(), { format: 'categorize/v1', assignment: { i1: 'z1', i9: 'z1', i2: 'z9' } }),
    { kind: 'categorize', assignment: { i1: 'z1' } },
  );
});

test('🔴 draftFromValue：坏形状一律落回空输入态，**不抛**', () => {
  // 渲染路径上一次 TypeError 会让整个面板白屏。
  const bad: unknown[] = [null, undefined, 42, '文字', [], { format: 42 }, { format: '不认识/v9' }, { selected: '不是数组' }];
  bad.forEach((value) => {
    const draft = draftFromValue(orderNode(), value);
    assert.deepEqual(draft, { kind: 'order', order: ['i1', 'i2', 'i3'] }, `坏值 ${JSON.stringify(value)} 必须落回空态`);
  });
  assert.deepEqual(draftFromValue(node('short-answer'), { format: '不认识/v9' }), { kind: 'text', text: '' });
  assert.deepEqual(draftFromValue(node('ink'), { format: '不认识/v9' }), { kind: 'text', text: '' });
});

test('draftFromValue：`format` 缺席时按 `node.type` 落回（老行 / 手改过的行）', () => {
  // `format` 是第一判据，但它缺席不该等于「什么都读不回来」—— 字段名才是协议。
  assert.deepEqual(draftFromValue(node('short-answer'), { text: '因为' }), { kind: 'text', text: '因为' });
  assert.deepEqual(draftFromValue(node('multi-choice', { options: [] }), { selected: ['A'] }),
    { kind: 'choice', selected: ['A'] });
});

test('draftFromValue：选择 / 填空**不裁**（教师端抽屉要把学生当初写的 key 显示出来）', () => {
  // 与条目型三个题型**方向相反**，所以它们共用一条裁剪规则会是错的：
  // `worksheet-drawer-state.ts` 的 `formatAnswer` 明写「选项对不上时退回 key 本身，
  // 不显示空白（空白像是没选）」—— 裁掉就退回不了。
  assert.deepEqual(draftFromValue(node('single-choice', { options: [{ key: 'A', text: '甲' }] }),
    { format: 'choice/v1', selected: ['Z'] }), { kind: 'choice', selected: ['Z'] });
});

// ── 6. ★ M4b：画布题的输入态与作答值（`ink/v1` / `drawing/v1`）──────────────
//
// 这一节钉住的是**形状的接线**，不是画布本身 —— C1 之前屏幕上还看不到任何画布
//（分派器 `src/app/classroom/worksheet/questions/index.tsx` 按 `node.type` 分支，
// ink 支是 C1 加的）。所以这里断言的全是「值长什么样」，没有一条断言「屏幕上画出什么」。
//
// 📌 本节**一条都没有**、也不可能覆盖手写手感（跟不跟手 / 延迟 / 手掌误触 / 与滚动抢）——
//   那是 Global Constraint 16 说的本机验不了的那一半，只能写「未验证」。

test('★ emptyDraftFor：画布题给 ink 起点（绘图题 4:3、手写问答 2:1）；键盘问答不受影响', () => {
  assert.deepEqual(emptyDraftFor(drawingNode()), { kind: 'ink', box: { w: 320, h: 240 }, strokes: [] });
  assert.deepEqual(emptyDraftFor(handwritingNode('short-answer')),
    { kind: 'ink', box: { w: 320, h: 160 }, strokes: [] });
  // ⚠️ 同一条 `short-answer`、只差 `inputMode` 一个字段 ⇒ 两种起点。判据在 `isInkNode` 一处。
  assert.deepEqual(emptyDraftFor(node('short-answer')), { kind: 'text', text: '' });
  // ⚠️ 「一笔都没有」这一半：起点必须是**空**的，否则白送一份「有内容可提交」的作答。
  assert.equal(isDraftEmpty(emptyDraftFor(drawingNode())), true);
});

test('★ isDraftEmpty：ink 的判据是「一笔都没有」，不看那个占位框', () => {
  assert.equal(isDraftEmpty({ kind: 'ink', box: { w: 320, h: 240 }, strokes: [] }), true);
  assert.equal(isDraftEmpty({ kind: 'ink', box: { w: 320, h: 240 }, strokes: [STROKE] }), false);
  // 照 `box` 判会反过来：空画布带着一个非零的占位框 ⇒ 误判成「有内容」。
  assert.equal(isDraftEmpty({ kind: 'ink', box: DRAWN_BOX, strokes: [] }), true);
});

test('🔴 buildAnswerValue：画布题的 `canvas` 必须是**学生量出来的框**，不是默认框', () => {
  // 🔴 反证：把 `valueFromDraft` 里那一行 `canvas: { w: draft.box.w, h: draft.box.h }`
  // 改成 `defaultInkBox(node)` ⇒ 这条变红（`DRAWN_BOX` 刻意不等于两个默认框）。
  // 记错这一个字段的后果：教师在抽屉里看到的宽高比与学生画的那一版不同，而两边都「看起来正常」。
  assert.deepEqual(
    buildAnswerValue(drawingNode(), { kind: 'ink', box: DRAWN_BOX, strokes: [STROKE] }),
    { format: 'drawing/v1', canvas: { w: 300, h: 200 }, strokes: [STROKE] },
  );
  // 同一份解答，换题型只换 `format` 名（裁定 6：一个实现、两个 format 名）。
  assert.deepEqual(
    buildAnswerValue(handwritingNode('short-answer'), { kind: 'ink', box: DRAWN_BOX, strokes: [STROKE] }),
    { format: 'ink/v1', canvas: { w: 300, h: 200 }, strokes: [STROKE] },
  );
  // 一笔都没画 ⇒ `null`（服务端对空作答回 400「请先作答再提交本题」）。
  assert.equal(buildAnswerValue(drawingNode(), emptyDraftFor(drawingNode())), null);
  assert.equal(
    buildAnswerValue(handwritingNode('short-answer'), emptyDraftFor(handwritingNode('short-answer'))),
    null,
  );
});

test('🔴 buildAnswerValue：手写的问答**能提交** —— ink 支必须排在题型分支之前', () => {
  // 🔴 反证（Global Constraint 14）：把 `valueFromDraft` 的 ink 支挪到那批题型分支
  // **之后** ⇒ 这条变红。顺序放反时先命中 `if (type === 'short-answer')`，在那里读到
  // `draft.kind !== 'text'` ⇒ 回 `null`：学生**画完了却按不动「提交本题」**，
  // 而屏幕上没有任何报错、没有一条既有用例会红。
  const value: AnswerDraft = { kind: 'ink', box: DRAWN_BOX, strokes: [STROKE] };
  const built = buildAnswerValue(handwritingNode('short-answer'), value);
  assert.notEqual(built, null, '手写问答画完了必须能提交');
  assert.equal(
    built && (built.format === 'ink/v1' || built.format === 'drawing/v1'),
    true,
    '手写问答交出去的必须是笔迹格式',
  );
});

test('🔴 buildAnswerValue：ink 也不「尽力读一读」—— 输入态与题型对不上就回 null', () => {
  // 🔴 这一条是上一条的**对偶面**：输入态与题型对不上时，读出来的东西会被当成学生的作答
  // 存进库，而屏幕上根本没有那个控件（学生没动过它，却「答了」）。
  assert.equal(buildAnswerValue(handwritingNode('short-answer'), { kind: 'text', text: '画了一笔' }), null);
  assert.equal(buildAnswerValue(node('short-answer'), { kind: 'ink', box: DRAWN_BOX, strokes: [STROKE] }), null);
  assert.equal(buildAnswerValue(drawingNode(), { kind: 'text', text: '画了一笔' }), null);
});

test('🔴 draftFromValue：笔迹值原样读回来 —— 笔画数与 `canvas` 逐字不变', () => {
  assert.deepEqual(
    draftFromValue(drawingNode(), { format: 'drawing/v1', canvas: DRAWN_BOX, strokes: [STROKE] }),
    { kind: 'ink', box: { w: 300, h: 200 }, strokes: [STROKE] },
  );
  // 🔴 这一条**刻意**让「`kind` 与题型对不上」也读得回来（只认 `format`，不看题型）：
  // 教师把一道题从手写改回键盘之后，学生**之前交的**那幅画仍然要读得回来 ——
  // 读不回来的表现是屏幕上一片空白，与「学生没写过」无法区分，而学生写的东西没有丢。
  // ⚠️ 不要因为它「看起来矛盾」而把它改成 empty。
  assert.deepEqual(
    draftFromValue(node('short-answer'), { format: 'ink/v1', canvas: DRAWN_BOX, strokes: [STROKE] }),
    { kind: 'ink', box: { w: 300, h: 200 }, strokes: [STROKE] },
  );
});

test('🔴 draftFromValue：画布题上的**非笔迹值** ⇒ 空画布（不抛、不回落成别的形状）', () => {
  // 回落到别的形状（比如 `text`）会让一道画布题在屏幕上出现一个学生**无法撤销、
  // 也无法提交**的控件；而空白画布至少是他认识的、能重画的。
  const empty = { kind: 'ink', box: { w: 320, h: 240 }, strokes: [] };
  assert.deepEqual(draftFromValue(drawingNode(), { format: 'choice/v1', selected: ['A'] }), empty);
  assert.deepEqual(draftFromValue(drawingNode(), { format: '不认识/v9' }), empty);
  // 手改过的行：`format` 是笔迹但 `strokes` 不是数组 ⇒ `readInkValue` 回 `null` ⇒ 空画布。
  assert.deepEqual(
    draftFromValue(drawingNode(), { format: 'drawing/v1', canvas: { w: 1, h: 1 }, strokes: '不是数组' }),
    empty,
  );
  // 坏值本身（null / 数字 / 数组）—— **不抛**。
  assert.deepEqual(draftFromValue(drawingNode(), null), empty);
  assert.deepEqual(draftFromValue(drawingNode(), 42), empty);
  assert.deepEqual(draftFromValue(drawingNode(), []), empty);
  // 手写问答同样是画布题，只是框不同（2:1）。
  assert.deepEqual(
    draftFromValue(handwritingNode('short-answer'), { format: 'choice/v1', selected: ['A'] }),
    { kind: 'ink', box: { w: 320, h: 160 }, strokes: [] },
  );
});
