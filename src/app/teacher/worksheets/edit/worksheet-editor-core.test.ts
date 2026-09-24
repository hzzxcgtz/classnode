/**
 * `worksheet-editor-core.ts` 的逐条断言 —— **撤销栈与内容 reducer 的唯一回归网**。
 *
 * 跑法（本仓没有前端测试框架，用 Node 24 自带的类型擦除直接执行）：
 *
 * ```bash
 * node --test src/app/teacher/worksheets/edit/worksheet-editor-core.test.ts
 * ```
 *
 * 也可以走 `pnpm test`（根目录），它把本文件与服务端那批一起跑。
 *
 * ⚠️ 为什么这一段值得单独成文件、单独断言：它是本页**唯一「错了不报错」的纯逻辑**。
 * 规格 §3-P 那句「改序不能让已答数据错位」说的正是这类失效 —— 游标一飘、`correctKeys`
 * 一错位，界面照常渲染、保存照常 200，只有已经收上来的作答在安静地错判。
 * 下面带 🔴 的几条是**反向断言**：把对应实现改坏，它们必须变红（反证做过，见
 * `.superpowers/c2-fixes-report.md`）。
 *
 * 分组与 `worksheet-editor-core.ts` 的分节一一对应：id 稳定性 / 同值去重 / 栈语义 /
 * 选项重编号 / 填空题 / 草稿与加载守卫。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorksheetContent, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
import {
  addBlank,
  buildPayload,
  categorizeAddItem,
  categorizeAddZone,
  categorizeRemoveItem,
  categorizeRemoveZone,
  contentReducer,
  createEmptyContent,
  createHistory,
  DEFAULT_SETTINGS,
  draftKeyFor,
  ensureOrderDistinct,
  fillShape,
  findInvalidPoints,
  findPartialPoints,
  findUncommittedPointInput,
  HISTORY_LIMIT,
  isOrderAmbiguous,
  isPartialPoints,
  type ItemEntry,
  matchAddRow,
  matchRemoveRow,
  matchSetPair,
  MAX_OPTIONS,
  moveIdInList,
  newQuestion,
  normalizeLoadedContent,
  normalizeLoadedSettings,
  optionKey,
  orderAddItem,
  orderRemoveItem,
  orderUseCurrentOrder,
  parseDraft,
  parsePointInput,
  placementSet,
  planPointInputChange,
  POINTS_MAX,
  pointsSignature,
  type QuestionPointsDraft,
  readBlankAnswers,
  readBlankText,
  readCategorize,
  readCorrectKeys,
  readEntries,
  readEntryIds,
  readFillAnswers,
  readMatch,
  readOptions,
  readOrder,
  readPlacement,
  type RejectedPointInput,
  removeBlank,
  renameEntryAt,
  sanitizeContentForSave,
  shouldWarnZeroHalfCredit,
  shuffleOrderItems,
  TRUE_FALSE_OPTIONS,
  writeBlankText,
  writeCategorize,
  writeEntries,
  writeFillAnswers,
  writeMatch,
  writeMultipleOptions,
  writeOptions,
  writeOrder,
} from './worksheet-editor-core.ts';

// ── 脚手架 ──────────────────────────────────────────────────────────────

function node(id: string, prompt = '', data: Record<string, unknown> = {}): WorksheetQuestionNode {
  return { id, type: 'short-answer', prompt, inputMode: 'keyboard', data, children: [] };
}

/** 填空题 —— `sanitizeContentForSave` **只碰这一类**，所以它需要自己的构造器。 */
function fillBlank(id: string, answers: unknown): WorksheetQuestionNode {
  return { id, type: 'fill-blank', prompt: '题干', inputMode: 'keyboard', data: { answers }, children: [] };
}

function contentOf(...nodes: WorksheetQuestionNode[]): WorksheetContent {
  return { schemaVersion: 1, nodes };
}

const SETTINGS: WorksheetSettings = {
  allowResubmit: true,
  autoGrade: true,
  defaultInputMode: 'keyboard',
  rewardStyle: 'star',
  rewardStep: 1,
  // 刻意给一个**非默认**的半对档（默认是 0）：这一份 `SETTINGS` 是「保存载荷」那一组用例
  // 的入参，配成默认值的话「它被原样带过去了」与「它被换成默认值」是同一个观测。
  halfStep: 2,
};

/** 题干为 `p1`…`pN` 的一份内容，用来数栈深。 */
function contentWithPrompt(prompt: string): WorksheetContent {
  return contentOf(node('q_fixed', prompt));
}

// ── 1. 题目 id 不随位置漂移（规格 §3-P）──────────────────────────────────
//
// 答案按 `questionId` 关联；`move` 只交换数组里的位置，节点对象本身必须原样搬过去。
// 任何「按新下标重建节点」的写法都会给同一道题换一个 id，于是已答数据整体错位一格 ——
// 而这在界面上看不出来（题干还是那句话，只是答案换了行）。

test('🔴 move 交换位置，题目 id 与内容整块跟着走（不重建、不换 id）', () => {
  const first = node('q_a', '第一题');
  const second = node('q_b', '第二题');
  const state = createHistory(contentOf(first, second));
  const moved = contentReducer(state, { kind: 'move', id: 'q_b', delta: -1 });

  assert.deepEqual(moved.present.nodes.map((item) => item.id), ['q_b', 'q_a']);
  // 不只是 id：整个节点对象是**同一份引用**，说明它是被搬过去的，不是照形状重建的。
  assert.equal(moved.present.nodes[0], second);
  assert.equal(moved.present.nodes[1], first);
});

test('move 之后原来的内容一个字都没变（题干 / data / children）', () => {
  const a = { ...node('q_a', ' photosynthesis '), data: { answers: ['光合作用'] } };
  const b = node('q_b', '呼吸作用');
  const state = createHistory(contentOf(a, b));
  const moved = contentReducer(state, { kind: 'move', id: 'q_a', delta: 1 });
  assert.deepEqual(moved.present.nodes[0], { ...b });
  assert.deepEqual(moved.present.nodes[1], { ...a });
});

// ── 2. 越界与未命中：返回**同一个对象**，不占一格撤销栈 ────────────────────
//
// 第一题按 ▲ 或最后一题按 ▼ 时，若 reducer 造一个新对象出来，教师会得到一次
// 「按了撤销但屏幕纹丝不动」的空步 —— 明明什么都没发生，却要按两次才退得回去。

test('🔴 越界 move（第一题按 ▲）返回同一个对象，且不进栈', () => {
  const state = createHistory(contentOf(node('q_a'), node('q_b')));
  const next = contentReducer(state, { kind: 'move', id: 'q_a', delta: -1 });
  assert.equal(next, state, '越界 move 不该产生新状态');
  assert.equal(next.past.length, 0);
  assert.equal(next.present, state.present);
});

test('🔴 越界 move（最后一题按 ▼）返回同一个对象，且不进栈', () => {
  const state = createHistory(contentOf(node('q_a'), node('q_b')));
  const next = contentReducer(state, { kind: 'move', id: 'q_b', delta: 1 });
  assert.equal(next, state);
  assert.equal(next.past.length, 0);
});

test('move 一个不存在的 id ⇒ 同一对象（不插队、不报错）', () => {
  const state = createHistory(contentOf(node('q_a'), node('q_b')));
  assert.equal(contentReducer(state, { kind: 'move', id: 'q_不存在', delta: 1 }), state);
});

test('remove 一个不存在的 id ⇒ 同一对象', () => {
  const state = createHistory(contentOf(node('q_a')));
  assert.equal(contentReducer(state, { kind: 'remove', id: 'q_不存在' }), state);
});

// ── 3. 同值去重：值没变就不该造历史 ──────────────────────────────────────

test('🔴 同值 updatePrompt 返回同一个对象（不进栈、不产生空步撤销）', () => {
  const state = createHistory(contentWithPrompt('光合作用'));
  const next = contentReducer(state, { kind: 'updatePrompt', id: 'q_fixed', prompt: '光合作用' });
  assert.equal(next, state);
  assert.equal(next.past.length, 0);
});

test('异值 updatePrompt 造新对象，且新内容正确', () => {
  const state = createHistory(contentWithPrompt('光合作用'));
  const next = contentReducer(state, { kind: 'updatePrompt', id: 'q_fixed', prompt: '呼吸作用' });
  assert.notEqual(next, state);
  assert.equal(next.present.nodes[0].prompt, '呼吸作用');
  assert.equal(next.past.length, 1);
});

test('🔴 同值 updateData 返回同一个对象（与 updatePrompt 同一条规矩）', () => {
  const state = createHistory(contentOf(node('q_a', '', { explanation: '因为所以', inputMode: 'keyboard' })));
  const next = contentReducer(state, { kind: 'updateData', id: 'q_a', patch: { explanation: '因为所以' } });
  assert.equal(next, state, '补丁与现值相同时不该进栈');
  assert.equal(next.past.length, 0);
});

test('updateData 的比较是**逐个键的引用比较**：交同一个数组引用算没变，交新数组算变了', () => {
  // 这条写的不是「应该」，而是**实际**的边界 —— 免得下一个读代码的人以为它会做深比较。
  // 补丁里的 `options` / `correctKeys` 由 `writeOptions` 每次新造，按引用比必然不同，
  // 所以它们照常进栈；深比较会把「就地改了数组再交进来」判成没变，那是更坏的方向。
  const options = [{ key: 'A', text: '甲' }];
  const state = createHistory(contentOf(node('q_a', '', { options })));
  assert.equal(
    contentReducer(state, { kind: 'updateData', id: 'q_a', patch: { options } }),
    state,
    '同一个数组引用 ⇒ 没变',
  );
  assert.notEqual(
    contentReducer(state, { kind: 'updateData', id: 'q_a', patch: { options: [{ key: 'A', text: '甲' }] } }),
    state,
    '内容相同但引用不同的新数组 ⇒ 照常进栈（不做深比较）',
  );
});

test('空补丁 updateData 也返回同一个对象', () => {
  const state = createHistory(contentOf(node('q_a', '', { answers: [] })));
  assert.equal(contentReducer(state, { kind: 'updateData', id: 'q_a', patch: {} }), state);
});

test('补丁里只要有一个键的值真的变了，就进栈', () => {
  const state = createHistory(contentOf(node('q_a', '', { answers: ['光合作用'], explanation: 'x' })));
  const next = contentReducer(state, { kind: 'updateData', id: 'q_a', patch: { answers: ['光合作用'], explanation: 'y' } });
  assert.notEqual(next, state);
  assert.equal(next.past.length, 1);
  assert.deepEqual(next.present.nodes[0].data, { answers: ['光合作用'], explanation: 'y' });
});

test('updateData 命中的是那道题，别的题原样不动', () => {
  const other = node('q_b', '另一题', { answers: ['甲'] });
  const state = createHistory(contentOf(node('q_a', '', { answers: [] }), other));
  const next = contentReducer(state, { kind: 'updateData', id: 'q_a', patch: { answers: ['乙'] } });
  assert.equal(next.present.nodes[1], other);
  assert.deepEqual(next.present.nodes[0].data, { answers: ['乙'] });
});

