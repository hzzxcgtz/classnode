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
// ★ C3：设置面板那两个下拉的**选项清单**。⚠️ 运行时 import 必须是**相对路径 + `.ts` 后缀**
// （Node 解析不了 `@/…`，见 `worksheet-editor-core.ts` 的文件头）——
// 与 `worksheet-drawer-state.test.ts` 引 `lib/worksheet-questions.ts` 是同一个写法。
import { HALF_STEPS, REWARD_STEPS } from '../../../../lib/worksheet-reward.ts';
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
  canGivePartial,
  displayPoints,
  draftKeyFor,
  editorRenderBlocks,
  editorRenderRows,
  ensureEntryIds,
  ensureOrderDistinct,
  fillShape,
  findInvalidPoints,
  findPartialPoints,
  findUncommittedPointInput,
  gradesOnSubmit,
  toleranceOf,
  HISTORY_LIMIT,
  isOrderAmbiguous,
  isGradedQuestionType,
  isOrderAnswerUsable,
  isPartialPoints,
  type ItemEntry,
  matchAddRow,
  matchPairLeftRow,
  matchRemoveRow,
  matchSetPair,
  MAX_OPTIONS,
  moveIdInList,
  newQuestion,
  nextTaskTitle,
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
  POINTS_FULL_MIN,
  POINTS_MAX,
  pointsSignature,
  type QuestionPointsDraft,
  QUESTION_TYPE_OPTIONS,
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

function node(id: string, prompt = '', data: Record<string, unknown> = {}, type = 'short-answer', correctKeys?: string[]): WorksheetQuestionNode {
  const withKeys = correctKeys === undefined ? data : { ...data, correctKeys };
  return { id, type, prompt, inputMode: 'keyboard', data: withKeys, children: [] };
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
  analysisAgentId: null,
  rewardStep: 1,
  // 刻意给一个**非默认**的部分给分档（默认是 0）：这一份 `SETTINGS` 是「保存载荷」那一组用例
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
    // 解析时丢掉，教师恢复一次草稿就会发现自己的「花朵 ×5、部分给分 0」变回了星星。
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
    analysisAgentId: null,   // ★ M7b：第七个键（规格 §3.2）
  });
});

test('🔴 parseDraft：草稿里的 `halfStep` 被**原样读进来**（漏读 ⇒ 恢复草稿就把部分给分档抹成 0）', () => {
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
    analysisAgentId: null,   // ★ M7b：库里没有这一格 ⇒ `null`（= 没指定），不是 `undefined`
  });
  // ★ M7b：**真的 id 必须原样带过来** —— 这条用例的主题就是「漏一个键 = 一次只改标题的保存
  // 把它清掉」，而分析智能体是最新加入这一类键的那一个（同 `halfStep` 当年的处境）。
  const withAgent = normalizeLoadedSettings({
    allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard', rewardStyle: 'star', rewardStep: 1, halfStep: 0,
    analysisAgentId: 'agent-xyz',
  });
  assert.equal(withAgent.analysisAgentId, 'agent-xyz', '配好的分析智能体不能被一次「只改标题」的保存清掉');
  assert.equal(normalizeLoadedSettings({ analysisAgentId: '' }).analysisAgentId, null, '空串 ⇒ null（与服务端同一判据）');
  // 坏值回落到与取值域同一份默认（不是就地编一个第五档）
  assert.equal(normalizeLoadedSettings({ rewardStyle: '彩虹' }).rewardStyle, DEFAULT_SETTINGS.rewardStyle);
  assert.equal(normalizeLoadedSettings({ rewardStep: 4 }).rewardStep, DEFAULT_SETTINGS.rewardStep);
  assert.equal(normalizeLoadedSettings({ rewardStep: '3' }).rewardStep, DEFAULT_SETTINGS.rewardStep);
  // ★ 部分给分档：0 是**合法值**（要原样带过来），4 是越界值（回落到 0）。
  //   ⚠️ 这里**不能**用 `normalizeRewardStep` —— 它的域不含 0，会把「部分给分 0」变成 1，
  //   而 0 恰恰是新单的默认值（规格 §12 裁定 3），也就是最常见的那个取值。
  assert.equal(normalizeLoadedSettings({ halfStep: 0 }).halfStep, 0, '0 是配过的部分给分档，不是缺字段');
  assert.equal(normalizeLoadedSettings({ halfStep: 5 }).halfStep, 5);
  assert.equal(normalizeLoadedSettings({ halfStep: 4 }).halfStep, DEFAULT_SETTINGS.halfStep);
  assert.equal(normalizeLoadedSettings({ halfStep: '3' }).halfStep, DEFAULT_SETTINGS.halfStep);
  assert.notEqual(DEFAULT_SETTINGS.halfStep, DEFAULT_SETTINGS.rewardStep, '两档的默认值不同（0 与 1），别互换');
});

// ── 10b. 设置面板的那两行步长（M4a / C3）────────────────────────────────
//
// C3 之前，学习单级的部分给分档在服务端与内核里都通了、**却没有 UI** ⇒ 它恒为默认值 0。
// 加那一行改的是 `page.tsx` 里的 JSX（**组件层没有回归网**，本仓没有 jsdom），
// 所以这里钉的是它必须成立的两条**纯逻辑**不变式 —— 两条都「错了不报错」：
//   · 受控 `<select>` 的值不在 `<option>` 里 ⇒ 显示的是**另一个档**，而保存载荷是原值；
//   · 面板每改一个键就整份发一遍 `settings`（`PUT /:id` 是整份替换）⇒ 少一个键就被抹掉。

test('🔴 C3：两个步长下拉的选项必须覆盖内核能产出的每一个值（不在选项里的值会显示成别的档）', () => {
  // 设置面板那两个 `<select>` 是**受控**的：`value={settings.halfStep}`。这个值不在
  // `<option>` 里时，浏览器**显示第一个选项**（看起来就是选中了它），而 React 的 state
  // 与保存载荷仍是原来那个数 —— 屏幕上的档与存进库里的档不是同一个，且没有任何报错。
  // 所以「下拉的选项」与「归一化能产出的值」必须是同一个集合，这条不变式今天别处没有钉着。
  for (const bad of [undefined, null, '3', 4, 7, -1, 2.5, Number.NaN, Infinity]) {
    const half = normalizeLoadedSettings({ halfStep: bad }).halfStep;
    assert.ok(HALF_STEPS.includes(half), `部分给分档归一化产出的 ${String(half)} 必须能在下拉里被选中`);
    const full = normalizeLoadedSettings({ rewardStep: bad }).rewardStep;
    assert.ok(REWARD_STEPS.includes(full), `全对档归一化产出的 ${String(full)} 必须能在下拉里被选中`);
  }
  // 默认值同样必须在下拉里 —— 新建的学习单打开设置面板时，显示的就是它。
  assert.ok(HALF_STEPS.includes(DEFAULT_SETTINGS.halfStep));
  assert.ok(REWARD_STEPS.includes(DEFAULT_SETTINGS.rewardStep));
  // 🔴 两个下拉的选项**不是同一个数组**：部分给分档多一个 `0`。合并它们会二选一地出错 ——
  // `0` 要么从部分给分档里消失（教师配不了「这单不给部分分」，而那正是新单的默认值），
  // 要么混进全对档（「答对一题得 0 个」）。
  assert.ok(HALF_STEPS.includes(0) && !REWARD_STEPS.includes(0), '部分给分档含 0、全对档不含 0');
  assert.deepEqual(HALF_STEPS.filter(step => step !== 0), [...REWARD_STEPS], '两个域除 0 之外应当逐字相同');
});

