/**
 * ★ 2026-09-27（教师）：「选择和判断学生错误后也要与填空一样给出叉叉符号并给出正确答案。」
 *
 * 本文件钉的是**服务端那一半**：`wrongChoiceAnswers` 到底发不发、发什么、按什么顺序。
 * 客户端那一半（在选项上画叉、在题目下方写「正确答案 B」）在 `src/app/classroom/` 里，
 * 本机没有 jsdom ⇒ 那半边只能真机走查。
 *
 * 🔴 它守的是一条**窄口**：`stripAnswers` 刻意不下发整张答案键，学生能看到的正确答案
 *    必须**只在他提交之后**、而且**只有他没答对的那道题**。所以这里逐条断言
 *    「全对不发」「没设答案键不发」—— 那两条一旦松掉，就是把答案键漏给学生，
 *    而屏幕上不会出现任何异常（他们只是「提前知道了答案」）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrongAnswers,
  wrongChoiceAnswers,
  type QuestionNode,
  type QuestionType,
} from '../services/worksheet-questions.js';

/** 三个选项的选择题。`correct` 按**给定的顺序**写进 `correctKeys`（用来测输出顺序）。 */
function choice(type: QuestionType, correct: string[], options = ['A', 'B', 'C', 'D']): QuestionNode {
  return {
    id: 'q_choice',
    type,
    prompt: '下面哪个是哺乳动物',
    inputMode: 'keyboard',
    data: {
      options: options.map(key => ({ key, text: `选项 ${key}` })),
      correctKeys: correct,
    },
    children: [],
  };
}

const picked = (...keys: string[]) => ({ format: 'choice/v1', selected: keys });

test('判断题答错 ⇒ 给出正确的那个 key（对/错各一条）', () => {
  // ⚠️ 判断题**不存 `options`**（选项恒为对/错两个，key 是协议里的 T/F）。
  const tf: QuestionNode = {
    id: 'q_tf', type: 'true-false', prompt: '地球是圆的', inputMode: 'keyboard',
    data: { correctKeys: ['T'] }, children: [],
  };
  assert.deepEqual(wrongChoiceAnswers(tf, picked('F')), { 0: 'T' });
  const wrongOther: QuestionNode = { ...tf, data: { correctKeys: ['F'] } };
  assert.deepEqual(wrongChoiceAnswers(wrongOther, picked('T')), { 0: 'F' });
});

test('单选题答错 ⇒ 给出正确的 key', () => {
  assert.deepEqual(wrongChoiceAnswers(choice('single-choice', ['B']), picked('A')), { 0: 'B' });
});

test('🔴 多选题**漏选**（只对了一部分）⇒ 也要给，而且是全部正确答案', () => {
  // 教师那句话里的「错误」包括只对了一部分：多选的部分分是「漏选且没选错」，
  // 那种学生最需要知道漏了哪几个。
  assert.deepEqual(wrongChoiceAnswers(choice('multi-choice', ['A', 'C']), picked('A')), { 0: 'A', 1: 'C' });
  // 选错 + 漏选
  assert.deepEqual(wrongChoiceAnswers(choice('multi-choice', ['A', 'C']), picked('B')), { 0: 'A', 1: 'C' });
});

test('🔴 全对 ⇒ **空对象**（这就是「只发答错的」那道窄口）', () => {
  assert.deepEqual(wrongChoiceAnswers(choice('single-choice', ['B']), picked('B')), {});
  assert.deepEqual(wrongChoiceAnswers(choice('multi-choice', ['A', 'C']), picked('A', 'C')), {});
  // ⚠️ 判据是**集合**意义上的完全一致 ⇒ 顺序不同也算全对（多选题的作答值是一个集合）。
  assert.deepEqual(wrongChoiceAnswers(choice('multi-choice', ['A', 'C']), picked('C', 'A')), {});
});

test('🔴 没设答案键 ⇒ 空对象（这题不判分，也就没有「正确答案」可写）', () => {
  // `judgeSingleChoice` 对没答案的题回 `null`（不判分）；这里必须同口径 ——
  // 否则学生会看到一句凭空出现的「正确答案」。
  assert.deepEqual(wrongChoiceAnswers(choice('single-choice', []), picked('A')), {});
});

test('🔴 顺序取**选项表**，不是 `correctKeys` 自己的顺序', () => {
  // 教师横着比一串学生时，同一道题的「正确答案」每次都得是同一串 ——
  // 库里 `correctKeys` 的顺序是教师点选的先后（逐题、甚至逐次不同）。
  const node = choice('multi-choice', ['C', 'A', 'B']);
  assert.deepEqual(wrongChoiceAnswers(node, picked('D')), { 0: 'A', 1: 'B', 2: 'C' });
});

test('不适用的题型 ⇒ 空对象（填空走另一支）', () => {
  assert.deepEqual(wrongChoiceAnswers({ ...choice('fill-blank', ['A']) }, picked('B')), {});
  assert.deepEqual(wrongChoiceAnswers({ ...choice('short-answer', ['A']) }, picked('B')), {});
});

test('🔴 手工改过的坏数据：`correctKeys` 指向不存在的选项 ⇒ **照发**，不静默丢', () => {
  // 校验器会拒这种行，但库里的行不一定经过校验。丢掉的话界面既不画叉也不写答案，
  // 学生只看到一句「再想一想」—— 而那看起来和「这题不用改」没有区别。
  const node = choice('multi-choice', ['Z']);
  assert.deepEqual(wrongChoiceAnswers(node, picked('A')), { 0: 'Z' });
});

test('`wrongAnswers` 按题型分派：填空走逐空的答案，选择走选项 key', () => {
  const blank: QuestionNode = {
    id: 'q_f', type: 'fill-blank', prompt: '植物需要____', inputMode: 'keyboard',
    data: { answers: [['氧气'], ['阳光']] }, children: [],
  };
  assert.deepEqual(
    wrongAnswers(blank, { format: 'fill-multi/v1', texts: ['二氧化碳', '阳光'] }),
    { 0: '氧气' },
    '第 2 空答对了 ⇒ 不许出现',
  );
  assert.deepEqual(wrongAnswers(choice('single-choice', ['B']), picked('A')), { 0: 'B' });
});