// ── 4. undo / redo 的栈语义 ─────────────────────────────────────────────

test('空栈 undo 是 no-op：返回同一个（空的）历史', () => {
  const state = createHistory(contentOf(node('q_a')));
  assert.equal(contentReducer(state, { kind: 'undo' }), state);
});

test('空栈 redo 是 no-op：返回同一个历史', () => {
  const state = createHistory(contentOf(node('q_a')));
  assert.equal(contentReducer(state, { kind: 'redo' }), state);
});

test('undo 退回上一份，并把退回前的那份放进 future', () => {
  const initial = contentWithPrompt('');
  const state = contentReducer(createHistory(initial), { kind: 'updatePrompt', id: 'q_fixed', prompt: 'A' });
  const undone = contentReducer(state, { kind: 'undo' });
  assert.equal(undone.present, initial);
  assert.equal(undone.past.length, 0);
  assert.equal(undone.future.length, 1);
  assert.equal(undone.future[0], state.present);
});

test('redo 回到撤销前那一份', () => {
  const initial = contentWithPrompt('');
  const state = contentReducer(createHistory(initial), { kind: 'updatePrompt', id: 'q_fixed', prompt: 'A' });
  const round = contentReducer(contentReducer(state, { kind: 'undo' }), { kind: 'redo' });
  assert.equal(round.present, state.present);
  assert.equal(round.future.length, 0);
  assert.equal(round.past.length, 1);
});

test('🔴 新的改动清空 future（重做那条线失效）', () => {
  const initial = contentWithPrompt('');
  const state = contentReducer(createHistory(initial), { kind: 'updatePrompt', id: 'q_fixed', prompt: 'A' });
  const undone = contentReducer(state, { kind: 'undo' });
  assert.equal(undone.future.length, 1);
  const diverged = contentReducer(undone, { kind: 'updatePrompt', id: 'q_fixed', prompt: 'B' });
  assert.equal(diverged.future.length, 0);
  assert.equal(diverged.present.nodes[0].prompt, 'B');
});

test('reset 是换基线、不是可撤销的一步（past / future 都清空）', () => {
  const state = contentReducer(createHistory(contentWithPrompt('')), { kind: 'updatePrompt', id: 'q_fixed', prompt: 'A' });
  const fresh = contentOf(node('q_new', '全新的'));
  const reset = contentReducer(state, { kind: 'reset', content: fresh });
  assert.equal(reset.present, fresh);
  assert.equal(reset.past.length, 0);
  assert.equal(reset.future.length, 0);
});

test(`历史栈上限：做 ${HISTORY_LIMIT + 30} 次改动后 past 正好留在 ${HISTORY_LIMIT}，且丢的是最早的那批`, () => {
  const total = HISTORY_LIMIT + 30;
  let state = createHistory(contentWithPrompt('p0'));
  for (let index = 1; index <= total; index += 1) {
    state = contentReducer(state, { kind: 'updatePrompt', id: 'q_fixed', prompt: `p${index}` });
  }
  assert.equal(state.past.length, HISTORY_LIMIT);
  assert.equal(state.present.nodes[0].prompt, `p${total}`);
  // 被截掉的是最早的 30 份：栈底是「第 30 次改动之前」的那一份。
  assert.equal(state.past[0].nodes[0].prompt, `p${total - HISTORY_LIMIT}`);
});

// ── 5. 选项重编号：正确答案跟着**文本**走 ────────────────────────────────
//
// 选项的 `key` 是学生答案里的值（`{ format: 'choice/v1', selected: ['B'] }`）。
// 删掉「A」之后原来的「B」必须变成「A」；而正确答案若只按字母跟着变，就会从
// 「光合作用」跳到「呼吸作用」上 —— 判分从此全错且没有任何报错。

test('🔴 删掉第一个选项后，正确答案仍然落在**同一段文本**上', () => {
  const before = [
    { key: 'A', text: '呼吸作用' },
    { key: 'B', text: '光合作用' },
    { key: 'C', text: '蒸腾作用' },
  ];
  const written = writeOptions([before[1], before[2]], ['B']);
  assert.deepEqual(written.options, [
    { key: 'A', text: '光合作用' },
    { key: 'B', text: '蒸腾作用' },
  ]);
  // 关键的一条：答案是「光合作用」，不是「A」。
  assert.deepEqual(written.correctKeys, ['A']);
  assert.equal(written.options.find((option) => option.key === written.correctKeys[0])?.text, '光合作用');
});

test('正确答案指向被删掉的那个选项 ⇒ 变空数组，而不是错指到别人身上', () => {
  const written = writeOptions([{ key: 'B', text: '光合作用' }], ['A']);
  assert.deepEqual(written.correctKeys, []);
  assert.deepEqual(written.options, [{ key: 'A', text: '光合作用' }]);
});

test('只保留一个正确答案（单选）：列表里**第一个**有效的那个；重复的 key 只算一次', () => {
  const options = [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }];
  assert.deepEqual(writeOptions(options, ['B', 'A']).correctKeys, ['B']);
  assert.deepEqual(writeOptions(options, ['B', 'B']).correctKeys, ['B']);
  assert.deepEqual(writeOptions(options, ['悬空', 'A']).correctKeys, ['A'], '无效的那个要被跳过，不是占了唯一的名额');
});

test('选项按位置重新编号；correctKeys 里的非字符串元素被丢掉', () => {
  const written = writeOptions([{ key: 'X', text: '甲' }, { key: 'Y', text: '乙' }], ['Y', 42, null]);
  assert.deepEqual(written.options.map((option) => option.key), ['A', 'B']);
  assert.deepEqual(written.correctKeys, ['B']);
});

test('correctKeys 不是数组时当作空（不抛）', () => {
  assert.deepEqual(writeOptions([{ key: 'A', text: '甲' }], undefined).correctKeys, []);
  assert.deepEqual(writeOptions([{ key: 'A', text: '甲' }], 'B').correctKeys, []);
});

// ── 5b. 超过 A–Z 的选项**不静默截断** ───────────────────────────────────
//
// 服务端对选项数不设上限（`validateQuestion` 只要求 >= 2），所以库里可能存在
// 26 个以上的题。原来这里 `slice(0, MAX_OPTIONS)`：教师改任意一处选项文字，
// 多出来的选项就被悄悄砍掉，而 `correctKeys` 找不到映射后变空 —— 全都没有报错。

test('🔴 30 个选项的单子：改一处选项后仍然是 30 个，一个都没被砍掉', () => {
  const raw = Array.from({ length: 30 }, (_, index) => ({ key: optionKey(index), text: `选项 ${index + 1}` }));
  const written = writeOptions(raw, ['A']);
  assert.equal(written.options.length, 30, `${MAX_OPTIONS} 是界面新建的上限，不是读既有内容时的硬顶`);
  assert.deepEqual(written.options.map((option) => option.text), raw.map((option) => option.text));
  assert.deepEqual(written.correctKeys, ['A']);
});

test('🔴 30 个选项、正确答案在第 28 个：答案**不丢**（原来会变成空数组）', () => {
  const raw = Array.from({ length: 30 }, (_, index) => ({ key: `k${index + 1}`, text: `选项 ${index + 1}` }));
  const written = writeOptions(raw, ['k28']);
  assert.deepEqual(written.correctKeys, ['k28']);
  // 且那个 key 在结果里真的对得上一段文本（不是悬空的字母）。
  assert.equal(written.options.find((option) => option.key === 'k28')?.text, '选项 28');
});

test('A–Z 之内的选项照常重新编号（超限那条支路不改变原有行为）', () => {
  const raw = Array.from({ length: MAX_OPTIONS }, (_, index) => ({ key: `old-${index}`, text: `选项 ${index + 1}` }));
  const written = writeOptions(raw, ['old-25']);
  assert.deepEqual(written.options.map((option) => option.key), raw.map((_, index) => optionKey(index)));
  assert.deepEqual(written.correctKeys, ['Z']);
});

// ── 6. 填空题：空行的进与出 ─────────────────────────────────────────────
//
// 编辑期**允许**空行存在（textarea 的换行需要它，往返才无损），但**出网之前必须去掉**：
// `grade()` 用 `normalizeFillText` 比较，空串归一化之后还是空串 —— `answers: ['']`
// 会把学生的空作答判成正确，看板上显示为「全班都对」。

test('readFillAnswers 用换行连接字符串元素，非字符串元素直接跳过', () => {
  const target = node('q_a', '', { answers: ['光合作用', 42, '呼吸作用', null] });
  assert.equal(readFillAnswers(target), '光合作用\n呼吸作用');
});

test('readFillAnswers 在 answers 不是数组时返回空串（不抛）', () => {
  assert.equal(readFillAnswers(node('q_a', '', { answers: '光合作用' })), '');
  assert.equal(readFillAnswers(node('q_a', '', {})), '');
});

test('writeFillAnswers 刻意保留空行 —— textarea 往返无损', () => {
  assert.deepEqual(writeFillAnswers('甲\n\n乙'), ['甲', '', '乙']);
  // 往返：写下去再读回来，屏幕上的字符一模一样。
  const target = node('q_a', '', { answers: writeFillAnswers('甲\n\n乙\n') });
  assert.equal(readFillAnswers(target), '甲\n\n乙\n');
});

test('🔴 sanitizeContentForSave 去掉空行与纯空白行（否则空作答会被判成正确）', () => {
  const clean = sanitizeContentForSave(contentOf(fillBlank('q_a', ['光合作用', '', '   ', '呼吸作用'])));
  assert.deepEqual(clean.nodes[0].data.answers, ['光合作用', '呼吸作用']);
  // 极端情形：整份只剩空行 ⇒ 变成空数组（服务端会以「至少要有一个可接受的答案」拦下，
  // 而不是让一份 `answers: ['']` 把全班的空作答判成正确）。
  assert.deepEqual(sanitizeContentForSave(contentOf(fillBlank('q_b', ['', '  ']))).nodes[0].data.answers, []);
});

test('sanitizeContentForSave 只碰填空题；没有可清理的东西时返回同一个对象', () => {
  const clean = contentOf(fillBlank('q_a', ['光合作用']), node('q_b', '', { answers: ['', ''] }));
  assert.equal(sanitizeContentForSave(clean), clean, '没有可清理的东西就不该造新对象');
  const odd = contentOf(fillBlank('q_c', '不是数组'));
  assert.equal(sanitizeContentForSave(odd), odd, 'answers 不是数组时原样保留');
});

/** 多空填空题（M4a）—— 答案在**第二层**。 */
function fillBlanks(id: string, blanks: unknown): WorksheetQuestionNode {
  return { id, type: 'fill-blank', prompt: '题干', inputMode: 'keyboard', data: { blanks }, children: [] };
}