test('🔴 C3：一份完整的 settings 走「保存载荷 → JSON 往返 → 读回来」之后逐字不变（**七个键**一个都不能少）', () => {
  // 🔴 **这条用例钉的是哪一层，名字里就说清哪一层**（2026-09-24 修复轮 1 改名，原名是
  // 「面板改一个键 ⇒ 收回来仍是完整一份 settings」—— 那是**过宽**的：它没管「面板改一个键」
  // 那一步）。它钉的是：**任何一份完整的 settings，走「保存载荷 → JSON 往返 → 读回来」
  // 之后逐字不变** —— 少任何一个键，`PUT /:id` 都会把它在库里抹成默认值，而屏幕上没有任何
  // 提示（B2 与 C3 各修过一次这类静默抹除）。
  //
  // ⚠️ **面板真正的那一步不在这条用例的射程内**：`use-worksheet-editor.ts` 里
  // `setSettings(previous => ({ ...previous, ...patch }))` 所在的那一层是 React hook，
  // `node --test` 根本加载不了它（本仓没有 jsdom / testing-library，规格 §11）。
  // 把它换成 `setSettings(patch)` —— **正是 B2 修过的那种静默抹除** —— 这 207 条**照样全绿**。
  // 想盖住它得先给本仓装测试框架，那是另一个决定；在那之前，这一层是**知情的**缺口
  // （报告第五节第 2 条已记），不是被这条用例盖住的。
  // 下面这几份 `patched` 的形状仍然是与「面板合过一个补丁之后那一份」逐字同形的。
  const patched: WorksheetSettings[] = [
    { ...DEFAULT_SETTINGS, rewardStyle: 'flower' }, // 面板第 1 行：奖励形式
    { ...DEFAULT_SETTINGS, rewardStep: 5 },         // 面板第 2 行：全对档
    { ...DEFAULT_SETTINGS, halfStep: 5 },           // 面板第 3 行：部分给分档（C3 新增的那一行）
    // ⚠️ `0` 单列一条：它既是**合法档**又恰好等于默认值 0 ⇒ 光看上面那条 `5`，
    // 「原样读回来了」与「回落成默认了」是同一个观测（误用 `normalizeRewardStep`
    // 会把 0 变成 1，也只有这一条抓得住）。
    { ...DEFAULT_SETTINGS, halfStep: 0 },
    { ...DEFAULT_SETTINGS, allowResubmit: false },
    { ...DEFAULT_SETTINGS, autoGrade: false },
  ];
  for (const settings of patched) {
    const payload = buildPayload('标题', '说明', settings, createEmptyContent());
    // JSON 往返 = 过线缆那一步；`undefined` 的键在这里被丢掉，与真实 PUT 一致。
    const roundTripped = normalizeLoadedSettings(JSON.parse(JSON.stringify(payload.settings)));
    assert.deepEqual(roundTripped, settings, `往返之后必须逐字不变：${JSON.stringify(settings)}`);
    assert.equal(Object.keys(roundTripped).length, 7, '七个键一个都不能少（M7b 加了 analysisAgentId）');
  }
  // 而 `undefined` **不是**「配过的值」：整份对象缺这个键时它回落到默认（这两件事必须分得开）。
  assert.equal(normalizeLoadedSettings({ ...DEFAULT_SETTINGS, halfStep: undefined }).halfStep, DEFAULT_SETTINGS.halfStep);
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
//   · **「半填拦得住」**（`findPartialPoints` / `save()`）—— 错了的后果是部分给分**静默变 0 分**。
// 两半都有反证（把实现反转一次、观测到具名的那几条变红），过程写在
// `.superpowers/sdd/2026-09-23-m4a-plan/task-C1-report.md`。

/** 一道带 `points` 的题。`points === undefined` 时**保留那个键**（值为 undefined）——
 *  `reducer` 把两个框清空时产出的就是这个形状，`sanitizeContentForSave` 要处理它。 */
function withPoints(id: string, points: QuestionPointsDraft | undefined): WorksheetQuestionNode {
  return { ...node(id, '题干'), points };
}

/** 多选题 —— 「部分给分 0 分」那条提示只对它成立。 */
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
  assert.deepEqual(findPartialPoints(payload.content), [{ id: 'q_a', heading: '1' }]);
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
    [{ id: 'q_b', heading: '2' }, { id: 'q_d', heading: '4' }],
    '`{}` 与留空同义（服务端 normalizePoints({}) 也回 undefined），不是「半填」',
  );
  assert.deepEqual(findPartialPoints(createEmptyContent()), []);
});

test('🔴 findPartialPoints：嵌套里的题**也要查** —— 它那条「只查顶层」的理由已经失效', () => {
  // ⚠️ 本条 2026-09-25 **反转**。原断言是 `deepEqual(findPartialPoints(nested), [])`，
  // 理由逐字写着：「编辑器的题流只渲染顶层（第一批没有容器编辑 UI，规格 §4.3）。
  // 把嵌套里的半填也算进去，教师会看到「保存失败：…」而那棵树里根本没有那一题可改
  // —— 保存按钮就废了。」
  //
  // 🔴 那个前提**在第 2 步的迁移之后不成立**：库里的题**都在任务里**，而编辑页现在把它们
  // 画出来、也改得动（`TaskCard`）。继续「只查顶层」的后果反过来变成了：
  // 任务里一道半填的题**拦不住保存** ⇒ 服务端把 `half` 补成 **0**（不是跟随学习单级）
  // ⇒ 教师以为部分给分还在跟随，而学生在部分给分那一档**只拿 0 分**，全程无报错。
  const nested: WorksheetContent = {
    schemaVersion: 1,
    nodes: [{ ...node('q_parent', '材料题'), children: [withPoints('q_child', { full: 7 })] }],
  };
  assert.deepEqual(findPartialPoints(nested), [{ id: 'q_child', heading: '2' }]);
});

test('isPartialPoints：判据只有一处 —— undefined 与 `{}` 都不是半填', () => {
  assert.equal(isPartialPoints(undefined), false);
  assert.equal(isPartialPoints({}), false);
  assert.equal(isPartialPoints({ full: 0, half: 0 }), false, '0 是一个填过的值，不是「没填」');
  assert.equal(isPartialPoints({ full: 7 }), true);
  assert.equal(isPartialPoints({ half: 0 }), true, '部分给分填 0 也算半填 —— 「0 分」是一个决定，不能靠留空表达');
});

test('🔴 parsePointInput：空 / 合法 / 非法三态分清（`Number()` 会骗人的那五个输入）', () => {
  assert.deepEqual(parsePointInput('', 'half'), { kind: 'empty' });
  assert.deepEqual(parsePointInput('   ', 'half'), { kind: 'empty' });
  assert.deepEqual(parsePointInput('0', 'half'), { kind: 'value', value: 0 }, '部分给分 0 = 不给部分分，合法');
  assert.deepEqual(parsePointInput(' 7 ', 'half'), { kind: 'value', value: 7 });
  assert.deepEqual(parsePointInput(String(POINTS_MAX), 'half'), { kind: 'value', value: POINTS_MAX });
  assert.deepEqual(parsePointInput(String(POINTS_MAX), 'full'), { kind: 'value', value: POINTS_MAX });
  // 🔴 ★ M4a/I1：**两档的域不同** —— 同一个 `'0'`，部分给分合法、全对非法。
  // 全对填 0 的后果是「答对了却给 0 分」：学生端对错档按 `score >= 1` 画 ⇒ 红叉，
  // 而教师抽屉读 `gradeState` ⇒ 绿 `✓ 答对`。域的理由在 `POINTS_FULL_MIN` 上。
  assert.equal(parsePointInput('0', 'full').kind, 'invalid', '`full: 0` 当场判非法（不是等保存才报）');
  assert.deepEqual(parsePointInput(String(POINTS_FULL_MIN), 'full'), { kind: 'value', value: POINTS_FULL_MIN },
    '下界本身合法');
  assert.equal(parsePointInput(String(POINTS_FULL_MIN), 'half').kind, 'value');
  // 🔴 下面这几个**全都是 `Number()` 会当成合法分值**的输入 —— 用 `Number()` 的话，
  // 教师会看到一个自己没填过的数出现在框里，而界面上没有任何提示。
  assert.equal(parsePointInput(String(POINTS_MAX + 1), 'full').kind, 'invalid', '> POINTS_MAX（服务端会静默回落成 1）');
  assert.equal(parsePointInput(String(POINTS_MAX + 1), 'half').kind, 'invalid');
  assert.equal(parsePointInput('-1', 'half').kind, 'invalid');
  assert.equal(parsePointInput('-1', 'full').kind, 'invalid');
  assert.equal(parsePointInput('7.5', 'half').kind, 'invalid', '`Number("7.5")` 是 7.5 —— 不是整数');
  assert.equal(parsePointInput('0x10', 'half').kind, 'invalid', '`Number("0x10")` 是 16');
  assert.equal(parsePointInput('1e2', 'half').kind, 'invalid', '`Number("1e2")` 是 100');
  assert.equal(parsePointInput('７', 'half').kind, 'invalid', '全角数字：教师看着是「7」，`Number` 给 NaN');
  assert.equal(parsePointInput('七', 'half').kind, 'invalid');
  assert.equal(parsePointInput('+7', 'half').kind, 'invalid');
});

