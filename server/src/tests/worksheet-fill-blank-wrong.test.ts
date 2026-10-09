import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fillBlankWrongIndexes,
  wrongBlankAnswers,
  grade,
  type QuestionNode,
  type QuestionPoints,
  type QuestionType,
} from '../services/worksheet-questions.js';

/**
 * ★ 2026-10-09 审计：**混合填空题里「主观空」被恒判为答错**，而同一份提交的整题结论是「全对」。
 *
 * 机制（两份判据，只修了一份）：
 *   · **判分侧** `grade()`（`worksheet-questions.ts:439-443`）已经认得逐空 `gradingMode` ——
 *     它只把 `gradingMode === 'auto'` 的空计入 `hit / auto.length`。主观空按定义**没有标准答案**
 *     （`answers: []`），故不进分母、不影响结论。
 *   · **反馈侧** `fillBlankWrongIndexes()`（同文件 `:1050-1067`）**完全不看 `gradingMode`**，
 *     只按 `acceptable.length === 0` 无条件 `wrong.push(index)`。
 * ⇒ 主观空被标成「答错」，并经 `routes/worksheets.ts:2864`（提交响应）与 `:2525`（水合）
 *   下发给学生端；而 `wrongBlankAnswers` 因它无答案而不给它正确答案
 *   ⇒ 学生在主观空上看到一个**不带答案的红色删除线**。
 *
 * 🔴 更要紧的是**同一份响应自相矛盾**：整题说 `correct`、同一个空说「答错」。
 *    那正是本仓反复出现的形态 —— 同一件事两份判据，**漏掉的总是「说给人听的那一层」**。
 *
 * 修法与判分侧同源、只有一条判据：**没有答案键的空不进「答错」**（它没有对错可言）。
 */

const P: QuestionPoints = { full: 2, half: 1 };

/** 一道三空填空题：前两个客观（有答案），第三个主观（`gradingMode: 'ai'`，无答案）。 */
function mixedQuestion(): QuestionNode {
  return question('fill-blank', {
    answers: [['甲'], ['乙'], []],
    fillBlankSettings: {
      a: { mode: 'inline', gradingMode: 'auto', maxScore: 2 },
      b: { mode: 'pool', gradingMode: 'auto', maxScore: 1 },
      c: { mode: 'text', gradingMode: 'ai', maxScore: 5 },
    },
  });
}

const fill = (texts: unknown[]) => ({ format: 'fill-multi/v1', texts });

test('★ 主观空（gradingMode=ai）不计入「答错」', () => {
  const node = mixedQuestion();
  assert.deepEqual(
    fillBlankWrongIndexes(node, fill(['甲', '乙', '任何内容'])),
    [],
    '三个空全对（前两个匹配答案、第三个是主观题）⇒ 一个错的都没有',
  );
});

test('★ 与整题结论不再自相矛盾：整题 correct ⇒ 没有任何空被标错', () => {
  const node = mixedQuestion();
  const value = fill(['甲', '乙', '任何内容']);
  // 同一份提交、同一份响应里的两句话，必须一致（这条曾经是 red 的核心）
  assert.deepEqual(grade(node, value, P), { state: 'correct', score: 3 }, '前置：整题判定为全对');
  assert.deepEqual(fillBlankWrongIndexes(node, value), [], '整题全对就不能有空格被标错');
});

test('★ gradingMode=none 的空同样没有对错可言', () => {
  const node = question('fill-blank', {
    answers: [['甲'], []],
    fillBlankSettings: {
      a: { mode: 'inline', gradingMode: 'auto', maxScore: 1 },
      b: { mode: 'text', gradingMode: 'none', maxScore: 0 },
    },
  });
  assert.deepEqual(fillBlankWrongIndexes(node, fill(['甲', '随便写'])), []);
});

test('★ 客观空没设答案键（答案数组为空）同样不进答错 —— 与判分侧同一条判据', () => {
  // 判分侧对这种空的处理是 `continue`（`:452`，不计入命中也不进分母）。
  // 反馈侧若把它算成错，两处就又分叉了。
  const node = question('fill-blank', {
    answers: [[], ['乙']],
    fillBlankSettings: {
      a: { mode: 'inline', gradingMode: 'auto', maxScore: 1 },
      b: { mode: 'pool', gradingMode: 'auto', maxScore: 1 },
    },
  });
  assert.deepEqual(fillBlankWrongIndexes(node, fill(['写了点什么', '乙'])), []);
});

test('阴性对照：客观空答错**仍然**要报（少了它，「一律回空数组」也能全绿）', () => {
  const node = mixedQuestion();
  assert.deepEqual(
    fillBlankWrongIndexes(node, fill(['甲', '错', '任何内容'])),
    [1],
    '只有第 2 个空（客观、答错）该被报出来；主观空不在其中',
  );
});

test('阴性对照：客观空留空（空串）仍然算错', () => {
  const node = mixedQuestion();
  assert.deepEqual(
    fillBlankWrongIndexes(node, fill(['甲', '', '任何内容'])),
    [1],
    '空串 ≠ 标准答案 ⇒ 客观空仍然是错的',
  );
});

test('答错的客观空仍然能看到正确答案，主观空不产生半句话', () => {
  const node = mixedQuestion();
  assert.deepEqual(
    wrongBlankAnswers(node, fill(['甲', '错', '任何内容'])),
    { 1: '乙' },
    '只给第 2 个空的正确答案；主观空没有答案可写，不得出现空串',
  );
});

function question(type: QuestionType, data: Record<string, unknown>): QuestionNode {
  return { id: `q_${type}`, type, prompt: '题干', inputMode: 'keyboard', data, children: [] };
}