test('🔴 sanitizeContentForSave 也要清**多空**（M4a）的第二层空行', () => {
  // 🔴 这条是「单空修过、多空原样重现」的直接产物：`blanks[*].answers` 在第二层，
  // 只清 `data.answers` 的那一版够不到它 ⇒ `['']` 会被当成一个可接受答案
  // ⇒ 学生的**空作答**判成正确，而看板上显示「全班都对」。
  const cleaned = sanitizeContentForSave(contentOf(fillBlanks('q_a', [
    { answers: ['H2O', '', '   '] },
    { answers: [''] },
    { answers: ['CO2', '二氧化碳'] },
  ])));
  assert.deepEqual(
    (cleaned.nodes[0].data.blanks as Array<{ answers: string[] }>).map((blank) => blank.answers),
    [['H2O'], [], ['CO2', '二氧化碳']],
    '每个空各自清空行，**空的数量与顺序不变**',
  );

  // 阳性对照：干净的输入不该被造新对象（与单空那条同一个判据）。
  const clean = contentOf(fillBlanks('q_b', [{ answers: ['H2O'] }]));
  assert.equal(sanitizeContentForSave(clean), clean, '没有可清理的东西就不该造新对象');

  // 单空与多空同时在场时，两边都要清（形状不是二选一，读的一侧两种都认）。
  const both = sanitizeContentForSave(contentOf(
    fillBlank('q_c', ['', '光合作用']),
    fillBlanks('q_d', [{ answers: ['', 'CO2'] }]),
  ));
  assert.deepEqual(both.nodes[0].data.answers, ['光合作用']);
  assert.deepEqual((both.nodes[1].data.blanks as Array<{ answers: string[] }>)[0].answers, ['CO2']);
});

test('buildPayload 是 sanitize 的**唯一**出网点：发出去的载荷里没有空答案', () => {
  const payload = buildPayload('  第一课  ', '   ', SETTINGS, contentOf(fillBlank('q_a', ['光合作用', ''])));
  assert.equal(payload.title, '第一课');
  assert.equal(payload.description, null);
  assert.deepEqual(payload.content.nodes[0].data.answers, ['光合作用']);
});

test('buildPayload 的归一化与服务端同形（trim + 空串归 null），否则「未保存」标记擦不掉', () => {
  assert.equal(buildPayload('', '', SETTINGS, createEmptyContent()).description, null);
  assert.equal(buildPayload('标题', ' 说明 ', SETTINGS, createEmptyContent()).description, '说明');
});

// ── 7. 新题与题型 ───────────────────────────────────────────────────────

test('optionKey 由位置派生：A、B、…、Z', () => {
  assert.equal(optionKey(0), 'A');
  assert.equal(optionKey(1), 'B');
  assert.equal(optionKey(25), 'Z');
});

test('newQuestion：id 带 q_ 前缀、第一批恒为 keyboard、children 为空', () => {
  const question = newQuestion('short-answer');
  assert.match(question.id, /^q_/);
  assert.equal(question.inputMode, 'keyboard');
  assert.deepEqual(question.children, []);
  assert.equal(question.prompt, '');
});

test('🔴 newQuestion 的单选题 correctKeys 默认是**空的**，不是 [\'A\']', () => {
  // 默认选中 A 会安静地把一道没配答案的题变成「所有选 A 的学生都对」；
  // 空数组会被服务端拦下并说清原因（响亮失败）。
  const question = newQuestion('single-choice');
  assert.deepEqual(question.data.correctKeys, []);
  assert.deepEqual(question.data.options, [{ key: 'A', text: '' }, { key: 'B', text: '' }]);
});

test('newQuestion 的填空题 answers 是空的（没有可接受答案就让服务端拦下）', () => {
  assert.deepEqual(newQuestion('fill-blank').data.answers, []);
});

test('两次 newQuestion 的 id 不相同', () => {
  assert.notEqual(newQuestion('short-answer').id, newQuestion('short-answer').id);
});

test('createEmptyContent 是一份合法的空内容', () => {
  assert.deepEqual(createEmptyContent(), { schemaVersion: 1, nodes: [] });
});

// ── 8. readOptions 的容错 ───────────────────────────────────────────────
//
// `data` 来自库里的 JSON，任何手改过的行都可能有别的形状。

test('readOptions：options 不是数组 ⇒ 空数组（不抛）', () => {
  assert.deepEqual(readOptions(node('q_a', '', { options: 'A,B' })), []);
  assert.deepEqual(readOptions(node('q_a', '', {})), []);
});

test('readOptions：跳过垃圾条目，缺 key 的按**已收下的条数**补（不留空洞）', () => {
  const target = node('q_a', '', {
    options: [{ key: 'A', text: '甲' }, null, { text: '乙' }, { key: '', text: '丙' }, '不是对象'],
  });
  assert.deepEqual(readOptions(target), [
    { key: 'A', text: '甲' },
    { key: 'B', text: '乙' },
    { key: 'C', text: '丙' },
  ]);
});

test('readOptions：text 不是字符串时当空串', () => {
  assert.deepEqual(readOptions(node('q_a', '', { options: [{ key: 'A', text: 42 }] })), [{ key: 'A', text: '' }]);
});

// ── 9. 草稿形状校验（localStorage 是外部输入）───────────────────────────
//
// 半个草稿比没有草稿更危险：形状不对就**整份作废**。

function draftWith(nodeValue: unknown): string {
  return JSON.stringify({
    savedAt: 1_700_000_000_000,
    title: '第一课',
    description: '说明',
    // 奖励三项刻意给**非默认**的值（默认是 star / 1 / 0）：草稿里配好的奖励形式要是被
    // 解析时丢掉，教师恢复一次草稿就会发现自己的「花朵 ×5、半对 0」变回了星星。
    //
    // 🔴 `halfStep` 这里**必须用 `0`**（2026-09-24 控制器裁定，替换掉原来的 `3`）：
    //   `HALF_STEPS = [0,1,2,3,5]` 与 `REWARD_STEPS = [1,2,3,5]` 除 `0` 之外**完全重合**
    //   ⇒ `3` 同时属于两个域，`normalizeHalfStep(3) === normalizeRewardStep(3) === 3`，
    //   这条断言**分不出「parseDraft 误用了 `normalizeRewardStep`」** —— 而紧邻的源码注释
    //   恰恰在警告这件事（`parseDraft` 里那两行 ⚠️）。用 `0` 才分得出：
    //   正确 ⇒ 0；误用 `normalizeRewardStep` ⇒ 回落成 `DEFAULT_REWARD_STEP = 1`。
    // ⚠️ 但 `0` 恰好也是 `DEFAULT_HALF_STEP`，所以它**分不出「根本没读这个键」** ——
    //   那个方向由下面「草稿里的 halfStep 被原样读进来」那条用 `5` 单独钉住。
    settings: { allowResubmit: false, autoGrade: true, defaultInputMode: 'handwriting', rewardStyle: 'flower', rewardStep: 5, halfStep: 0 },
    content: { schemaVersion: 9, nodes: [nodeValue] },
  });
}

const GOOD_NODE = { id: 'q_1', type: 'short-answer', prompt: '题干', inputMode: 'keyboard', data: {}, children: [] };

test('parseDraft：合法草稿解析成功，settings 与 schemaVersion 归一化', () => {
  const draft = parseDraft(draftWith(GOOD_NODE));
  assert.ok(draft);
  assert.equal(draft.title, '第一课');
  assert.equal(draft.content.schemaVersion, 9);
  assert.deepEqual(draft.settings, {
    allowResubmit: false, autoGrade: true, defaultInputMode: 'handwriting', rewardStyle: 'flower', rewardStep: 5, halfStep: 0,
  });
});