test('🔴 shouldWarnZeroHalfCredit：多选 + 漏选算部分给分 + 部分给分档 0 ⇒ 必须提示（规格 §12 裁定 3 的连带）', () => {
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
    '逐题把部分给分填成 0 —— 这就是「教师以为自己开了部分得分」的那一格',
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
    '部分给分给了正数',
  );
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'allow-missing'), { full: 1, half: 2 }),
    false,
    '学习单级的部分给分档是 2',
  );
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'all-or-nothing'), inherited),
    false,
    '没选「漏选算部分给分」—— 这题根本没有部分得分，部分给分 0 是合法的',
  );
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', undefined), inherited),
    false,
    '缺字段 = 全对才算（认不出的值一律按最严的走）',
  );
  assert.equal(
    shouldWarnZeroHalfCredit({ ...node('q', '题干'), type: 'single-choice' }, inherited),
    false,
    '单选题没有「漏选」这回事 —— 其他题型的部分得分是自动的，部分给分填 0 是一个合法的选择',
  );
  // 🔴 半填的两半都**不提示**：服务端会把它们补成 0 分，但这道题**存不进去**
  // （`save()` 会拦），而它自己那条「两个框要么都填」的红字更靠前 ——
  // 两条提示挤在一起只会让教师不知道先看哪条。
  //
  // ⚠️ `{ half: 0 }` 这一半是 2026-09-24 审查抓出来的：判据原来只挡住了缺 `half` 的那一半
  // （`points.half === undefined`），于是 `{ half: 0 }` 会算出 0 ⇒ 返回 true，
  // 与本函数的文档**自相矛盾**。今天够不着（编辑器还写不出多选），但 C2 补上多选编辑体之后
  // 就可达：教师在多选卡上先填部分给分 0、还没填全对 ⇒ 同一张卡两条红字。
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'allow-missing', { full: 2 }), inherited),
    false,
    '缺 half 的那一半',
  );
  assert.equal(
    shouldWarnZeroHalfCredit(multiChoice('q', 'allow-missing', { half: 0 }), inherited),
    false,
    '缺 full 的那一半（`{ half: 0 }` 同样不是「部分给分档就是 0」，而是「还没填完」）',
  );
});

// ── 12. 修复轮 1（2026-09-24 独立审查实机复现的三条）──────────────────────
//
// 三条都在「教师屏幕上看到的东西 ≠ 将被保存的东西」这同一个面上，而它们的共同点是
// **只看代码看不出来**：审查者是拿 CDP 驱动 headless Chrome 走了一遍才抓到的。
// 所以每一条都在这里落一条纯函数的回归网。

