/**
 * ★ 2026-09-25（教师裁定）：**客观题可以不设答案 ⇒ 那道题不判分**。
 *
 * 原话：「选择题的答案设置非必须，可以不设答案，也就是不用给分」。
 *
 * 🔴 为什么这件事值得单独一个文件：改之前「没有答案」是一个**被判成坏数据的状态** ——
 * `validateQuestion` 拦着不让存（「必须且只能指定一个正确答案」），判分器则把
 * `correctKeys` 不是恰好一个的题**判成 `incorrect`**（它的注释逐字写着「这道题没有人能答对
 * （数据被改坏了）」）。于是这条裁定有两个半边，缺一个都不成立：
 *   · **校验器**放行 ⇒ 这种题存得进库；
 *   · **判分器**改回 `null`（＝没判过）⇒ 它不会被画成「全班都答错」。
 *
 * 🔴 判成 `incorrect` 的后果是本仓最怕的那一类：**看板上正确率 0%**、抽屉里每人都画 ✗、
 * 导出 Word 一列「错」—— 而教师会去怀疑学生，不会来怀疑这道题。
 * 判成 `null` 之后它与主观题同一条路：只统计作答进度，不画任何对错标记。
 *
 * ⚠️ 分析闸**不动**（仍只问答 / 绘图）：不设答案的选择题不进 AI 分析。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, validateQuestion, DEFAULT_POINTS, type QuestionNode, type QuestionType } from '../services/worksheet-questions.js';

/** 一道最小的客观题。`correctKeys` 给什么就是什么（**不给默认值** —— 本文件测的就是它）。 */
function choice(type: QuestionType, correctKeys: string[]): QuestionNode {
  return {
    id: 'q_1',
    type,
    prompt: '光合作用的产物是？',
    inputMode: 'keyboard',
    data: {
      options: [{ key: 'A', text: '氧气' }, { key: 'B', text: '二氧化碳' }],
      correctKeys,
    },
    children: [],
  };
}

const ANSWERED = { format: 'choice/v1', selected: ['A'] };
const PICKED_B = { format: 'choice/v1', selected: ['B'] };

/* ── 校验器：放行 ───────────────────────────────────────────────────── */

test('🔴 答案可空**只在关掉自动评分时成立**（这是本文件与 `autoGrade` 的分界）', () => {
  // ⚠️ 本条 2026-09-25 **又改过一次**：先是「答案必填」⇒ 改成「空答案合法」⇒
  // 教师当天追加裁定「加一个『允许自动评分』的开关，选允许则要求设置答案」。
  // ⇒ 现在**以开关为准**：关掉 ⇒ 答案用不上、一条都不查；开着（缺省）⇒ 恢复必填。
  // 完整口径见 `worksheet-auto-grade.test.ts`。本文件保留的是**判分器那一半**：
  // 手上真拿到一份没有答案的数据时（手改过的库）判分器回 `null` 而不是判错。
  const off = (type: QuestionType) => ({ ...choice(type, []), autoGrade: false as const });
  assert.deepEqual(validateQuestion(off('single-choice')), []);
  assert.deepEqual(validateQuestion(off('true-false')), []);
  assert.deepEqual(validateQuestion(off('multi-choice')), []);
  assert.ok(validateQuestion(choice('single-choice', [])).length > 0, '开着开关 ⇒ 答案必填');
});

test('🔴 单选仍然**不许有两个**答案（那不是「没设」，是坏数据）', () => {
  // ⚠️ 旧判据是 `length !== 1`，它把「0 个」与「2 个以上」当成同一件事。
  // 现在 0 个合法、2 个以上仍然非法 —— 两者必须分开。
  const errors = validateQuestion(choice('single-choice', ['A', 'B']));
  assert.ok(errors.some((message) => message.includes('一个正确答案')), `实际：${JSON.stringify(errors)}`);
  assert.deepEqual(validateQuestion(choice('true-false', ['T', 'F'])).length > 0, true);
});

test('答案指向不存在的选项 ⇒ 仍然拒绝（这条判据与「有没有答案」无关）', () => {
  const errors = validateQuestion(choice('single-choice', ['Z']));
  assert.ok(errors.some((message) => message.includes('不存在')), `实际：${JSON.stringify(errors)}`);
});

/* ── 判分器：`null`，不是 `incorrect` ─────────────────────────────────── */

test('🔴 无答案的客观题：`grade()` 回 **null**（没判过），不是「答错」', () => {
  for (const type of ['single-choice', 'true-false', 'multi-choice'] as const) {
    assert.equal(
      grade(choice(type, []), ANSWERED, DEFAULT_POINTS), null,
      `题型「${type}」没设答案时不该给出任何判定 —— 判成 incorrect 会让看板显示「正确率 0%」`,
    );
    assert.equal(grade(choice(type, []), PICKED_B, DEFAULT_POINTS), null, '选什么都不能改变它：这道题没有对错');
  }
});

test('阳性对照：设了答案就照常判（上面那条不是因为「这三种题型一律回 null」）', () => {
  assert.deepEqual(grade(choice('single-choice', ['A']), ANSWERED, DEFAULT_POINTS), { state: 'correct', score: DEFAULT_POINTS.full });
  assert.deepEqual(grade(choice('single-choice', ['A']), PICKED_B, DEFAULT_POINTS), { state: 'incorrect', score: 0 });
});

test('🔴 单选给了两个答案（坏数据）仍然判错 —— 别把它一起放成 null', () => {
  // 「没设答案」与「设了两个」是两回事：后者是坏数据，判错是**响亮**的那条路
  //（学生端会画 ✗、教师会来问），而静默回 null 会让它一直躺着没人发现。
  assert.deepEqual(grade(choice('single-choice', ['A', 'B']), ANSWERED, DEFAULT_POINTS), { state: 'incorrect', score: 0 });
});

test('多选的「部分给分」在**有答案**时不受影响（这条改动只碰「没答案」那一支）', () => {
  const data = { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], correctKeys: ['A', 'B'], partialCredit: 'allow-missing' };
  const node: QuestionNode = { id: 'q_m', type: 'multi-choice', prompt: '选两个', inputMode: 'keyboard', data, children: [] };
  assert.deepEqual(grade(node, { format: 'choice/v1', selected: ['A'] }, DEFAULT_POINTS), { state: 'partial', score: DEFAULT_POINTS.half });
});