test('🔴 parseDraft：草稿里的 `halfStep` 被**原样读进来**（漏读 ⇒ 恢复草稿就把半对档抹成 0）', () => {
  // 与 `normalizeLoadedSettings` 那条「奖励三项原样带过来」是同一件事的**另一条路**：
  // `parseDraft` 读的是 localStorage，`normalizeLoadedSettings` 读的是服务端详情 ——
  // 两条路各写一份判据，只改一处就会让「恢复草稿」与「打开已保存的单」给出不同的奖励档。
  //
  // ⚠️ 这里用 `5` 而**不是** `0`：`0` 恰好是 `DEFAULT_HALF_STEP`，表达式写错成
  // 「不读草稿里那个键」也会得到 `0`（假绿）。`5` 只有真的读进来才可能出现
  // —— `normalizeHalfStep(5) === 5`，而 `normalizeRewardStep(5) === 5` 也一样，
  // 所以这条**不**负责区分误用函数（那个由上面 `draftWith` 里的 `0` 负责）。
  const draft = parseDraft(JSON.stringify({
    savedAt: 1, title: 't', description: 'd',
    settings: { allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard', rewardStyle: 'star', rewardStep: 1, halfStep: 5 },
    content: { schemaVersion: 1, nodes: [GOOD_NODE] },
  }));
  assert.ok(draft);
  assert.equal(draft.settings.halfStep, 5);
  // 反面：越界的 4 回落到默认的 0（而不是 1）。
  assert.equal(parseDraft(JSON.stringify({
    savedAt: 1, title: 't', description: 'd',
    settings: { halfStep: 4 },
    content: { schemaVersion: 1, nodes: [GOOD_NODE] },
  }))?.settings.halfStep, 0);
});

test('parseDraft：不是 JSON / 是 JSON 但不是对象 ⇒ null', () => {
  assert.equal(parseDraft(null), null);
  assert.equal(parseDraft(''), null);
  assert.equal(parseDraft('{不是 json'), null);
  assert.equal(parseDraft('"一个字符串"'), null);
  assert.equal(parseDraft('[1,2,3]'), null);
  assert.equal(parseDraft('null'), null);
});

test('parseDraft：顶层字段缺一不可（savedAt / title / description / settings / content）', () => {
  const base = {
    savedAt: 1, title: 't', description: 'd',
    settings: { allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard' },
    content: { schemaVersion: 1, nodes: [GOOD_NODE] },
  };
  assert.ok(parseDraft(JSON.stringify(base)));
  for (const key of ['savedAt', 'title', 'description', 'settings', 'content'] as const) {
    const broken: Record<string, unknown> = { ...base };
    delete broken[key];
    assert.equal(parseDraft(JSON.stringify(broken)), null, `缺 ${key} 时应当整份作废`);
  }
  assert.equal(parseDraft(JSON.stringify({ ...base, savedAt: Number.NaN })), null, 'savedAt 是 NaN 也要作废');
  assert.equal(parseDraft(JSON.stringify({ ...base, content: { schemaVersion: 1, nodes: '不是数组' } })), null);
});

test('🔴 parseDraft：节点缺 id / 缺 type / **缺 data** ⇒ 整份作废', () => {
  // 缺 data 的那一条是本轮补上的：`readOptions` 读 `node.data.options`、`readFillAnswers`
  // 读 `node.data.answers`，都是直接解引用 —— 放它过去，编辑页会在第一次渲染时 TypeError 白屏。
  assert.equal(parseDraft(draftWith({ ...GOOD_NODE, id: '' })), null);
  assert.equal(parseDraft(draftWith({ ...GOOD_NODE, id: 42 })), null);
  assert.equal(parseDraft(draftWith({ ...GOOD_NODE, type: undefined })), null);
  assert.equal(parseDraft(draftWith({ ...GOOD_NODE, data: undefined })), null);
  assert.equal(parseDraft(draftWith({ ...GOOD_NODE, data: null })), null);
  assert.equal(parseDraft(draftWith({ ...GOOD_NODE, data: [] })), null);
  assert.equal(parseDraft(draftWith(null)), null);
});

test('parseDraft：settings 缺失的键按默认走（只认那几个值）', () => {
  const draft = parseDraft(JSON.stringify({
    savedAt: 1, title: 't', description: 'd',
    settings: { defaultInputMode: '别的' },
    content: { schemaVersion: 1, nodes: [] },
  }));
  assert.ok(draft);
  assert.deepEqual(draft.settings, DEFAULT_SETTINGS);
});

test('draftKeyFor：新建用 new，编辑用真实 id（两者不能互相覆盖）', () => {
  assert.equal(draftKeyFor(null), 'worksheet-draft:new');
  assert.equal(draftKeyFor('abc'), 'worksheet-draft:abc');
});

// ── 10. 从服务端加载的内容：同一道守卫 ───────────────────────────────────

test('🔴 normalizeLoadedContent：缺 data 的节点被丢掉（否则编辑页 TypeError）', () => {
  const loaded = normalizeLoadedContent({
    schemaVersion: 1,
    nodes: [GOOD_NODE, { id: 'q_2', type: 'fill-blank', prompt: '题干', inputMode: 'keyboard', children: [] }],
  });
  assert.deepEqual(loaded.nodes.map((item) => item.id), ['q_1']);
});

test('normalizeLoadedContent：整棵树不可用 ⇒ 空内容（不抛）', () => {
  assert.deepEqual(normalizeLoadedContent(null), createEmptyContent());
  assert.deepEqual(normalizeLoadedContent([]), createEmptyContent());
  assert.deepEqual(normalizeLoadedContent({ nodes: '不是数组' }), createEmptyContent());
  assert.deepEqual(normalizeLoadedContent('字符串'), createEmptyContent());
});

test('normalizeLoadedContent：schemaVersion 不是数字时回落到当前版本', () => {
  assert.equal(normalizeLoadedContent({ nodes: [] }).schemaVersion, 1);
  assert.equal(normalizeLoadedContent({ schemaVersion: 7, nodes: [] }).schemaVersion, 7);
});

test('normalizeLoadedSettings：不是对象 ⇒ 默认值；只认 handwriting 这一个值', () => {
  assert.deepEqual(normalizeLoadedSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeLoadedSettings([1]), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeLoadedSettings({ defaultInputMode: 'handwriting' }).defaultInputMode, 'handwriting');
  assert.equal(normalizeLoadedSettings({ allowResubmit: false }).allowResubmit, false);
});

test('normalizeLoadedSettings：奖励三项原样带过来（漏掉就等于用默认值覆盖库里配好的档）', () => {
  // 🔴 编辑页保存时是把 `settings` **整份**发回去的（`buildPayload`）。这里漏一个键，
  // 「打开 → 只改了个标题 → 保存」就会把教师配好的奖励形式悄悄改回星星。
  // ★ M4a：`halfStep` 就是新加的那一个 —— 它最容易在这条路上被漏掉（服务端认它、
  // 下发给学生，而前端读回来时没带上，于是原样发回去的 settings 里没有那个键）。
  const loaded = normalizeLoadedSettings({
    allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard', rewardStyle: 'flower', rewardStep: 5, halfStep: 3,
  });
  assert.deepEqual(loaded, {
    allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard', rewardStyle: 'flower', rewardStep: 5, halfStep: 3,
  });
  // 坏值回落到与取值域同一份默认（不是就地编一个第五档）
  assert.equal(normalizeLoadedSettings({ rewardStyle: '彩虹' }).rewardStyle, DEFAULT_SETTINGS.rewardStyle);
  assert.equal(normalizeLoadedSettings({ rewardStep: 4 }).rewardStep, DEFAULT_SETTINGS.rewardStep);
  assert.equal(normalizeLoadedSettings({ rewardStep: '3' }).rewardStep, DEFAULT_SETTINGS.rewardStep);
  // ★ 半对档：0 是**合法值**（要原样带过来），4 是越界值（回落到 0）。
  //   ⚠️ 这里**不能**用 `normalizeRewardStep` —— 它的域不含 0，会把「半对 0」变成 1，
  //   而 0 恰恰是新单的默认值（规格 §12 裁定 3），也就是最常见的那个取值。
  assert.equal(normalizeLoadedSettings({ halfStep: 0 }).halfStep, 0, '0 是配过的半对档，不是缺字段');
  assert.equal(normalizeLoadedSettings({ halfStep: 5 }).halfStep, 5);
  assert.equal(normalizeLoadedSettings({ halfStep: 4 }).halfStep, DEFAULT_SETTINGS.halfStep);
  assert.equal(normalizeLoadedSettings({ halfStep: '3' }).halfStep, DEFAULT_SETTINGS.halfStep);
  assert.notEqual(DEFAULT_SETTINGS.halfStep, DEFAULT_SETTINGS.rewardStep, '两档的默认值不同（0 与 1），别互换');
});

// ── 11. 逐题分值（M4a，规格 §12 裁定 4 / 5）─────────────────────────────
//
// 这一组是**编辑器侧**的判据，与服务端那三个函数（`normalizePointValue` /
// `normalizePoints` / `resolvePoints`）回答的**不是**同一个问题：那边回答「判分时用哪两个数」，
// 这边回答「教师在屏幕上填了什么、那个状态能不能保存」。
//
// ⚠️ 两半判据别混：
//   · **「留空 = 继承」**（`updatePoints` / `sanitizeContentForSave`）—— 错了的后果是
//     教师改学习单级的档时那些题**不跟随**，而屏幕上没有任何变化；
//   · **「半填拦得住」**（`findPartialPoints` / `save()`）—— 错了的后果是半对**静默变 0 分**。
// 两半都有反证（把实现反转一次、观测到具名的那几条变红），过程写在
// `.superpowers/sdd/2026-09-23-m4a-plan/task-C1-report.md`。

/** 一道带 `points` 的题。`points === undefined` 时**保留那个键**（值为 undefined）——
 *  `reducer` 把两个框清空时产出的就是这个形状，`sanitizeContentForSave` 要处理它。 */
function withPoints(id: string, points: QuestionPointsDraft | undefined): WorksheetQuestionNode {
  return { ...node(id, '题干'), points };
}

/** 多选题 —— 「半对 0 分」那条提示只对它成立。 */
function multiChoice(id: string, partialCredit: unknown, points?: QuestionPointsDraft): WorksheetQuestionNode {
  return {
    id,
    type: 'multi-choice',
    prompt: '题干',
    inputMode: 'keyboard',
    data: {
      options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }],
      correctKeys: ['A'],
      ...(partialCredit === undefined ? {} : { partialCredit }),
    },
    ...(points === undefined ? {} : { points }),
    children: [],
  };
}

test('🔴 updatePoints：两个框都清空 ⇒ `points` 真的是 undefined（留空 = 继承，不是「填了默认档」）', () => {
  const state = createHistory(contentOf(withPoints('q_a', { full: 7, half: 2 })));
  const cleared = contentReducer(state, { kind: 'updatePoints', id: 'q_a', points: undefined });
  assert.equal(cleared.present.nodes[0].points, undefined, 'undefined 才是「跟随学习单级」这个取值本身');
  // 🔴 与「填了一份默认档 1 / 0」**必须分得开**：后者会让教师改学习单级的档时这道题不跟随，
  // 而屏幕上什么都看不出来（服务端 `normalizePoints` 也认这一条：两个字段都无效 ⇒ undefined）。
  assert.notDeepEqual(cleared.present.nodes[0].points, { full: 1, half: 0 });
  assert.equal(cleared.past.length, 1, '清空是一次真实的改动，要进栈');
});

test('🔴 updatePoints 走的是撤销栈，undo 回得去（不是散落的 setState）', () => {
  const initial = contentOf(node('q_a', '题干'));
  const state = contentReducer(createHistory(initial), { kind: 'updatePoints', id: 'q_a', points: { full: 7, half: 2 } });
  assert.deepEqual(state.present.nodes[0].points, { full: 7, half: 2 });
  const undone = contentReducer(state, { kind: 'undo' });
  assert.equal(undone.present, initial, '撤销回到「还没有 points」的那一份');
  assert.deepEqual(contentReducer(undone, { kind: 'redo' }).present.nodes[0].points, { full: 7, half: 2 });
});

test('updatePoints：同值不造历史；半填也照常进栈（每一次击键一条）', () => {
  const state = createHistory(contentOf(withPoints('q_a', { full: 7, half: 2 })));
  assert.equal(
    contentReducer(state, { kind: 'updatePoints', id: 'q_a', points: { full: 7, half: 2 } }),
    state,
    '重新赋成同一对值不该占掉一格撤销（与 updatePrompt 同一条规矩）',
  );
  // 半填是一次**真实**的变化（另一端还没填）—— 它必须能被渲染出来，否则教师刚打的字会消失。
  const partial = contentReducer(state, { kind: 'updatePoints', id: 'q_a', points: { full: 7 } });
  assert.notEqual(partial, state);
  assert.deepEqual(partial.present.nodes[0].points, { full: 7 });
  assert.equal(partial.past.length, 1);
});

test('updatePoints：命中的是那道题，别的题原样不动', () => {
  const other = node('q_b', '另一题');
  const state = createHistory(contentOf(node('q_a', '题干'), other));
  const next = contentReducer(state, { kind: 'updatePoints', id: 'q_a', points: { full: 3, half: 1 } });
  assert.equal(next.present.nodes[1], other);
  assert.deepEqual(next.present.nodes[0].points, { full: 3, half: 1 });
});

test('🔴 sanitizeContentForSave：`points` 为 undefined 时**键被删掉**（不是留一个 undefined）', () => {
  const raw = contentOf(withPoints('q_a', undefined));
  assert.ok('points' in raw.nodes[0], '前提：reducer 把两个框清空时产出的就是这个形状');
  const cleaned = sanitizeContentForSave(raw);
  assert.equal('points' in cleaned.nodes[0], false, '「没有 = 键不存在」这条约定要在**内存里**也成立');
});

test('sanitizeContentForSave：本来就没有 points 的节点返回**同一个对象**（不造空的改动）', () => {
  const clean = contentOf(node('q_a', '题干'));
  assert.equal(sanitizeContentForSave(clean), clean);
});

test('🔴 sanitizeContentForSave：**半填**原样保留（草稿恢复时教师刚打的字不能消失）', () => {
  const cleaned = sanitizeContentForSave(contentOf(withPoints('q_a', { full: 7 })));
  assert.deepEqual(cleaned.nodes[0].points, { full: 7 }, '拦住半填出网的是 save()，不是这个纯清理函数');
});

