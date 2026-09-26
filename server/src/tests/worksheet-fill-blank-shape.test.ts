/**
 * 填空题判分的**形状分派**（★ 2026-09-26，spec 第 4 步）。
 *
 * ── 为什么单独一个文件 ──────────────────────────────────────────────────────
 * 判分原来按**题目数据**的形状分派（`Array.isArray(data.blanks)` 在不在）。
 * 而 2026-09-26 的迁移把老题的空挪进了题干、并把每空的答案理成**每空一份**
 *（`data.answers: string[][]`）—— `data.blanks` 从此不在库里了。
 * ⇒ 再按数据分派的话，一道**迁移过的多空题**会被当成单空题判：
 * 它去读 `value.text`，而客户端写的是 `{ texts: [...] }` ⇒ `undefined` ⇒
 * **每个学生都判错**，而没有任何一处报错。
 *
 * ⇒ 判据改成按**作答值的形状**分派（值自带 `format`：`fill/v1` 带 `text`、
 * `fill-multi/v1` 带 `texts`）—— 两边都不再看 `data.blanks`，就没有可漂移的地方。
 *
 * ⚠️ **三种历史形状都要读得出来**（它们是不同时期落库的，一份都不能丢）：
 *   ① 新：`answers: [['氧气'], ['阳光']]`（每空一份，迁移写的、编辑器往后写的）
 *   ② 老多空：`blanks: [{ answers: [...] }, …]`（答案住在 `blanks` 里面）
 *   ③ 老单空：`answers: ['氧气']`（**平铺**的一份可接受答案）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  grade,
  validateQuestion,
  type QuestionNode,
  type QuestionPoints,
} from '../services/worksheet-questions.js';

/** ⚠️ 用 2 / 1 而不是默认的 1 / 0：默认档下 `score` 恰好等于旧布林的 `Number()`，
 *  几个典型错误在那一档下**看不出来**（与 `worksheet-grade-m4.test.ts` 同一个理由）。 */
const P: QuestionPoints = { full: 2, half: 1 };

function blank(data: Record<string, unknown>): QuestionNode {
  return { id: 'q_fill', type: 'fill-blank', prompt: '植物需要____才能生长', inputMode: 'keyboard', data, children: [] };
}

/** 判分结果（`grade` 返回 null = 这道题不判分 —— 那些用例里它必须是红的）。 */
function stateOf(node: QuestionNode, value: unknown): string | null {
  return grade(node, value, P)?.state ?? null;
}

// ── ① 新形状：每空一份答案 ────────────────────────────────────────────────

test('🔴 新形状（`answers` 每空一份）+ 值是 `texts` ⇒ 逐空判', () => {
  const node = blank({ answers: [['阳光'], ['水分']] });
  assert.equal(stateOf(node, { format: 'fill-multi/v1', texts: ['阳光', '水分'] }), 'correct');
  assert.equal(stateOf(node, { format: 'fill-multi/v1', texts: ['阳光', '空气'] }), 'partial', '对一个');
  assert.equal(stateOf(node, { format: 'fill-multi/v1', texts: ['空气', '空气'] }), 'incorrect');
});

test('🔴 新形状 · **一个空**（迁移之后单空题也长这样）+ 值是 `texts` ⇒ 判对', () => {
  // ⚠️ 这一条正是「迁移之后会不会全班判错」的判据：老判据按 `data.blanks` 分派，
  // 而迁移之后它不在 ⇒ 走单空路径读 `value.text` ⇒ `texts` 的值读不到 ⇒ **incorrect**。
  const node = blank({ answers: [['氧气']] });
  assert.equal(stateOf(node, { format: 'fill-multi/v1', texts: ['氧气'] }), 'correct');
  assert.equal(stateOf(node, { format: 'fill-multi/v1', texts: ['二氧化碳'] }), 'incorrect');
});

// ── ② 老多空：答案住在 `blanks` 里面（迁移还没跑到的库）────────────────────

test('🔴 老多空形状（答案在 `blanks[i].answers`）仍然判得对', () => {
  const node = blank({ blanks: [{ answers: ['阳光'] }, { answers: ['水分'] }] });
  assert.equal(stateOf(node, { format: 'fill-multi/v1', texts: ['阳光', '水分'] }), 'correct');
  assert.equal(stateOf(node, { format: 'fill-multi/v1', texts: ['阳光', '空气'] }), 'partial');
});