test('🔴 planPointInputChange：非法时**两格都记** —— 教师没碰的那个框不能自己变回去', () => {
  // 审查实测的原始序列：`{全对:4, 部分给分:2}` → 在全对打 `x`（显示 `x` + 红字）
  // → **接着去动部分给分填 `3`** → 全对无声地变回 `4`、红字也消失。
  // 原因是 `rejected` 只有一格，第二次写入把第一格的文本顶掉了。
  const node = withPoints('q_a', { full: 4, half: 2 });

  const first = planPointInputChange(node, 'full', 'x', undefined);
  assert.equal(first.kind, 'rejected');
  assert.deepEqual(
    first.kind === 'rejected' ? first.input : null,
    { signature: pointsSignature(node), full: 'x', half: '2' },
    '非法时把**两格当前的文本**都记下来（`half` 那格是它当时显示的值）',
  );

  // 第二步：教师去动部分给分 —— 用的还是上一步那份 input（组件就是把它原样传回来的）。
  const second = planPointInputChange(node, 'half', '3', first.kind === 'rejected' ? first.input : undefined);
  assert.equal(second.kind, 'rejected');
  assert.deepEqual(
    second.kind === 'rejected' ? second.input : null,
    { signature: pointsSignature(node), full: 'x', half: '3' },
    '🔴 全对那一格仍然是 `x` —— 它没被部分给分那次改动顶掉',
  );

  // 第三步：教师把全对改回合法值 ⇒ 两格一起提交，部分给分那个 `3` **不丢**。
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

test('🔴 findInvalidPoints：`points` 里已有一个非法分值 ⇒ 拦（否则服务端静默换成 1，或直接 400）', () => {
  const content = contentOf(
    withPoints('q_ok', { full: 99, half: 0 }),
    withPoints('q_full_zero', { full: 0, half: 2 }),
    withPoints('q_over', { full: 200, half: 1 }),
    withPoints('q_frac', { full: 7.5, half: 2 }),
    withPoints('q_neg', { full: -1, half: 2 }),
    withPoints('q_half_zero', { full: 2, half: 0 }),
    withPoints('q_both', { full: 0, half: 1000 }),
    node('q_none', '没有 points'),
    withPoints('q_empty', {}),
  );
  assert.deepEqual(
    findInvalidPoints(content),
    [
      { id: 'q_full_zero', heading: '2', which: 'full' },
      { id: 'q_over', heading: '3', which: 'full' },
      { id: 'q_frac', heading: '4', which: 'full' },
      { id: 'q_neg', heading: '5', which: 'full' },
      { id: 'q_both', heading: '7', which: 'both' },
    ],
    '⚠️ 7.5 算非法：输入框那一侧的判据（parsePointInput）就不接受小数 —— 让屏幕上打不出来的值落库 = 两套规则',
  );
  // ★ M4a/I1：`full: 0` 也在这一条里（域是 1..99），而 `half: 0` **不在**
  //（`q_ok` 与 `q_half_zero` 都没出现在上面那张名单里）。
  // 这两个方向都必须钉住：把 `half: 0` 顺手挡掉 ⇒ 教师配的「不给部分分」变成一条改不掉的红字；
  // 不挡 `full: 0` ⇒ 服务端 400，而教师点了保存才知道。
});

test('🔴 findUncommittedPointInput：屏幕上那段非法文本要拦，且**签名失配就不算数**', () => {
  const node = withPoints('q_a', { full: 4, half: 2 });
  const content = contentOf(node, withPoints('q_b', { full: 1, half: 0 }));

  // 签名匹配 + 有一格非法 ⇒ 命中
  assert.deepEqual(
    findUncommittedPointInput(content, { q_a: { signature: 'q_a:4/2', full: '7.5', half: '2' } }),
    [{ id: 'q_a', heading: '1', which: 'full' }],
  );
  // 两格都非法 ⇒ both
  assert.deepEqual(
    findUncommittedPointInput(content, { q_a: { signature: 'q_a:4/2', full: 'x', half: 'y' } }),
    [{ id: 'q_a', heading: '1', which: 'both' }],
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
  // ★ M4a/I1：屏幕上的文本按**各自那一档**的域判 —— 同一个 `'0'`，全对那格算非法、部分给分那格不算。
  assert.deepEqual(
    findUncommittedPointInput(content, { q_a: { signature: 'q_a:4/2', full: '0', half: '2' } }),
    [{ id: 'q_a', heading: '1', which: 'full' }],
    '全对填 0 ⇒ 当场非法，且保存被拦住（服务端也会 400）',
  );
  assert.deepEqual(
    findUncommittedPointInput(content, { q_a: { signature: 'q_a:4/2', full: '4', half: '0' } }),
    [],
    '部分给分填 0 合法（= 不给部分分）—— 它的 0 不该拦住保存',
  );
  assert.deepEqual(findUncommittedPointInput(content, {}), []);
});

test('🔴 串起来（修复轮 1）：非法值在 `buildPayload` 的产物上同样看得见 —— `save()` 拦的就是它', () => {
  // 与上面那条「半填」的串起来同一个理由：只要 `sanitizeContentForSave` 哪天「顺手」
  // 把越界值清掉或改写，`save()` 这两条拦阻就会**静默失效**，而没有用例会红。
  const payload = buildPayload('标题', '', DEFAULT_SETTINGS, contentOf(withPoints('q_a', { full: 200, half: 1 })));
  assert.deepEqual(findInvalidPoints(payload.content), [{ id: 'q_a', heading: '1', which: 'full' }]);
  assert.deepEqual(findPartialPoints(payload.content), []);
  // ★ M4a/I1：`full: 0` 走的是**同一条**拦阻 —— 它在 `buildPayload`（sanitize 的唯一出网点）
  // 之后仍然看得见。少这一条的话，「把 0 顺手清成 undefined」那种改法不会红。
  const zeroPayload = buildPayload('标题', '', DEFAULT_SETTINGS, contentOf(withPoints('q_a', { full: 0, half: 0 })));
  assert.deepEqual(findInvalidPoints(zeroPayload.content), [{ id: 'q_a', heading: '1', which: 'full' }]);
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

test('🔴 ensureEntryIds：只给**缺 id** 的补，有 id 的原样留着（返回新数组，不改入参）', () => {
  const source: ItemEntry[] = [entry('i1', '一'), { id: '', text: '二' }, entry('i3', '三')];
  const next = ensureEntryIds(source);
  assert.notEqual(next, source, '返回新数组');
  assert.equal(next[0], source[0], '有 id 的条目引用都不变 —— 不造无谓的改动');
  assert.equal(next[2], source[2]);
  assert.equal(next[1].id.length > 0, true, '缺 id 的补一个');
  assert.deepEqual(source[1], { id: '', text: '二' }, '不改入参');
  assert.deepEqual(next.map((item) => item.text), ['一', '二', '三'], '文字与顺序一个都不动');
  // 两个都缺 ⇒ 拿到**不同**的 id（同一个 id 会让服务端以「有重复的条目 id」拒绝整道题）
  const two = ensureEntryIds([{ id: '', text: '甲' }, { id: '', text: '乙' }]);
  assert.equal(new Set(two.map((item) => item.id)).size, 2);
});

test('🔴 isOrderAnswerUsable：`correctOrder` 必须是这些条目 id 的**排列**才算能用', () => {
  const items = [entry('a', '甲'), entry('b', '乙')];
  assert.equal(isOrderAnswerUsable(items, ['a', 'b']), true);
  assert.equal(isOrderAnswerUsable(items, ['b', 'a']), true, '顺序本身随意 —— 只要正好各一次');
  // 还没配过
  assert.equal(isOrderAnswerUsable(items, []), false);
  // 🔴 「两个空串」—— 老实现（用 `items.map(e=>e.id)` 造答案、条目缺 id）写进库里的那种行。
  // 它是「不是排列」里最隐蔽的形态：**看起来**是配过的（长度也对得上）。
  assert.equal(isOrderAnswerUsable([entry('', '甲'), entry('', '乙')], ['', '']), false);
  // 🔴 **非空但不合法**：老判据（`correctOrder.length === 0` 才渲染修复按钮）在这些行上
  // 没有留下任何修复入口 —— 实测「加一个条目 / 删一个条目」都救不回来（见报告）。
  assert.equal(isOrderAnswerUsable(items, ['a', 'a']), false, '有重复');
  assert.equal(isOrderAnswerUsable(items, ['a']), false, '长度对不上');
  assert.equal(isOrderAnswerUsable(items, ['a', 'zzz']), false, '指向一个不存在的条目 id');
  // 条目缺 id：服务端以「排序题里有条目缺少 id」拦下 —— 任何 `correctOrder` 都救不了它，
  // 所以界面必须留着「取当前顺序」（它会把 id 补齐）
  assert.equal(isOrderAnswerUsable([entry('', '甲'), entry('b', '乙')], ['b']), false);
  // 少于两个条目：服务端另有「至少需要两个条目」，这时按钮本来就按不动（disabled）
  assert.equal(isOrderAnswerUsable([entry('a', '甲')], ['a']), false);
});

test('🔴 缺 id 的坏行点「取当前顺序」：答案键落在**补好的** id 上（空串答案 = 存不下也修不好）', () => {
  // 2026-09-24 审查报的原始缺陷（我在 9377e87 的内核上逐字复现过）：
  // 老实现用 `items.map(e => e.id)` 造答案，而 `readEntries` 把缺 id 读成空串 ⇒ 答案是 `['','']`；
  // 写回时 `writeEntries` 给条目补了**全新的** id，那两个空串却永远指不到任何条目：
  //   取当前顺序后 correctOrder = ["",""] · 再加一个条目 = ["","","i_…"] · 删一个条目 = ["",""]
  // 而服务端 `readStrings` 丢掉空串 ⇒ 那道题永远过不了「正确顺序必须正好是这些条目各一次」。
  const broken = { items: [{ id: '', text: '甲' }, { id: '', text: '乙' }], correctOrder: [] };
  const next = orderUseCurrentOrder(broken, () => 0.5);
  const patch = writeOrder(next.items, next.correctOrder);
  const ids = (patch.items as ItemEntry[]).map((item) => item.id);
  const written = patch.correctOrder as string[];
  assert.equal(written.includes(''), false, '答案里不能再有空串');
  assert.deepEqual([...written].sort(), [...ids].sort(), 'correctOrder 必须正好是 items 的 id 各一次');
  // ⚠️ 判据要吃**读回界面**之后的形状（组件的判据是 `readOrder` 之后的那个对象）
  const readBack = readOrder(typed('order', patch));
  assert.equal(isOrderAnswerUsable(readBack.items, readBack.correctOrder), true, '一次点击就离开僵局');
  assert.deepEqual(readBack.correctOrder, written, '写—读往返里答案键一个都不变');
  // 补过 id 的条目在被重设答案时**id 不被换掉**（`writeEntries` 那侧对已有 id 是恒等的）
  // —— 否则「取当前顺序」会把学生已经答过的那道题的键全部作废。
  const settled = typed('order', { items: [{ id: 'i_x', text: '甲' }, { id: 'i_y', text: '乙' }], correctOrder: ['', ''] });
  const repaired = orderUseCurrentOrder(readOrder(settled), () => 0.5);
  const repairedPatch = writeOrder(repaired.items, repaired.correctOrder);
  assert.deepEqual(repairedPatch.correctOrder as string[], ['i_x', 'i_y'], '答案指回原来那两个条目');
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

test('🔴 matchPairLeftRow：左项缺 id 时下拉选了**当场生效**（老实现回弹「请选择」）', () => {
  // 2026-09-24 审查报的原始缺陷：左项缺 id ⇒ 它是空串 ⇒ `matchSetPair(pairs, '', 'r1')`
  // 产出的那条配对 `leftId` 为空 ⇒ 被 `readPairs`（与服务端）丢掉 ⇒ 教师选完那一项，
  // 下拉**当场弹回「请选择」**，而他看不出自己错在哪（那条配对本该正是他刚选的那个）。
  const state = {
    left: [{ id: '', text: '甲' }, entry('l2', '乙')],
    right: [entry('r1', 'A'), entry('r2', 'B')],
    pairs: [],
  };
  const next = matchPairLeftRow(state, 0, 'r1');
  assert.equal(next.left[0].id.length > 0, true, '左项补上了 id');
  assert.equal(next.left[0].text, '甲', '只补 id，文字不动');
  // ⚠️ 判据必须过**落库再读回来**这一趟：下拉的 `value` 与配对都是 `readMatch` 算出来的
  //（只断言内存里那个对象的话，`readPairs` 把空 leftId 丢掉这一步就被跳过了 —— 那正是 bug 本身）。
  const roundTrip = readMatch(typed('match', writeMatch(next.left, next.right, next.pairs)));
  assert.deepEqual(roundTrip.pairs, [{ leftId: next.left[0].id, rightId: 'r1' }], '读得回来 ⇒ 下拉显示他刚选的那一项');
  assert.equal(roundTrip.left[0].id, next.left[0].id, 'id 在写—读往返里不变（否则下一次渲染又对不上）');
  // 同一个右项只能被一个左项占用这条纪律照旧（本函数内部走的就是 `matchSetPair`）
  const shared = matchPairLeftRow({ ...state, left: [entry('l1', '甲'), entry('l2', '乙')], pairs: [{ leftId: 'l2', rightId: 'r1' }] }, 0, 'r1');
  assert.deepEqual(shared.pairs, [{ leftId: 'l1', rightId: 'r1' }], '旧的被顶掉，不是并存');
  // 右栏缺 id 时**一起补**：下拉的 `value` 是右项的 id，右栏缺 id 时那一项根本选不中
  const rightMissing = {
    left: [entry('l1', '甲'), entry('l2', '乙')],
    right: [{ id: '', text: 'A' }, entry('r2', 'B')],
    pairs: [],
  };
  const fixed = matchPairLeftRow(rightMissing, 0, 'r2');
  assert.deepEqual(fixed.right.map((item) => item.id !== ''), [true, true], '右栏两个都补上');
  assert.deepEqual(
    readMatch(typed('match', writeMatch(fixed.left, fixed.right, fixed.pairs))).pairs,
    [{ leftId: 'l1', rightId: 'r2' }],
  );
  // 越界 ⇒ 原样返回同一个对象（不占撤销栈）
  assert.equal(matchPairLeftRow(state, 9, 'r1'), state);
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

// ── 13. 作答方式（M4b / D1，规格 §3-V）──────────────────────────────────
//
// 这一节盯的是**手写笔迹唯一的入口**：节点上的 `inputMode` 那一格。
// 它错了**不报错** —— 卡片上那两个单选若写进一个 reducer 不认的动作，屏幕上什么都不会
// 发生（连一句提示都没有），而 `inputMode: 'handwriting'` 就永远只活在手工改过的库行里，
// 于是整条手写链路（C1 的画布、E1 的抽屉预览）**没有任何教师可达的入口**。
//
// ⚠️ 「那一行画不画」的判据在 `question-card.tsx`（组件层，本仓没有 jsdom / testing-library，
// 没有回归网）—— 这里能钉住的只有它脚下的那三格数据。

test('★ newQuestion(drawing)：inputMode 恒为 handwriting、`data` 逐字等于 {}', () => {
  const question = newQuestion('drawing');
  assert.equal(question.inputMode, 'handwriting');
  // 🔴 `data` 不许有**任何**键：给它臆造一份「画布题的空壳 data」正是 M4a/C2 Step 1 禁的
  // 那件事（代价是静默判分）。它与 `short-answer` 同一档 —— 没有答案键、也没有条目。
  assert.deepEqual(question.data, {});
  assert.equal(Object.keys(question.data).length, 0);
  assert.equal(question.prompt, '');
  assert.deepEqual(question.children, []);
});

test('🔴 newQuestion：**只有** drawing 破例成 handwriting，其余题型恒为 keyboard（规格 §3-V 仍然成立）', () => {
  // 反向断言：把 `type === 'drawing' ? … : 'keyboard'` 改成恒 `'handwriting'`，这一条必须变红。
  // 它与上面 `:479` 那条「newQuestion：id 带 q_ 前缀、第一批恒为 keyboard、children 为空」
  // **一起**才卡得住这个例外：那一条钉住的是**具体一个**题型（问答题），这一条钉住
  // 「除 drawing 外**全部**题型」—— 少了这一条，将来给第二个题型破例时没有任何信号。
  const others = QUESTION_TYPE_OPTIONS.filter(option => option.value !== 'drawing');
  assert.equal(others.length, QUESTION_TYPE_OPTIONS.length - 1, '前提：drawing 在清单里，恰好被摘掉一条');
  for (const option of others) {
    assert.equal(newQuestion(option.value).inputMode, 'keyboard', `${option.value} 不该跟着破例`);
  }
});

test('🔴 updateInputMode 走的是撤销栈，undo 回到 keyboard（不是散落的 setState）', () => {
  const initial = contentOf(node('q_a', '题干'));
  const state = contentReducer(createHistory(initial), { kind: 'updateInputMode', id: 'q_a', inputMode: 'handwriting' });
  assert.equal(state.present.nodes[0].inputMode, 'handwriting');
  assert.equal(state.past.length, 1, '改一次 ⇒ 进栈一格');
  const undone = contentReducer(state, { kind: 'undo' });
  assert.equal(undone.present, initial, '撤销回到「还没改过作答方式」的那一份');
  assert.equal(undone.present.nodes[0].inputMode, 'keyboard');
  assert.equal(contentReducer(undone, { kind: 'redo' }).present.nodes[0].inputMode, 'handwriting');
});

test('updateInputMode：同值不造历史（重新点一次已经选中的那一档不占撤销栈）', () => {
  const state = createHistory(contentOf(node('q_a', '题干')));
  // `node()` 构造出来的就是 keyboard。
  assert.equal(contentReducer(state, { kind: 'updateInputMode', id: 'q_a', inputMode: 'keyboard' }), state);
  // 已经是 handwriting 的节点再点一次「手写」同理（它同时是「手工改过的库行被教师点了一下」那条路）。
  const ink = createHistory(contentOf({ ...node('q_a', '题干'), inputMode: 'handwriting' }));
  assert.equal(contentReducer(ink, { kind: 'updateInputMode', id: 'q_a', inputMode: 'handwriting' }), ink);
});

test('updateInputMode：改一道**不存在**的题 ⇒ 内容逐字不变、不进栈、不抛', () => {
  const state = createHistory(contentOf(node('q_a', '题干')));
  const next = contentReducer(state, { kind: 'updateInputMode', id: 'q_没有这道题', inputMode: 'handwriting' });
  assert.equal(next, state, '没命中 ⇒ `replaceNode` 回原对象 ⇒ 连状态对象都不该换');
  assert.equal(next.past.length, 0);
  assert.deepEqual(next.present, state.present);
});

test('🔴 sanitizeContentForSave：`inputMode` 原样保留（手写这一档不能被出网前的清理抹掉）', () => {
  // 🔴 **这一条的内容必须同时有别的可清理之处**（`points: undefined` 那个键）。
  // 只放一个无可清理的节点的话，`sanitizeContentForSave` 会走 `touched === false` 那条路
  // 把**原对象**一交到底 —— 那时「inputMode 还在」是被**没做事**保证的：
  // 反证（让 sanitize 把这一格改写成 keyboard）照样全绿，这条断言**没有牙**。
  // 2026-09-24 实跑过一次：第一版用例就是这么写的，反证时 124/124 全绿。
  const content = contentOf({ ...withPoints('q_a', undefined), inputMode: 'handwriting' });
  const cleaned = sanitizeContentForSave(content);
  assert.notEqual(cleaned, content, '前提：这一份确实被清理过（否则下面那条断言没有牙）');
  assert.equal(cleaned.nodes[0].inputMode, 'handwriting');
  assert.equal('points' in cleaned.nodes[0], false, '顺带：它该清的那一处仍然清了');
});

test('sanitizeContentForSave：无可清理之处的节点返回**同一个对象**（不造空的改动）', () => {
  const clean = contentOf({ ...node('q_a', '题干'), inputMode: 'handwriting' });
  // ⚠️ 这条与上面那条是**两个方向**：这一条测的是「没做事时别造新对象」，
  // 上面那条测的是「做事时别顺手改别的字段」。只有这一条的话会假绿（见上面的说明）。
  assert.equal(sanitizeContentForSave(clean), clean);
});

// ---------------------------------------------------------------------------
// 任务容器：**递归**定位 + 两级操作
// ---------------------------------------------------------------------------

/**
 * 🔴 这一节钉的是终审 C1 —— 第 2 步的迁移已经把库里的学习单包进了任务，而编辑器的
 * 所有编辑动作**只认顶层 `nodes`**（`applyEdit` 的文件注释原话就是这么写的）。
 * 后果不是「丑」，是：
 *   · 任务里的小题**一个字都改不动**（`updatePrompt`/`updateData`/`updatePoints`/
 *     `updateInputMode` 全部静默返回原对象，连撤销栈都不进 —— 按下去什么也没发生）；
 *   · `remove` 只删得掉顶层节点 ⇒ 删掉那个任务 = **清空整份学习单**；
 *   · `add` 只往顶层追加 ⇒ 老师加的题永远在任务外面。
 * ⇒ 下面每一条都是「先看它红」写出来的。
 */

/** 一个任务容器。`prompt` 是它的**标题**，不是说明（与迁移写下的「任务一」同形）。 */
function taskNode(id: string, prompt: string, children: WorksheetQuestionNode[] = []): WorksheetQuestionNode {
  return { id, type: 'task', prompt, inputMode: 'keyboard', data: {}, children };
}

/** 造一个历史：[任务一(题目 q_a, q_b)]，游标停在最后一步之后。 */
function twoLevel(...nodes: WorksheetQuestionNode[]) {
  return createHistory(contentOf(...nodes));
}

test('🔴 任务里的小题**改得动题干**（C1：`replaceNode` 只认顶层 ⇒ 按下去什么也没发生）', () => {
  const state = twoLevel(taskNode('t_1', '任务一', [node('q_a', '旧题干'), node('q_b')]));
  const next = contentReducer(state, { kind: 'updatePrompt', id: 'q_a', prompt: '新题干' });
  assert.notEqual(next, state, '任务里的题必须能被改到 —— 原实现连撤销栈都不进');
  assert.equal(next.present.nodes[0].children[0].prompt, '新题干');
  assert.equal(next.past.length, state.past.length + 1, '这一改必须进撤销栈');
});

test('🔴 任务里的小题改 `data` / `points` / `inputMode` 同样要生效（四条编辑动作同一个定位）', () => {
  const state = twoLevel(taskNode('t_1', '任务一', [node('q_a')]));
  const data = contentReducer(state, { kind: 'updateData', id: 'q_a', patch: { answers: ['甲'] } });
  assert.deepEqual(data.present.nodes[0].children[0].data.answers, ['甲']);

  const points = contentReducer(state, { kind: 'updatePoints', id: 'q_a', points: { full: 3, half: 1 } });
  assert.deepEqual(points.present.nodes[0].children[0].points, { full: 3, half: 1 });

  const mode = contentReducer(state, { kind: 'updateInputMode', id: 'q_a', inputMode: 'handwriting' });
  assert.equal(mode.present.nodes[0].children[0].inputMode, 'handwriting');
});

test('🔴 任务内的小题**上移/下移**只在任务内换位（不跨任务、不挪到任务外）', () => {
  const state = twoLevel(
    taskNode('t_1', '任务一', [node('q_a'), node('q_b')]),
    taskNode('t_2', '任务二', [node('q_c')]),
  );
  const moved = contentReducer(state, { kind: 'move', id: 'q_b', delta: -1 });
  assert.deepEqual(moved.present.nodes[0].children.map((child) => child.id), ['q_b', 'q_a']);
  assert.deepEqual(moved.present.nodes[1].children.map((child) => child.id), ['q_c'], '另一个任务不受影响');

  // 越界 ⇒ **不制造历史**（与顶层那条逐字同一条规矩）：任务内第一道按 ▲ 什么也不该发生。
  const edge = contentReducer(state, { kind: 'move', id: 'q_a', delta: -1 });
  assert.equal(edge, state);
});

test('🔴 任务自己也能上移/下移（按 order 换位）', () => {
  const state = twoLevel(taskNode('t_1', '任务一'), taskNode('t_2', '任务二'));
  const moved = contentReducer(state, { kind: 'move', id: 't_1', delta: 1 });
  assert.deepEqual(moved.present.nodes.map((item) => item.id), ['t_2', 't_1']);
});

test('🔴 删得掉任务里的**一道小题**，也删得掉**整个任务**（原实现只删得到顶层）', () => {
  const state = twoLevel(taskNode('t_1', '任务一', [node('q_a'), node('q_b')]));
  const one = contentReducer(state, { kind: 'remove', id: 'q_a' });
  assert.deepEqual(one.present.nodes[0].children.map((child) => child.id), ['q_b']);
  assert.equal(one.present.nodes.length, 1, '任务本身还在');

  const whole = contentReducer(state, { kind: 'remove', id: 't_1' });
  assert.deepEqual(whole.present.nodes, [], '删任务 = 删掉它和它的全部小题');
});

test('🔴 新建的任务追加在**末尾**，且标题按序号预填（教师可改）', () => {
  const state = twoLevel(taskNode('t_1', '任务一', [node('q_a')]));
  const next = contentReducer(state, { kind: 'addTask' });
  assert.equal(next.present.nodes.length, 2);
  assert.equal(next.present.nodes[1].type, 'task');
  assert.equal(next.present.nodes[1].prompt, '任务二', '预填「任务二」—— 与迁移写下的「任务一」同一套惯例');
  assert.deepEqual(next.present.nodes[1].children, [], '空任务是合法的（教师 2026-09-25 裁定）');
});

test('🔴 新建**小题**进指定的任务（`parentId`），不是追加到顶层', () => {
  const state = twoLevel(taskNode('t_1', '任务一', [node('q_a')]));
  const next = contentReducer(state, { kind: 'addQuestion', questionType: 'single-choice', parentId: 't_1' });
  assert.equal(next.present.nodes.length, 1, '顶层仍然只有一个任务 —— 新题不许落在任务外面');
  assert.deepEqual(next.present.nodes[0].children.map((child) => child.type), ['short-answer', 'single-choice']);
});

test('`parentId: null` 仍追加到顶层（散题是合法数据，老学习单里就有）', () => {
  const state = twoLevel(node('q_a'));
  const next = contentReducer(state, { kind: 'addQuestion', questionType: 'fill-blank', parentId: null });
  assert.deepEqual(next.present.nodes.map((item) => item.type), ['short-answer', 'fill-blank']);
});

test('找不到 id / 找不到父任务 ⇒ **返回原对象**，不制造一条空的历史', () => {
  const state = twoLevel(taskNode('t_1', '任务一', [node('q_a')]));
  assert.equal(contentReducer(state, { kind: 'updatePrompt', id: 'q_没有', prompt: 'x' }), state);
  assert.equal(contentReducer(state, { kind: 'remove', id: 'q_没有' }), state);
  assert.equal(contentReducer(state, { kind: 'move', id: 'q_没有', delta: 1 }), state);
  assert.equal(contentReducer(state, { kind: 'addQuestion', questionType: 'fill-blank', parentId: 't_没有' }), state);
});

test('🔴 同值去重对任务里的小题同样成立（四次编辑动作各一次「按下去没反应」的守门）', () => {
  const state = twoLevel(taskNode('t_1', '任务一', [node('q_a', '题干')]));
  assert.equal(contentReducer(state, { kind: 'updatePrompt', id: 'q_a', prompt: '题干' }), state);
  assert.equal(contentReducer(state, { kind: 'updateData', id: 'q_a', patch: {} }), state);
});

test('🔴 递归定位**不碰**兄弟节点与其它任务的引用（只重建走到的那条路径）', () => {
  const untouched = node('q_z', '别动我');
  const state = twoLevel(taskNode('t_1', '任务一', [node('q_a'), untouched]), taskNode('t_2', '任务二', [node('q_b')]));
  const next = contentReducer(state, { kind: 'updatePrompt', id: 'q_a', prompt: '新' });
  const before = state.present.nodes;
  const after = next.present.nodes;
  assert.equal(after[1], before[1], '另一个任务整棵没被重建');
  assert.equal(after[0].children[1], before[0].children[1], '兄弟小题原对象照搬');
  assert.notEqual(after[0], before[0], '走到的那条路径要重建（否则就不是不可变更新了）');
});

/* ── 同一族的另外四个：保存路径上的判据也必须递归 ─────────────────────── */

/**
 * 🔴 上面那一节是**编辑动作**，这一节是**保存路径**。它们原先的理由都写着
 * 「只动顶层 —— 第一批没有容器编辑 UI，嵌套里的题教师看不见也改不了，拦下会让他卡死」。
 * 那个理由**在第 2 步的迁移之后就不成立了**：库里每一道题都在任务里，
 * 而编辑页现在把它们**画出来也改得动**（上面那一节）⇒ 这些判据必须跟上来，
 * 否则「保存前的四道闸」全部对嵌套的题失效：
 *   · 空答案不清 ⇒ **安静的满分**（空串归一化后仍是空串，`answers: ['']` 判学生空作答为对）；
 *   · 非法/半填的分值不拦 ⇒ 服务端**静默把教师填的数换掉**（越界回落默认档、半填补 0）。
 */

test('🔴 任务里填空题的空答案，保存前同样被清掉（`sanitizeContentForSave` 递归）', () => {
  const task = taskNode('t_1', '任务一', [fillBlank('q_a', ['', '  ']), fillBlank('q_b', ['对'])]);
  const cleaned = sanitizeContentForSave(contentOf(task));
  assert.deepEqual(cleaned.nodes[0].children[0].data.answers, [], '全是空行的答案数组要被清成空数组（`withoutEmptyAnswers` 的既有口径）');
  assert.deepEqual(cleaned.nodes[0].children[1].data.answers, ['对'], '有内容的照常留着');
});

test('🔴 任务里小题的分值非法 ⇒ `findInvalidPoints` 找得到（并带两级题号）', () => {
  const bad = { ...node('q_a'), points: { full: 200, half: 0 } };
  const found = findInvalidPoints(contentOf(taskNode('t_1', '任务一', [bad]), node('q_b')));
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'q_a');
  assert.equal(found[0].heading, '任务一 · 1', '文案要指得到那一张卡 —— 用的是看板/导出同一份两级题号');
});

test('🔴 任务里小题的分值半填 ⇒ `findPartialPoints` 找得到', () => {
  const half = { ...node('q_a'), points: { full: 7 } };
  const found = findPartialPoints(contentOf(taskNode('t_1', '任务一', [half])));
  assert.deepEqual(found.map((item) => item.heading), ['任务一 · 1']);
});

test('🔴 任务里小题有**没进 reducer** 的非法输入 ⇒ `findUncommittedPointInput` 找得到', () => {
  const bad = node('q_a');
  const rejected = { q_a: { signature: pointsSignature(bad), full: '两朵', half: undefined } };
  const found = findUncommittedPointInput(contentOf(taskNode('t_1', '任务一', [bad])), rejected);
  assert.deepEqual(found.map((item) => item.heading), ['任务一 · 1']);
  assert.equal(found[0].which, 'full');
});

test('散题与任务混排：两边的题号都要对（散题不带前缀，前后端同一份规则）', () => {
  const loose = { ...node('q_z'), points: { full: 0, half: 0 } };
  const found = findInvalidPoints(contentOf(loose, taskNode('t_1', '任务一', [{ ...node('q_a'), points: { full: 200, half: 0 } }])));
  assert.deepEqual(found.map((item) => item.heading), ['1', '任务一 · 1']);
});

/* ── 载入守卫：任务的孩子也要过一遍 ─────────────────────────────────── */

/**
 * 🔴 `isQuestionNode` 只查**顶层**：`normalizeLoadedContent` 是
 * `nodes.filter(isQuestionNode)`。而任务的 `children` 是**未查过的外部输入**
 *（手改过的库行 / 别的版本写的草稿）⇒ 一个坏孩子会让 `TaskCard` 里的
 * `node.children.map(...)` 抛 TypeError，**整页白屏** ——
 * 而这道守卫的职责逐字就是「手改过的库行不该让整个编辑页白屏」。
 */
test('🔴 载入守卫：任务里形状不对的孩子被丢掉，好的留下', () => {
  const loaded = normalizeLoadedContent({
    schemaVersion: 1,
    nodes: [{
      id: 't_1', type: 'task', prompt: '任务一', inputMode: 'keyboard', data: {},
      children: [node('q_a', '好的'), null, 42, { id: 'q_broken' }, node('q_c', '也好')],
    }],
  });
  assert.deepEqual(loaded.nodes[0].children.map((child) => child.id), ['q_a', 'q_c']);
});

test('🔴 载入守卫：`children` 不是数组 ⇒ 归一成空数组（否则渲染时 `.map` 抛）', () => {
  const loaded = normalizeLoadedContent({
    schemaVersion: 1,
    nodes: [{ id: 't_1', type: 'task', prompt: '任务一', inputMode: 'keyboard', data: {}, children: 'nope' }],
  });
  assert.deepEqual(loaded.nodes[0].children, []);
});

test('载入守卫：正常的两级树**逐字不变**（别把好数据也改写一遍）', () => {
  const good = taskNode('t_1', '任务一', [node('q_a', '题干'), node('q_b', '题干')]);
  const loaded = normalizeLoadedContent({ schemaVersion: 1, nodes: [good] });
  assert.deepEqual(loaded.nodes, [good]);
});

/* ── 修复轮（第二轮终审的 Important）────────────────────────────────── */

test('🔴 F1：草稿里任务的孩子形状不对 ⇒ **整份作废**（`parseDraft` 也要递归守卫）', () => {
  // 同一个提交把 `normalizeLoadedContent` 递归化了，`parseDraft` 没跟上 —— 而草稿同样是
  // 「上一版本写的 / 手改过的」外部输入，这是它自己的文件头承诺要挡的东西。
  // 放行的后果：教师点「恢复」之后 `TaskCard` 的 `node.children.length` 抛 TypeError
  // ⇒ **整页白屏**（本仓没有 error.tsx），而 `setDraftFound(null)` 已经执行 ⇒
  // 连「丢弃」按钮都回不去，只能手清 localStorage。
  const bad = JSON.stringify({
    savedAt: Date.now(), title: 't', description: '', settings: DEFAULT_SETTINGS,
    content: { schemaVersion: 1, nodes: [{ id: 't1', type: 'task', prompt: '任务一', inputMode: 'keyboard', data: {}, children: 'nope' }] },
  });
  assert.equal(parseDraft(bad), null, '坏形状的草稿必须整份作废，不能带进渲染');
});

test('🔴 F1：正常的草稿仍然解析得出来（阳性对照）', () => {
  const good = JSON.stringify({
    savedAt: Date.now(), title: 't', description: '', settings: DEFAULT_SETTINGS,
    content: { schemaVersion: 1, nodes: [taskNode('t1', '任务一', [node('q_a', '题干')])] },
  });
  const draft = parseDraft(good);
  assert.ok(draft, '好草稿不该被这条守卫误伤');
  assert.equal(draft.content.nodes[0].children.length, 1);
});

test('🔴 F4：删掉中间一个任务之后新建的**不许撞名**（原来按「个数 + 1」推）', () => {
  // 实跑过的序列：新建 → 任务一、再新建 → 任务二、删掉任务一、再新建 ⇒ **两个「任务二」**
  // ⇒ 题号逐字撞车（`任务二 · 1` 出现两次），而 C3 那次改判据要防的就是撞号，只是换了条来路。
  const three = contentOf(taskNode('t1', '任务一'), taskNode('t2', '任务二'), taskNode('t3', '任务三'));
  assert.equal(nextTaskTitle(three.nodes), '任务四');
  // 删掉「任务一」之后还剩 任务二 / 任务三 ⇒ 下一个必须是「任务四」，不是「任务三」
  const afterDelete = contentOf(taskNode('t2', '任务二'), taskNode('t3', '任务三'));
  assert.equal(nextTaskTitle(afterDelete.nodes), '任务四');
  // 删光 ⇒ 从「任务一」重来（不与任何已用的号冲突）
  assert.equal(nextTaskTitle([]), '任务一');
  // 教师改过名的任务**不参与**序号推断：全是自定义名字时，下一个仍是「任务一」
  assert.equal(nextTaskTitle([taskNode('t1', '读材料'), taskNode('t2', '写结论')]), '任务一');
});

test('🔴 F2/F3：编辑页要渲染的行由**一个纯函数**给出，且与判据同一份覆盖', () => {
  // 两条 Important 的共同正解：
  //  · F2 —— **渲染深度必须等于判据深度**。判据（三个拦阻函数）经 `answerableOf` 递归**任意深**，
  //    而界面只画「顶层 + 任务里的小题」⇒ 一道深度 ≥2 的题（散题带 children）带半填的分值
  //    会**永久拦住保存**，而报错里那个题号在界面上找不到、也改不了
  //    —— 正是旧注释当年担心的「卡在一个修不了的错误上」，只是换了个来路。
  //  · F3 —— 卡片上的题号必须是**看板/导出/报错用的那一份**（两级），
  //    不能是「容器内下标 + 1」（同屏两张「第 1 题」）。
  const rows = editorRenderRows(contentOf(
    node('q_a', '散题一'),
    { ...node('q_parent', '材料题'), children: [node('q_child1', '子一'), node('q_child2', '子二')] },
    taskNode('t_1', '任务一', [node('q_b', '任务里的题')]),
    taskNode('t_2', '任务二', [node('q_c', '任务二的题')]),
  ).nodes);

  assert.deepEqual(rows.map((row) => row.kind), ['question', 'question', 'question', 'question', 'task', 'question', 'task', 'question']);
  assert.deepEqual(
    rows.map((row) => (row.kind === 'task' ? `[任务]${row.node.prompt}` : row.heading)),
    ['1', '2', '3', '4', '[任务]任务一', '任务一 · 1', '[任务]任务二', '任务二 · 1'],
    '★ 题号就是 `flattenAnswerable` 那一份；任务自己占一行（`[任务]`）',
  );
  // 🔴 F2 的要害：深度 ≥2 的那两道题**在渲染行里**（旧实现里它们不渲染、判据却查它们）。
  assert.deepEqual(
    rows.filter((row) => row.kind === 'question' && row.node.id.startsWith('q_child')).map((row) => row.node.id),
    ['q_child1', 'q_child2'],
  );
  // 每个 question 行都必须有题号（题号取不到就会是空串 —— 那是一条静默的坏行）。
  assert.equal(rows.some((row) => row.kind === 'question' && row.heading === ''), false);
});

test('🔴 F2/F3：`index` / `total` 是**同层**的位置与个数（▲▼ 的边界判据），任务行是顶层那层', () => {
  const rows = editorRenderRows(contentOf(
    { ...node('q_parent'), children: [node('q_child1'), node('q_child2')] },
    taskNode('t_1', '任务一', [node('q_b'), node('q_c')]),
  ).nodes);
  const parent = rows[0];
  assert.equal(parent.kind === 'question' && parent.index, 0, '散题在**顶层**那一层是第 0 个');
  assert.equal(parent.kind === 'question' && parent.total, 2, '顶层那一层共 2 个（散题 + 任务）');
  assert.equal(rows[1].kind === 'question' && rows[1].index, 0, '子题在**自己那一层**是第 0 个');
  assert.equal(rows[1].kind === 'question' && rows[1].total, 2);
  const task = rows[3];
  assert.equal(task.kind === 'task' && task.index, 1, '任务在顶层那一层是第 1 个');
  assert.equal(task.kind === 'task' && task.total, 2);
  assert.equal(rows[4].kind === 'question' && rows[4].taskId, 't_1', '任务里的小题知道自己在哪个任务里');
  assert.equal(rows[1].kind === 'question' && rows[1].taskId, null, '散题不属于任何任务');
});

test('坏形状的 children 不让渲染行炸（与载入守卫同一条）', () => {
  const rows = editorRenderRows([{ ...node('q_a'), children: 42 as unknown as WorksheetQuestionNode[] }]);
  assert.deepEqual(rows.map((row) => row.kind === 'question' && row.node.id), ['q_a']);
});

test('🔴 切块：小题必须落在它**自己的**任务块里，散题各自成块（切错了没有任何报错）', () => {
  const blocks = editorRenderBlocks(contentOf(
    node('q_a'),
    taskNode('t_1', '任务一', [node('q_b'), node('q_c')]),
    node('q_d'),
    taskNode('t_2', '任务二', [node('q_e')]),
  ).nodes);
  assert.deepEqual(
    blocks.map((block) => (block.task ? `[${block.task.node.prompt}]` : '[散题]') + block.questions.map((q) => q.node.id).join(',')),
    ['[散题]q_a', '[任务一]q_b,q_c', '[散题]q_d', '[任务二]q_e'],
  );
});

/* ── 无答案的选择题：不判分（教师裁定 2026-09-25）────────────────────── */

test('🔴 判不判分**只看那个开关**（教师最终裁定），不再以「有没有答案」推断', () => {
  // ⚠️ 本条 2026-09-25 改过一次：先是按 `correctKeys` 推断 —— 教师随后要求
  // 「加一个『允许自动评分』的开关，选允许则要求设置答案」⇒ 推断被显式开关取代。
  // 两条路留着会有两个来源，而「有答案却不判分」在开关关掉时是**正常状态**。
  assert.equal(gradesOnSubmit(node('q_c', '题干', {}, 'single-choice', ['A'])), true, '缺省 = 允许');
  assert.equal(gradesOnSubmit({ ...node('q_c', '题干', {}, 'single-choice', ['A']), autoGrade: false }), false);
  // 🔴 **没答案也一样判分**（开关开着）—— 答案必填由**校验器**管，不由这里推断。
  assert.equal(gradesOnSubmit(node('q_c', '题干', {}, 'single-choice', [])), true);
});

test('题型本身不判分的（问答 / 绘图）与任务：开关开着也不判分', () => {
  assert.equal(gradesOnSubmit(node('q_s', '题干', {}, 'short-answer')), false);
  assert.equal(gradesOnSubmit(node('q_d', '题干', {}, 'drawing')), false);
  assert.equal(gradesOnSubmit(taskNode('t_1', '任务一', [])), false);
});

test('其余题型不受开关以外的影响（别拿选择题的尺子量它们）', () => {
  assert.equal(gradesOnSubmit(node('q_f', '题干', { answers: ['H2O'] }, 'fill-blank')), true);
  assert.equal(gradesOnSubmit(node('q_o', '题干', {}, 'order')), true);
});

/* ── 两个新动作 ─────────────────────────────────────────────────────── */

test('🔴 `updateAutoGrade` 进撤销栈，且**同值去重**（按下去没反应不该占一格）', () => {
  const state = twoLevel(node('q_a'));
  const off = contentReducer(state, { kind: 'updateAutoGrade', id: 'q_a', autoGrade: false });
  assert.equal(off.present.nodes[0].autoGrade, false);
  assert.equal(off.past.length, state.past.length + 1, '要进栈');
  // 再关一次：值没变 ⇒ 原对象返回（与 `updatePrompt` 的同值去重同一条纪律）
  assert.equal(contentReducer(off, { kind: 'updateAutoGrade', id: 'q_a', autoGrade: false }), off);
  const on = contentReducer(off, { kind: 'updateAutoGrade', id: 'q_a', autoGrade: true });
  assert.equal(on.present.nodes[0].autoGrade, true);
});

test('🔴 `updateTolerance`：设数字就写键，`null` 就把键**删掉**（缺省 = 键不存在）', () => {
  const state = twoLevel(node('q_a'));
  const set = contentReducer(state, { kind: 'updateTolerance', id: 'q_a', tolerance: 1 });
  assert.equal(set.present.nodes[0].partialTolerance, 1);
  assert.equal(toleranceOf(set.present.nodes[0]), 1);
  const cleared = contentReducer(set, { kind: 'updateTolerance', id: 'q_a', tolerance: null });
  assert.equal('partialTolerance' in cleared.present.nodes[0], false, '缺省 ⇒ 键不存在（与 points 同一条约定）');
  assert.equal(toleranceOf(cleared.present.nodes[0]), null);
  assert.equal(contentReducer(cleared, { kind: 'updateTolerance', id: 'q_a', tolerance: null }), cleared, '同值去重');
});

test('🔴 新建的题把分值**落成真实数字**（学习单当前那两档），不是留空跟随', () => {
  const state = twoLevel(node('q_a'));
  const next = contentReducer(state, { kind: 'addQuestion', questionType: 'single-choice', parentId: null, points: { full: 3, half: 2 } });
  assert.deepEqual(next.present.nodes[1].points, { full: 3, half: 2 }, '框里要显示真实数字（教师要求「不是灰色提示」）');
  // ⚠️ 不给 `points` 时（老调用点 / 没传）造出来的题仍然是「跟随学习单」——
  // 那条路留给老数据，不是给新题的默认。
  const noSeed = contentReducer(state, { kind: 'addQuestion', questionType: 'fill-blank', parentId: null });
  assert.equal('points' in noSeed.present.nodes[1], false);
});

test('🔴 `canGivePartial`：只有**真会给部分分**的五个题型为真（画「判分依据」那一行的判据）', () => {
  // 给一道单选画一行「部分给分怎么算」是**一句谎话** —— `judgeSingleChoice` 只有对与错，
  // 永远返回不了 `partial`。问答/绘图连判分都没有。任务不是题。
  for (const type of ['multi-choice', 'fill-blank', 'order', 'match', 'categorize']) {
    assert.equal(canGivePartial(type), true, type);
  }
  for (const type of ['single-choice', 'true-false', 'short-answer', 'drawing', 'task', '不认识的题型']) {
    assert.equal(canGivePartial(type), false, type);
  }
  // ⚠️ 与 `isGradedQuestionType` **不是同一件事**：单选/判断「判分但不给部分分」，
  // 这一条必须在两者之间划出那道界线（否则「判分依据」会画到永远用不到它的题上）。
  assert.equal(isGradedQuestionType('single-choice'), true);
  assert.equal(canGivePartial('single-choice'), false);
});

test('🔴 `displayPoints`：折叠态那一行的分值（逐题优先，清空时用默认档）', () => {
  const fallback = { full: 1, half: 0 };
  assert.deepEqual(displayPoints(node('q_a', '题干', {}, 'single-choice'), fallback), fallback, '没有 points ⇒ 默认档');
  const pinned = { ...node('q_b', '题干', {}, 'single-choice'), points: { full: 3, half: 2 } };
  assert.deepEqual(displayPoints(pinned, fallback), { full: 3, half: 2 });
  // ⚠️ 与 `effectiveHalfStep` 的分工：那个半填时回 `null`（给警告条用），
  // 而这一行**必须**有个数 —— 半填时缺的那一端用默认档补上。
  const halfFilled = { ...node('q_c', '题干', {}, 'single-choice'), points: { full: 5 } };
  assert.deepEqual(displayPoints(halfFilled, fallback), { full: 5, half: 0 });
});