test('🔴 串起来：`buildPayload` 的产物上仍然看得见半填 —— `save()` 检查的正是它', () => {
  // `save()` 的判据是 `findPartialPoints(payloadRef.current.content)`，而 `payloadRef.current`
  // 就是 `buildPayload` 的产物（已经过 `sanitizeContentForSave`）。这条钉住的是
  // **拦阻点在正确的对象上**：只要 sanitize 哪天「顺手」把半填补成默认档，
  // `save()` 的拦阻就会**静默失效**，而又没有任何用例会红 —— 除非有这一条。
  const payload = buildPayload('标题', '', DEFAULT_SETTINGS, contentOf(withPoints('q_a', { full: 7 })));
  assert.deepEqual(findPartialPoints(payload.content), [{ id: 'q_a', index: 0 }]);
  // 两个框都空（= 跟随学习单）**不是**半填，不该拦住保存。
  const inherited = buildPayload('标题', '', DEFAULT_SETTINGS, contentOf(withPoints('q_b', undefined)));
  assert.deepEqual(findPartialPoints(inherited.content), []);
});

test('🔴 findPartialPoints：只填了一个框的题被找出来，留空 / 两端齐全 / 空对象都不算', () => {
  const content = contentOf(
    withPoints('q_a', { full: 7, half: 2 }),
    withPoints('q_b', { full: 7 }),
    node('q_c', '留空'),
    withPoints('q_d', { half: 2 }),
    withPoints('q_e', {}),
  );
  assert.deepEqual(
    findPartialPoints(content),
    [{ id: 'q_b', index: 1 }, { id: 'q_d', index: 3 }],
    '`{}` 与留空同义（服务端 normalizePoints({}) 也回 undefined），不是「半填」',
  );
  assert.deepEqual(findPartialPoints(createEmptyContent()), []);
});

test('findPartialPoints：只查顶层 —— 嵌套里的题不该让教师卡在一个改不了的红字上', () => {
  // 编辑器的题流只渲染顶层（第一批没有容器编辑 UI，规格 §4.3）。把嵌套里的半填也算进去，
  // 教师会看到「保存失败：第 1 题…」而那棵树里根本没有第 1 题可改 —— 保存按钮就废了。
  const nested: WorksheetContent = {
    schemaVersion: 1,
    nodes: [{ ...node('q_parent', '材料题'), children: [withPoints('q_child', { full: 7 })] }],
  };
  assert.deepEqual(findPartialPoints(nested), []);
});

test('isPartialPoints：判据只有一处 —— undefined 与 `{}` 都不是半填', () => {
  assert.equal(isPartialPoints(undefined), false);
  assert.equal(isPartialPoints({}), false);
  assert.equal(isPartialPoints({ full: 0, half: 0 }), false, '0 是一个填过的值，不是「没填」');
  assert.equal(isPartialPoints({ full: 7 }), true);
  assert.equal(isPartialPoints({ half: 0 }), true, '半对填 0 也算半填 —— 「0 分」是一个决定，不能靠留空表达');
});

test('🔴 parsePointInput：空 / 合法 / 非法三态分清（`Number()` 会骗人的那五个输入）', () => {
  assert.deepEqual(parsePointInput(''), { kind: 'empty' });
  assert.deepEqual(parsePointInput('   '), { kind: 'empty' });
  assert.deepEqual(parsePointInput('0'), { kind: 'value', value: 0 });
  assert.deepEqual(parsePointInput(' 7 '), { kind: 'value', value: 7 });
  assert.deepEqual(parsePointInput(String(POINTS_MAX)), { kind: 'value', value: POINTS_MAX });
  // 🔴 下面这几个**全都是 `Number()` 会当成合法分值**的输入 —— 用 `Number()` 的话，
  // 教师会看到一个自己没填过的数出现在框里，而界面上没有任何提示。
  assert.equal(parsePointInput(String(POINTS_MAX + 1)).kind, 'invalid', '> POINTS_MAX（服务端会静默回落成 1）');
  assert.equal(parsePointInput('-1').kind, 'invalid');
  assert.equal(parsePointInput('7.5').kind, 'invalid', '`Number("7.5")` 是 7.5 —— 不是整数');
  assert.equal(parsePointInput('0x10').kind, 'invalid', '`Number("0x10")` 是 16');
  assert.equal(parsePointInput('1e2').kind, 'invalid', '`Number("1e2")` 是 100');
  assert.equal(parsePointInput('７').kind, 'invalid', '全角数字：教师看着是「7」，`Number` 给 NaN');
  assert.equal(parsePointInput('七').kind, 'invalid');
  assert.equal(parsePointInput('+7').kind, 'invalid');
});

test('🔴 shouldWarnZeroHalfCredit：多选 + 漏选算半对 + 半对档 0 ⇒ 必须提示（规格 §12 裁定 3 的连带）', () => {
  const inherited = { full: 1, half: 0 };
  // —— 提示的两种情形
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'allow-missing'), inherited),
    true,
    '逐题留空 ⇒ 用学习单级的 0：教师以为跟随了「不给部分分」的默认档，其实这题就是不给',
  );
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'allow-missing', { full: 2, half: 0 }), inherited),
    true,
    '逐题把半对填成 0 —— 这就是「教师以为自己开了部分得分」的那一格',
  );
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'allow-missing', {}), inherited),
    true,
    '`{}` 与留空同义（服务端 normalizePoints({}) 也回 undefined）⇒ 按学习单级算',
  );
  // —— 不提示的四种情形（提示多了教师就学会无视它）
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'allow-missing', { full: 2, half: 1 }), inherited),
    false,
    '半对给了正数',
  );
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'allow-missing'), { full: 1, half: 2 }),
    false,
    '学习单级的半对档是 2',
  );
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'all-or-nothing'), inherited),
    false,
    '没选「漏选算半对」—— 这题根本没有部分得分，半对 0 是合法的',
  );
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', undefined), inherited),
    false,
    '缺字段 = 全对才算（认不出的值一律按最严的走）',
  );
  assert.equal(
    shouldWarnZeroHalfCredit({ ...node('q', '题干'), type: 'single-choice' }, inherited),
    false,
    '单选题没有「漏选」这回事 —— 其他题型的部分得分是自动的，半对填 0 是一个合法的选择',
  );
  // 🔴 半填的两半都**不提示**：服务端会把它们补成 0 分，但这道题**存不进去**
  // （`save()` 会拦），而它自己那条「两个框要么都填」的红字更靠前 ——
  // 两条提示挤在一起只会让教师不知道先看哪条。
  //
  // ⚠️ `{ half: 0 }` 这一半是 2026-09-24 审查抓出来的：判据原来只挡住了缺 `half` 的那一半
  // （`points.half === undefined`），于是 `{ half: 0 }` 会算出 0 ⇒ 返回 true，
  // 与本函数的文档**自相矛盾**。今天够不着（编辑器还写不出多选），但 C2 补上多选编辑体之后
  // 就可达：教师在多选卡上先填半对 0、还没填全对 ⇒ 同一张卡两条红字。
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'allow-missing', { full: 2 }), inherited),
    false,
    '缺 half 的那一半',
  );
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'allow-missing', { half: 0 }), inherited),
    false,
    '缺 full 的那一半（`{ half: 0 }` 同样不是「半对档就是 0」，而是「还没填完」）',
  );
});

// ── 12. 修复轮 1（2026-09-24 独立审查实机复现的三条）──────────────────────
//
// 三条都在「教师屏幕上看到的东西 ≠ 将被保存的东西」这同一个面上，而它们的共同点是
// **只看代码看不出来**：审查者是拿 CDP 驱动 headless Chrome 走了一遍才抓到的。
// 所以每一条都在这里落一条纯函数的回归网。

test('🔴 planPointInputChange：非法时**两格都记** —— 教师没碰的那个框不能自己变回去', () => {
  // 审查实测的原始序列：`{全对:4, 半对:2}` → 在全对打 `x`（显示 `x` + 红字）
  // → **接着去动半对填 `3`** → 全对无声地变回 `4`、红字也消失。
  // 原因是 `rejected` 只有一格，第二次写入把第一格的文本顶掉了。
  const node = withPoints('q_a', { full: 4, half: 2 });

  const first = planPointInputChange(node, 'full', 'x', undefined);
  assert.equal(first.kind, 'rejected');
  assert.deepEqual(
    first.kind === 'rejected' ? first.input : null,
    { signature: pointsSignature(node), full: 'x', half: '2' },
    '非法时把**两格当前的文本**都记下来（`half` 那格是它当时显示的值）',
  );

  // 第二步：教师去动半对 —— 用的还是上一步那份 input（组件就是把它原样传回来的）。
  const second = planPointInputChange(node, 'half', '3', first.kind === 'rejected' ? first.input : undefined);
  assert.equal(second.kind, 'rejected');
  assert.deepEqual(
    second.kind === 'rejected' ? second.input : null,
    { signature: pointsSignature(node), full: 'x', half: '3' },
    '🔴 全对那一格仍然是 `x` —— 它没被半对那次改动顶掉',
  );

  // 第三步：教师把全对改回合法值 ⇒ 两格一起提交，半对那个 `3` **不丢**。
  const third = planPointInputChange(node, 'full', '5', second.kind === 'rejected' ? second.input : undefined);
  assert.equal(third.kind, 'commit');
  assert.deepEqual(third.kind === 'commit' ? third.points : null, { full: 5, half: 3 });
});

test('planPointInputChange：两格都空 ⇒ 提交 undefined（= 跟随学习单级，不是 {}）', () => {
  const node = withPoints('q_a', { full: 4, half: 2 });
  assert.deepEqual(planPointInputChange(node, 'full', '', undefined), { kind: 'commit', points: { half: 2 } });
  const both = planPointInputChange(node, 'full', '', { signature: pointsSignature(node), full: '', half: '' });
  assert.deepEqual(both, { kind: 'commit', points: undefined });
});

test('🔴 planPointInputChange：签名不匹配的旧输入**作废**（撤销之后不能被一段早没了的文本拦住）', () => {
  const node = withPoints('q_a', { full: 4, half: 2 });
  const stale: RejectedPointInput = { signature: 'q_a:9/9', full: 'x', half: '9' };
  // 教师现在打一个合法值 ⇒ 旧输入不参与，提交的是「4 / 2 里的 half 加上新值」。
  assert.deepEqual(planPointInputChange(node, 'full', '6', stale), { kind: 'commit', points: { full: 6, half: 2 } });
});

test('pointsSignature：只随 id 与两个数值变（它决定那段输入什么时候失效）', () => {
  assert.equal(pointsSignature(withPoints('q_a', { full: 4, half: 2 })), 'q_a:4/2');
  assert.equal(pointsSignature(withPoints('q_a', { full: 4 })), 'q_a:4/');
  assert.equal(pointsSignature(withPoints('q_a', undefined)), 'q_a:/');
  assert.notEqual(pointsSignature(withPoints('q_a', { full: 4, half: 2 })), pointsSignature(withPoints('q_b', { full: 4, half: 2 })));
});

test('🔴 findInvalidPoints：`points` 里已有一个不是 0–99 整数的值 ⇒ 拦（否则服务端静默换成 1）', () => {
  const content = contentOf(
    withPoints('q_ok', { full: 99, half: 0 }),
    withPoints('q_over', { full: 200, half: 1 }),
    withPoints('q_frac', { full: 7.5, half: 2 }),
    withPoints('q_neg', { full: -1, half: 2 }),
    withPoints('q_both', { full: -1, half: 1000 }),
    node('q_none', '没有 points'),
    withPoints('q_empty', {}),
  );
  assert.deepEqual(
    findInvalidPoints(content),
    [
      { id: 'q_over', index: 1, which: 'full' },
      { id: 'q_frac', index: 2, which: 'full' },
      { id: 'q_neg', index: 3, which: 'full' },
      { id: 'q_both', index: 4, which: 'both' },
    ],
    '⚠️ 7.5 算非法：输入框那一侧的判据（parsePointInput）就不接受小数 —— 让屏幕上打不出来的值落库 = 两套规则',
  );
});