// ── ③ 老单空：`answers` 是**平铺**的一份 ────────────────────────────────────

test('🔴 老单空形状（`answers` 平铺）+ 值是 `text` ⇒ 判得对（这条是防回归）', () => {
  const node = blank({ answers: ['氧气'] });
  assert.equal(stateOf(node, { format: 'fill/v1', text: '氧气' }), 'correct');
  assert.equal(stateOf(node, { format: 'fill/v1', text: '二氧化碳' }), 'incorrect');
  // ⚠️ 单空**没有部分给分**（只有一个组成部分）。
  const multi = blank({ answers: ['氧气', '氧气分子'] });
  assert.equal(stateOf(multi, { format: 'fill/v1', text: '氧气分子' }), 'correct', '列几个可接受写法');
});

// ── 坏形状 / 边界 ─────────────────────────────────────────────────────────

test('🔴 一个空都没有 ⇒ 判错（不许落到「0 === 0 恒真」的全对）', () => {
  assert.equal(stateOf(blank({ answers: [] }), { format: 'fill-multi/v1', texts: [] }), 'incorrect');
  assert.equal(stateOf(blank({ blanks: [] }), { format: 'fill-multi/v1', texts: [] }), 'incorrect');
  assert.equal(stateOf(blank({}), { format: 'fill-multi/v1', texts: ['随便'] }), 'incorrect');
});

test('作答值的形状坏掉 ⇒ 判错，不抛', () => {
  const node = blank({ answers: [['氧气']] });
  assert.equal(stateOf(node, { format: 'fill-multi/v1', texts: '氧气' }), 'incorrect', 'texts 不是数组');
  assert.equal(stateOf(node, { format: 'fill/v1' }), 'incorrect', '连 text 都没有');
  assert.equal(stateOf(node, null), 'incorrect');
  assert.equal(stateOf(node, '氧气'), 'incorrect');
});

test('空得比答案槽多 / 少：多出来的忽略，少的那几格算错', () => {
  const node = blank({ answers: [['阳光'], ['水分']] });
  assert.equal(stateOf(node, { format: 'fill-multi/v1', texts: ['阳光', '水分', '多余的'] }), 'correct', '多填的忽略');
  assert.equal(stateOf(node, { format: 'fill-multi/v1', texts: ['阳光'] }), 'partial', '少一格 ⇒ 那一格算错');
});

// ── 校验那一侧：**必须与判分读同一份答案**（★ 2026-09-26 的返工）────────────

test('🔴 校验：**每空一份**的答案要被认出来（教师填了两个答案，不许说「一个都没有」）', () => {
  // 🔴 这一条是**被一次真实的保存失败逼出来的**：判分那边我改成了按形状读，
  // 而**校验那一侧还按老形状读**（平铺的 `data.answers`）——
  // 于是教师把两个空的答案都填好、题干里两个空也在，保存却被拒：
  // 「填空题至少要有一个可接受的答案」。屏幕上两个框里明明写着字。
  // ⇒ 判据只有一处（`answerSlotCount` / `acceptableAnswersFor`），校验与判分都走它。
  const ok = blank({ answers: [['张三'], ['李四']] });
  assert.deepEqual(validateQuestion(ok), [], '每空一份的答案必须被认出来');

  // 阳性对照：真的一格都没填 ⇒ 仍然要被拒（别为了修这个洞把校验放空）。
  const missing = blank({ answers: [['张三'], []] });
  assert.ok(validateQuestion(missing).length > 0, '有一个空没答案 ⇒ 仍然拒');

  // 老形状照旧（不能为了新形状把老的弄坏）。
  assert.deepEqual(validateQuestion(blank({ answers: ['张三'] })), [], '老的单空（平铺）');
  assert.deepEqual(validateQuestion(blank({ blanks: [{ answers: ['张三'] }] })), [], '老的多空');
  // 空 data 必须被拒（那条通用用例的口径不变）。
  assert.ok(validateQuestion(blank({})).length > 0);
});