test('🔴 findUncommittedPointInput：屏幕上那段非法文本要拦，且**签名失配就不算数**', () => {
  const node = withPoints('q_a', { full: 4, half: 2 });
  const content = contentOf(node, withPoints('q_b', { full: 1, half: 0 }));

  // 签名匹配 + 有一格非法 ⇒ 命中
  assert.deepEqual(
    findUncommittedPointInput(content, { q_a: { signature: 'q_a:4/2', full: '7.5', half: '2' } }),
    [{ id: 'q_a', index: 0, which: 'full' }],
  );
  // 两格都非法 ⇒ both
  assert.deepEqual(
    findUncommittedPointInput(content, { q_a: { signature: 'q_a:4/2', full: 'x', half: 'y' } }),
    [{ id: 'q_a', index: 0, which: 'both' }],
  );
  // 🔴 签名失配（撤销 / 恢复草稿 / 换题之后）⇒ **不拦** —— 否则教师会被一段屏幕上早已
  // 不存在的文本挡住，而且他没有任何办法让它消失。
  assert.deepEqual(
    findUncommittedPointInput(content, { q_a: { signature: 'q_a:9/9', full: 'x', half: '2' } }),
    [],
  );
  // 两格都合法（方案：非法时连合法的那格也一起记）⇒ 不构成拦阻
  assert.deepEqual(
    findUncommittedPointInput(content, { q_a: { signature: 'q_a:4/2', full: '4', half: '2' } }),
    [],
  );
  assert.deepEqual(findUncommittedPointInput(content, {}), []);
});

test('🔴 串起来（修复轮 1）：非法值在 `buildPayload` 的产物上同样看得见 —— `save()` 拦的就是它', () => {
  // 与上面那条「半填」的串起来同一个理由：只要 `sanitizeContentForSave` 哪天「顺手」
  // 把越界值清掉或改写，`save()` 这两条拦阻就会**静默失效**，而没有用例会红。
  const payload = buildPayload('标题', '', DEFAULT_SETTINGS, contentOf(withPoints('q_a', { full: 200, half: 1 })));
  assert.deepEqual(findInvalidPoints(payload.content), [{ id: 'q_a', index: 0, which: 'full' }]);
  assert.deepEqual(findPartialPoints(payload.content), []);
});

// ── 12. 6 个题型的编辑形状（M4a/C2）──────────────────────────────────────
//
// 这一节盯的是三类**错了不报错**的东西：
//   · `newQuestion` 的初始值里有没有**臆造答案键**（有 ⇒ 教师填完题干忘了配答案
//     ⇒ 一道拿着臆造答案键的题**静默判分**）；
//   · 条目 id 有没有被下标代替 / 有没有在读的时候被重新生成（它是学生作答值里的键）；
//   · 排序题的「学生看到的顺序 ≠ 正确顺序」这条不变量有没有在**每一次结构改动**之后
//     仍然成立（两者相同 ⇒ 学生什么都不做就是满分）。
//
// 需求原文（2026-09-24 更正，见计划 §Task C2 Step 1）：初始 `data` **只给非答案内容占位**，
// 答案键一律留空。

/** 按题型造一道题（上面的 `node()` 恒为 short-answer）。 */
function typed(type: string, data: Record<string, unknown>): WorksheetQuestionNode {
  return { id: `q_${type}`, type, prompt: '题干', inputMode: 'keyboard', data, children: [] };
}

/** 一个条目（id 手写，好断言）。 */
function entry(id: string, text: string): ItemEntry {
  return { id, text };
}

test('🔴 newQuestion：6 个新题型的**答案键一律留空**（臆造答案 ⇒ 一道静默判分的题）', () => {
  // 反向断言：把任何一条改成 `['A']` / `['T']` / identity 配对 / 全部丢进第一个框，
  // 这一条必须变红 —— 而它在屏幕上**看不出来**（教师只填了题干，答案那一栏是预先填好的）。
  assert.deepEqual(newQuestion('true-false').data.correctKeys, []);
  assert.deepEqual(newQuestion('multi-choice').data.correctKeys, []);
  assert.deepEqual(newQuestion('fill-blank').data.answers, []);
  assert.deepEqual(newQuestion('order').data.correctOrder, []);
  assert.deepEqual(newQuestion('match').data.pairs, []);
  assert.deepEqual(newQuestion('categorize').data.placement, {});
  // 与 M3 立的同一条纪律（单选那条注释：「默认选中 A 会安静地把一道没配答案的题变成
  // 『所有选 A 的学生都对』」）—— 判断题/多选题上的理由逐字相同。
  assert.deepEqual(newQuestion('single-choice').data.correctKeys, []);
});

test('newQuestion：**非答案**内容给占位条目（让教师替换，而不是从零填）', () => {
  assert.deepEqual(readOptions(newQuestion('multi-choice')), [
    { key: 'A', text: '选项一' },
    { key: 'B', text: '选项二' },
  ]);
  // ⚠️ 占位条目的文字刻意**不是**「一、二」的升序：`items` 是学生看到的顺序，
  // 而「取当前顺序」会把屏幕上这个顺序变成答案。
  assert.deepEqual(readEntries(newQuestion('order').data.items).map((item) => item.text), ['条目二', '条目一']);
  const match = newQuestion('match');
  assert.deepEqual(readEntries(match.data.left).map((item) => item.text), ['左项一', '左项二']);
  assert.deepEqual(readEntries(match.data.right).map((item) => item.text), ['右项一', '右项二']);
  const categorize = newQuestion('categorize');
  assert.deepEqual(readEntries(categorize.data.items).map((item) => item.text), ['条目一', '条目二']);
  assert.deepEqual(readEntries(categorize.data.zones, 'label').map((item) => item.text), ['框一', '框二']);
});

test('🔴 newQuestion 的填空题仍然是**单空形状**（`blanks` 键不出现），多选带上判分口径', () => {
  const fill = newQuestion('fill-blank');
  assert.deepEqual(fill.data, { answers: [] });
  assert.equal(fillShape(fill), 'single');
  // `correctKeys`/`answers` 那一类**答案键**留空，而 `partialCredit` 不是答案键、是判分口径：
  // 界面上那两个单选按钮要有一个选中态。只能是那两个字面量之一（服务端只认它们）。
  assert.equal(newQuestion('multi-choice').data.partialCredit, 'all-or-nothing');
});

test('🔴 newQuestion 的条目 id：非空、互不相同（重复 = 两个条目在判分里永远只算一个）', () => {
  readEntryIds(newQuestion('order').data.items).forEach((id) => assert.ok(id, 'id 不能是空串'));
  const orderIds = readEntryIds(newQuestion('order').data.items);
  assert.equal(orderIds.length, 2);
  assert.equal(new Set(orderIds).size, 2);

  const match = newQuestion('match');
  const matchIds = [...readEntryIds(match.data.left), ...readEntryIds(match.data.right)];
  assert.equal(matchIds.length, 4);
  assert.equal(new Set(matchIds).size, 4);

  const zones = readEntryIds(newQuestion('categorize').data.zones);
  assert.equal(new Set(zones).size, 2);
});

test('两次 newQuestion 的条目 id 不相同（不重号）', () => {
  const first = readEntryIds(newQuestion('order').data.items);
  const second = readEntryIds(newQuestion('order').data.items);
  assert.equal(first.filter((id) => second.includes(id)).length, 0);
});

test('TRUE_FALSE_OPTIONS 的 key 是协议里的 T/F（改它 = 库里已有的判断题没人答得对）', () => {
  assert.deepEqual(TRUE_FALSE_OPTIONS, [{ key: 'T', text: '对' }, { key: 'F', text: '错' }]);
});

// —— 条目数组的读写容错 ─────────────────────────────────────────────────

test('readEntries 容错：非对象丢掉、text 非字符串当空串、缺 id 读成**空串**', () => {
  assert.deepEqual(
    readEntries([{ id: 'i1', text: '甲' }, null, 42, 'x', { text: '乙' }, { id: 'i3' }, { id: 'i4', text: 7 }]),
    [entry('i1', '甲'), entry('', '乙'), entry('i3', ''), entry('i4', '')],
  );
  assert.deepEqual(readEntries('不是数组'), []);
  assert.deepEqual(readEntries(undefined), []);
  // `zones` 的文案键名是 `label`（服务端读的就是它）
  assert.deepEqual(readEntries([{ id: 'z1', label: '框一' }], 'label'), [entry('z1', '框一')]);
  assert.deepEqual(readEntryIds([{ id: 'i1' }, { text: '没有 id' }, { id: '' }]), ['i1']);
});

test('🔴 writeEntries 给缺 id 的条目补一个（教师动一下列表就能修好一行坏数据）', () => {
  // 读的时候**不补**（每渲染一次换一个 id = 另一种「id 会变」）；写的时候补一次。
  const written = writeEntries([entry('', '甲'), entry('i2', '乙')]);
  assert.equal(written.length, 2);
  assert.equal(written[1].id, 'i2', '已经有 id 的一个字都不许变');
  assert.equal(written[0].text, '甲');
  assert.ok(typeof written[0].id === 'string' && written[0].id !== '', '缺的那一个被补上了');
  // 补出来的 id **不会挪动任何已答数据**：一个没有 id 的条目在学生的作答值里根本没有键。
  assert.deepEqual(writeEntries([entry('z1', '框一')], 'label'), [{ id: 'z1', label: '框一' }]);
});

test('renameEntryAt / readPlacement 的往返与边界', () => {
  const entries = [entry('i1', '甲'), entry('i2', '乙')];
  // 🔴 改文字**不许碰 id**：它是学生作答值里的键（改一次文字就让已答数据全部错位）。
  assert.deepEqual(renameEntryAt(entries, 0, '甲改'), [entry('i1', '甲改'), entry('i2', '乙')]);
  assert.deepEqual(entries.map((item) => item.text), ['甲', '乙'], '不改入参');
  // 缺 id 的条目（id 是空串）按**位置**改，不会一次改掉所有那种行
  assert.deepEqual(renameEntryAt([entry('', '甲'), entry('', '乙')], 1, '乙改'), [entry('', '甲'), entry('', '乙改')]);
  assert.deepEqual(readPlacement({ i1: 'z1', i2: '', i3: 42, i4: 'z2' }), { i1: 'z1', i4: 'z2' });
  assert.deepEqual(readPlacement('不是对象'), {});
  assert.deepEqual(readPlacement(['z1']), {});
});

test('moveIdInList：▲▼ 挪一格；越界 / 未知 id ⇒ **原样返回**（不造无谓的改动）', () => {
  assert.deepEqual(moveIdInList(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveIdInList(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
  const ids = ['a', 'b', 'c'];
  assert.equal(moveIdInList(ids, 'a', -1), ids);
  assert.equal(moveIdInList(ids, 'c', 1), ids);
  assert.equal(moveIdInList(ids, 'nope', 1), ids);
});

// —— 多选题：`writeMultipleOptions` 不截断 ───────────────────────────────

test('🔴 writeMultipleOptions：三个正确答案**全部留下**（单选那条路只留一个）', () => {
  const options = [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }];
  assert.deepEqual(writeMultipleOptions(options, ['A', 'B', 'C']).correctKeys, ['A', 'B', 'C']);
  // 🔴 这条**对照**是上面那句断言的意义所在：没有它，「三个都留下」也可以是一个
  // 什么都没做的实现的产物（而多选直接复用单选那一条路正是「静默丢掉第 2 个答案」的形态）。
  assert.deepEqual(writeOptions(options, ['A', 'B', 'C']).correctKeys, ['A']);
});

test('🔴 writeMultipleOptions 删掉一个选项之后，正确答案仍然落在**同一段文本**上', () => {
  const options = [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }];
  const written = writeMultipleOptions(options.slice(1), ['B', 'C']);
  assert.deepEqual(written.options, [{ key: 'A', text: '乙' }, { key: 'B', text: '丙' }]);
  assert.deepEqual(written.correctKeys, ['A', 'B']);
});

test('writeMultipleOptions：重复 key 只算一次；`correctKeys` 不是数组 ⇒ 空（不抛）', () => {
  const options = [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }];
  assert.deepEqual(writeMultipleOptions(options, ['A', 'A', 'B']).correctKeys, ['A', 'B']);
  assert.deepEqual(writeMultipleOptions(options, 'A').correctKeys, []);
  assert.deepEqual(writeMultipleOptions(options, [1, null, 'B']).correctKeys, ['B']);
});

// —— 填空题：单空 / 多空两种形状 ─────────────────────────────────────────

test('readBlankAnswers：单空 ⇒ **恰好一个**空；多空 ⇒ 每个空一组（坏元素当空答案，不抛）', () => {
  assert.deepEqual(readBlankAnswers(typed('fill-blank', { answers: ['甲', '乙'] })), [['甲', '乙']]);
  assert.deepEqual(readBlankAnswers(typed('fill-blank', { answers: [] })), [[]]);
  assert.deepEqual(readBlankAnswers(typed('fill-blank', { answers: '不是数组' })), [[]]);
  assert.deepEqual(
    readBlankAnswers(typed('fill-blank', { blanks: [{ answers: ['甲'] }, { answers: [] }, { answers: ['丙', '丁'] }] })),
    [['甲'], [], ['丙', '丁']],
  );
  // 零个空（教师把空删光了）⇒ **零行**，不替它造一个教师没建过的空
  assert.deepEqual(readBlankAnswers(typed('fill-blank', { blanks: [] })), []);
  assert.deepEqual(readBlankAnswers(typed('fill-blank', { blanks: [null, { answers: '甲' }, { answers: ['乙'] }] })), [[], [], ['乙']]);
});

test('readBlankText / readFillAnswers：第 N 个空的文本；单空形状逐字不变', () => {
  const multi = typed('fill-blank', { blanks: [{ answers: ['甲', '甲2'] }, { answers: [] }] });
  assert.equal(readBlankText(multi, 0), '甲\n甲2');
  assert.equal(readBlankText(multi, 1), '');
  // 越界 ⇒ 空串（不抛）—— 界面在「＋／🗑」之间会短暂读到刚被删掉的下标
  assert.equal(readBlankText(multi, 9), '');
  assert.equal(readFillAnswers(typed('fill-blank', { answers: ['甲', '乙'] })), '甲\n乙');
  assert.equal(readFillAnswers(typed('fill-blank', { answers: '不是数组' })), '');
  // ★ 本函数改成「第 0 个空」之后，多空形状不再返回空串（旧取值没有任何调用方依赖）
  assert.equal(readFillAnswers(multi), '甲\n甲2');
});

test('🔴 writeBlankText 保持形状：单空写回 `answers`（**不产生 blanks**）、多空写回 `blanks`', () => {
  const single = typed('fill-blank', { answers: ['甲'] });
  const written = writeBlankText(single, 0, '甲\n乙');
  assert.deepEqual(written, { answers: ['甲', '乙'] });
  assert.equal('blanks' in written, false, '打字不能让一道单空题悄悄换形状（库里那份数据换了结构，学生那边也跟着变）');

  const multi = typed('fill-blank', { blanks: [{ answers: ['甲'] }, { answers: ['乙'] }] });
  assert.deepEqual(writeBlankText(multi, 1, '乙\n丙'), { blanks: [{ answers: ['甲'] }, { answers: ['乙', '丙'] }] });
  // 越界 ⇒ 空补丁
  assert.deepEqual(writeBlankText(multi, 5, 'x'), {});
  assert.deepEqual(writeBlankText(single, 1, 'x'), {});
});

test('🔴 addBlank 把单空**升级**成多空：平面的 answers 成为第一个空，且 `answers` 键被置为 undefined', () => {
  const patch = addBlank(typed('fill-blank', { answers: ['甲', '乙'] }));
  assert.deepEqual(patch.blanks, [{ answers: ['甲', '乙'] }, { answers: [] }]);
  // 🔴 两份答案并存会让「哪一份算数」有两个答案（服务端按 `blanks` 走，前端再读 `answers` 就分岔）。
  // ⚠️ 必须是**置 undefined** 而不是「不写这个键」：补丁是 merge，不写就删不掉旧的那个键。
  assert.equal('answers' in patch, true);
  assert.equal(patch.answers, undefined);
});

test('addBlank / removeBlank 的边界：多空追加在末尾；单空删不掉（空补丁，不造「零个空的单空题」）', () => {
  assert.deepEqual(
    addBlank(typed('fill-blank', { blanks: [{ answers: ['甲'] }] })).blanks,
    [{ answers: ['甲'] }, { answers: [] }],
  );
  assert.deepEqual(removeBlank(typed('fill-blank', { answers: ['甲'] }), 0), {});
  assert.deepEqual(removeBlank(typed('fill-blank', { blanks: [{ answers: ['甲'] }] }), 0), {
    blanks: [],
  });
  assert.deepEqual(removeBlank(typed('fill-blank', { blanks: [{ answers: ['甲'] }] }), 9), {});
});

test('🔴 删回一个空**不退回**单空形状（形状只升不降：换形状不带来任何好处，却让它随增删来回变）', () => {
  const removed = removeBlank(typed('fill-blank', { blanks: [{ answers: ['甲'] }, { answers: ['乙'] }] }), 1);
  assert.deepEqual(removed, { blanks: [{ answers: ['甲'] }] });
  assert.equal('answers' in removed, false);
  assert.equal(fillShape(typed('fill-blank', { blanks: [{ answers: ['甲'] }] })), 'multi');
});

// —— 排序题：两个顺序的不变量 ───────────────────────────────────────────

test('🔴 isOrderAmbiguous：**逐位相同**才算「学生什么都不做就是满分」', () => {
  const items = [entry('i1', '一'), entry('i2', '二')];
  assert.equal(isOrderAmbiguous(items, ['i1', 'i2']), true);
  assert.equal(isOrderAmbiguous(items, ['i2', 'i1']), false);
  // 长度不同 / 还没配答案 ⇒ false（那两种情形有它们自己的错，不在这里再说一句）
  assert.equal(isOrderAmbiguous(items, []), false);
  assert.equal(isOrderAmbiguous(items, ['i1']), false);
  // 只有一个条目 ⇒ false（服务端另有「至少两个条目」拦着）
  assert.equal(isOrderAmbiguous([entry('i1', '一')], ['i1']), false);
});

test('🔴 ensureOrderDistinct：相同 ⇒ 挪开；不同 ⇒ **原样返回同一个引用**（不造无谓的改动）', () => {
  const moved = ensureOrderDistinct([entry('i1', '一'), entry('i2', '二')], ['i1', 'i2']);
  assert.deepEqual(moved.map((item) => item.id), ['i2', 'i1']);
  assert.deepEqual(moved.map((item) => item.text), ['二', '一'], 'id 与文字一起搬（id 是键，不能只搬文字）');
  const same = [entry('i1', '一'), entry('i2', '二')];
  assert.equal(ensureOrderDistinct(same, ['i2', 'i1']), same);
});

test('🔴 shuffleOrderItems **保证**结果不等于正确答案的顺序（纯随机洗牌有 1/2 的概率撞上）', () => {
  const items = [entry('i1', '一'), entry('i2', '二')];
  const correctOrder = ['i1', 'i2'];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const shuffled = shuffleOrderItems(items, correctOrder);
    assert.equal(
      isOrderAmbiguous(shuffled, correctOrder),
      false,
      `第 ${attempt} 次洗出了与正确答案相同的顺序 —— 那一刻学生什么都不做就是满分`,
    );
    assert.deepEqual(shuffled.map((item) => item.id).sort(), ['i1', 'i2'], 'id 集合一个都不能变');
  }
});

test('shuffleOrderItems：注入 random 之后可复现（这个保证只能靠用例钉住，组件那层没有回归网）', () => {
  // 常量 0 ⇒ Fisher–Yates 恰好把两个元素换位 ⇒ 与 correctOrder ['i1','i2'] 不同
  const shuffled = shuffleOrderItems([entry('i1', '一'), entry('i2', '二')], ['i1', 'i2'], () => 0);
  assert.deepEqual(shuffled.map((item) => item.id), ['i2', 'i1']);
  // 正确答案**还没配**（[]）时也要能洗 —— 「打乱顺序」在配答案之前就该可用
  assert.deepEqual(shuffleOrderItems([entry('i1', '一'), entry('i2', '二')], [], () => 0).map((item) => item.id), ['i2', 'i1']);
});

test('🔴 orderRemoveItem：删一个条目之后两个顺序**可能碰巧相同** ⇒ 必须挪开（实测的例子）', () => {
  // items=[b,a,c] / correctOrder=[a,c,b]，删掉 b ⇒ 两边都变成 [a,c] —— 那一刻学生什么都不做
  // 就是满分。这不是构造出来的：任何一次删除都可能撞上（而这个状态**没有任何报错**）。
  const removed = orderRemoveItem(
    { items: [entry('b', '乙'), entry('a', '甲'), entry('c', '丙')], correctOrder: ['a', 'c', 'b'] },
    0,
  );
  assert.deepEqual(removed.correctOrder, ['a', 'c']);
  assert.deepEqual(removed.items.map((item) => item.id).sort(), ['a', 'c'], 'id 一个都不能少');
  assert.equal(isOrderAmbiguous(removed.items, removed.correctOrder), false);
  // 越界 ⇒ 原样返回同一个对象（不占撤销栈）
  const state = { items: [entry('a', '甲')], correctOrder: [] };
  assert.equal(orderRemoveItem(state, 9), state);
});

test('orderAddItem：`correctOrder` 还没配过（[]）时**不往里加**；已配时追加到两个列表末尾', () => {
  const unset = orderAddItem({ items: [entry('a', '甲'), entry('b', '乙')], correctOrder: [] }, '丙');
  assert.deepEqual(unset.correctOrder, [], '空数组是「还没配答案」的中间态 —— 塞一个 id 会让那句提示消失，而它其实还是配不全');
  assert.equal(unset.items.length, 3);
  const set = orderAddItem({ items: [entry('b', '乙'), entry('a', '甲')], correctOrder: ['a', 'b'] }, '丙');
  assert.equal(set.correctOrder.length, 3);
  assert.equal(set.correctOrder[2], set.items[2].id, '两个列表追加的是同一个 id');
  assert.equal(isOrderAmbiguous(set.items, set.correctOrder), false);
});

test('🔴 orderUseCurrentOrder：「取当前顺序」不能产出一道**立即无效**的题', () => {
  const items = [entry('i1', '一'), entry('i2', '二'), entry('i3', '三')];
  const next = orderUseCurrentOrder({ items, correctOrder: [] }, () => 0.5);
  assert.deepEqual(next.correctOrder, ['i1', 'i2', 'i3'], '答案就是屏幕上那个顺序');
  assert.deepEqual(next.items.map((item) => item.id).sort(), ['i1', 'i2', 'i3'], 'id 集合不变');

  // 🔴 答案取自 items ⇒ **不打乱的话两者逐位相同**，服务端会拒绝整道题
  //（「请先把条目打乱，或点『打乱顺序』」）—— 教师点一下得到的是一个不能保存的状态。
  //
  // ⚠️ 这里**必须循环跑真随机**，不能只跑一次注入的常量：3 个条目时有 1/6 的概率
  // 恰好洗回原顺序，而那一次就是「教师点了一下、得到一道学生什么都不做就满分的题」。
  // 只跑一次的话，把保证去掉也有一半以上的概率仍然绿 —— 那正是本仓反复出现的**假绿**。
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const each = orderUseCurrentOrder({ items, correctOrder: [] });
    assert.equal(
      isOrderAmbiguous(each.items, each.correctOrder),
      false,
      `第 ${attempt} 次「取当前顺序」得到的是一道学生什么都不做就满分的题`,
    );
  }
});

test('writeOrder：`items` 与 `correctOrder` **一起**写（分开写会有一个答案指着旧 id 的窗口期）', () => {
  const items = [entry('i2', '二'), entry('i1', '一')];
  assert.deepEqual(writeOrder(items, ['i1', 'i2']), {
    items: [{ id: 'i2', text: '二' }, { id: 'i1', text: '一' }],
    correctOrder: ['i1', 'i2'],
  });
});

// —— 连线题 ────────────────────────────────────────────────────────────

test('🔴 matchSetPair：同一个右项只能被一个左项占用（重复连 ⇒ **旧的被顶掉**，不是并存）', () => {
  const pairs = matchSetPair([], 'l1', 'r1');
  assert.deepEqual(pairs, [{ leftId: 'l1', rightId: 'r1' }]);
  // 并存会让服务端的 `isCompleteMatching` 拒绝**整道题**（一个学生都判不了分），
  // 而教师看到的只是两个下拉选着同一个值。
  assert.deepEqual(matchSetPair(pairs, 'l2', 'r1'), [{ leftId: 'l2', rightId: 'r1' }]);
  // 同一个左项改连另一个右项 ⇒ 旧的也去掉
  assert.deepEqual(matchSetPair([{ leftId: 'l2', rightId: 'r1' }], 'l2', 'r2'), [{ leftId: 'l2', rightId: 'r2' }]);
  // 传空串 ⇒ 清掉这一条
  assert.deepEqual(matchSetPair([{ leftId: 'l1', rightId: 'r1' }], 'l1', ''), []);
  // 不改入参
  const source = [{ leftId: 'l1', rightId: 'r1' }];
  matchSetPair(source, 'l1', '');
  assert.deepEqual(source, [{ leftId: 'l1', rightId: 'r1' }]);
});

test('🔴 matchRemoveRow：删一组时，指向这两个 id 的配对**都要清掉**（哪怕它属于别的左项）', () => {
  // 配对与行位置**无关**：被删掉的右项 r1 正是 l2 的答案。留着它，服务端会以
  // 「必须把左栏每一项都连到右栏的一个不同项上」拒绝整道题。
  const odd = {
    left: [entry('l1', '甲'), entry('l2', '乙')],
    right: [entry('r1', 'A'), entry('r2', 'B')],
    pairs: [{ leftId: 'l2', rightId: 'r1' }],
  };
  const removed = matchRemoveRow(odd, 0);
  assert.deepEqual(removed.pairs, []);
  assert.deepEqual(removed.left.map((item) => item.id), ['l2']);
  assert.deepEqual(removed.right.map((item) => item.id), ['r2'], '左右两栏条数必须仍然相同');
  // 越界 ⇒ 原样返回同一个对象
  assert.equal(matchRemoveRow(odd, 9), odd);
});

test('matchAddRow：左右**各加一个**（条数恒等 ⇒ 服务端那条校验在界面上够不着）；新的一对没有配对', () => {
  const added = matchAddRow({
    left: [entry('l1', '甲'), entry('l2', '乙')],
    right: [entry('r1', 'A'), entry('r2', 'B')],
    pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }],
  });
  assert.equal(added.left.length, 3);
  assert.equal(added.right.length, 3);
  assert.deepEqual(added.pairs, [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }], '不臆造一条连线');
  assert.deepEqual(readEntryIds(writeMatch(added.left, added.right, added.pairs).left).length, 3);
});

test('🔴 readMatch / writeMatch：教师侧是 `pairs`、学生侧是 `links`（写反 = 判分永远对不上）', () => {
  const node = typed('match', {
    left: [entry('l1', '甲')],
    right: [entry('r1', 'A')],
    pairs: [{ leftId: 'l1', rightId: 'r1' }],
    // 学生那一侧的键名混进教师的数据里也不会被读成配对
    links: [{ leftId: 'l1', rightId: 'r9' }],
  });
  assert.deepEqual(readMatch(node).pairs, [{ leftId: 'l1', rightId: 'r1' }]);
  assert.deepEqual(writeMatch([entry('l1', '甲')], [entry('r1', 'A')], [{ leftId: 'l1', rightId: 'r1' }]), {
    left: [{ id: 'l1', text: '甲' }],
    right: [{ id: 'r1', text: 'A' }],
    pairs: [{ leftId: 'l1', rightId: 'r1' }],
  });
});

// —— 归类题 ────────────────────────────────────────────────────────────

test('🔴 categorizeRemoveZone：指向它的 `placement` 一起清掉（留着 ⇒ 那个条目永远落不到任何框里）', () => {
  const state = readCategorize(typed('categorize', {
    items: [entry('i1', '甲'), entry('i2', '乙')],
    zones: [{ id: 'z1', label: '框一' }, { id: 'z2', label: '框二' }],
    placement: { i1: 'z2', i2: 'z1' },
  }));
  const removed = categorizeRemoveZone(state, 1);
  assert.deepEqual(removed.zones.map((zone) => zone.id), ['z1']);
  assert.deepEqual(removed.placement, { i2: 'z1' }, 'i1 原本归在框二 ⇒ 它回到「请选择」');
  assert.deepEqual(removed.items.map((item) => item.id), ['i1', 'i2'], '条目一个都不能少');
  assert.equal(categorizeRemoveZone(state, 9), state);
});

test('categorize 的增删与归放：新增的条目**没有**归属；删条目时 `placement` 里那条一起删', () => {
  const state = readCategorize(typed('categorize', {
    items: [entry('i1', '甲')],
    zones: [{ id: 'z1', label: '框一' }, { id: 'z2', label: '框二' }],
    placement: { i1: 'z1' },
  }));
  const added = categorizeAddItem(state, '乙');
  assert.equal(added.items.length, 2);
  assert.deepEqual(added.placement, { i1: 'z1' }, '不替教师臆造一个框');
  assert.equal(Object.keys(added.placement).length, 2 - 1, '新条目没有归属');

  assert.deepEqual(categorizeRemoveItem(state, 0).placement, {}, '删掉的条目在 placement 里那条也要删');
  assert.deepEqual(categorizeRemoveItem(state, 9), state);

  const withZone = categorizeAddZone(state, '框三');
  assert.equal(withZone.zones.length, 3);
  assert.deepEqual(withZone.placement, { i1: 'z1' });

  // 🔴 写回的键名必须与服务端读的一致：条目是 `text`、**框是 `label`**。
  // 把框也写成 `text` 的话校验仍然会过（服务端读 id 与 `label` 两处，`text` 那个键它根本不看），
  // 学生端与预览里**框的名字会全是空的** —— 而没有一处会报错。
  assert.deepEqual(
    writeCategorize([entry('i1', '甲')], [entry('z1', '框一')], { i1: 'z1' }),
    { items: [{ id: 'i1', text: '甲' }], zones: [{ id: 'z1', label: '框一' }], placement: { i1: 'z1' } },
  );

  assert.deepEqual(placementSet({ i1: 'z1' }, 'i1', ''), {});
  assert.deepEqual(placementSet({}, 'i1', 'z2'), { i1: 'z2' });
  assert.deepEqual(placementSet({ i1: 'z1' }, 'i2', 'z1'), { i1: 'z1', i2: 'z1' });
  const source = { i1: 'z1' };
  placementSet(source, 'i1', '');
  assert.deepEqual(source, { i1: 'z1' }, '不改入参');
});

test('🔴 readCategorize / readOrder / readMatch 的容错：形状不对给空值，**不抛**（渲染路径）', () => {
  const weird = typed('categorize', { items: 'x', zones: 42, placement: 'y' });
  assert.deepEqual(readCategorize(weird), { items: [], zones: [], placement: {} });
  assert.deepEqual(readOrder(typed('order', { items: null, correctOrder: 'x' })), { items: [], correctOrder: [] });
  assert.deepEqual(readMatch(typed('match', { left: {}, right: 7, pairs: 'x' })), { left: [], right: [], pairs: [] });
  // `correctOrder` 里的空串/非字符串元素被丢掉（服务端 `readStrings` 同形）
  assert.deepEqual(readOrder(typed('order', { items: [], correctOrder: ['', 42, 'i1'] })).correctOrder, ['i1']);
  // 连线题的坏配对（缺一端）丢掉，而不是留下一个 `rightId: undefined`
  assert.deepEqual(readMatch(typed('match', { pairs: [{ leftId: 'l1' }, { rightId: 'r1' }, { leftId: 'l1', rightId: 'r1' }] })).pairs, [
    { leftId: 'l1', rightId: 'r1' },
  ]);
});

test('🔴 readCorrectKeys：空串与坏元素丢掉（服务端 `readStrings` 同一条口径）', () => {
  assert.deepEqual(readCorrectKeys(typed('multi-choice', { correctKeys: ['A', '', 42, 'B'] })), ['A', 'B']);
  assert.deepEqual(readCorrectKeys(typed('multi-choice', { correctKeys: 'A' })), []);
  assert.deepEqual(readCorrectKeys(typed('multi-choice', {})), []);
});
