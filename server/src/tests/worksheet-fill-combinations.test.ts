import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisReferenceAnswer } from '../services/analysis-question.js';
import { grade, fillBlankWrongIndexes, wrongBlankAnswers, validateQuestion, stripAnswers, conditionalFillAnswerReference, type QuestionNode } from '../services/worksheet-questions.js';

const first = ['日初出近日中时远', '日初出远日中时近', '日初出大如车盖及日中则如盘盂', '日初出沧沧凉凉及日中则如探汤', '近大远小', '近热远凉'];
const second = [first[1], first[0], first[3], first[2], first[5], first[4]];
function fixture(type: 'fill-blank' | 'choice-blank' = 'fill-blank'): QuestionNode {
  return { id: 'q', type, inputMode: 'keyboard', prompt: '比较两小儿的观点', children: [], data: {
    answers: first.map(answer => [answer]), fillChoicePool: first,
    fillBlankSettings: Object.fromEntries(first.map((_, i) => [`b${i}`, { mode: 'pool', choices: [], gradingMode: 'auto', maxScore: 1 }])),
    fillAnswerCombinations: [{ id: 'swapped', answers: Object.fromEntries(second.map((answer, i) => [`b${i}`, [answer]])) }],
  } };
}
const value = (texts: string[]) => ({ format: 'fill-multi/v1', texts });
const points = { full: 6, half: 3 };

test('两列互换：两套完整答案均全对，混填只按一整套评分，首空错误不连带扣分', () => {
  for (const type of ['fill-blank', 'choice-blank'] as const) {
    const node = fixture(type);
    assert.deepEqual(validateQuestion(node), []);
    for (const answers of [first, second]) {
      assert.equal(grade(node, value(answers), points)?.state, 'correct');
      assert.deepEqual(fillBlankWrongIndexes(node, value(answers)), []);
    }
    const mixed = [...first]; mixed[2] = second[2]; mixed[4] = second[4];
    assert.equal(grade(node, value(mixed), points)?.state, 'partial');
    assert.deepEqual(fillBlankWrongIndexes(node, value(mixed)), [2, 4]);
    assert.deepEqual(wrongBlankAnswers(node, value(mixed)), { 2: first[2], 4: first[4] });
    const missingFirst = ['不知道', ...second.slice(1)];
    assert.deepEqual(fillBlankWrongIndexes(node, value(missingFirst)), [0]);
    assert.deepEqual(wrongBlankAnswers(node, value(missingFirst)), { 0: second[0] });
  }
});

test('逐空按得分最高组合判分；整题奖励只在一套全对时发放', () => {
  const node = fixture();
  const settings = node.data.fillBlankSettings as Record<string, { maxScore: number }>;
  settings.b0.maxScore = 9;
  const mixed = [first[0], ...second.slice(1)];
  assert.deepEqual(grade(node, value(mixed), points), { state: 'partial', score: 9 });
  assert.deepEqual(fillBlankWrongIndexes(node, value(mixed)), [1, 2, 3, 4, 5]);
  node.data.fillWholeScore = 2;
  assert.deepEqual(grade(node, value(mixed), points), { state: 'partial', score: 0 });
  assert.deepEqual(fillBlankWrongIndexes(node, value(mixed)), [0]);
  assert.deepEqual(grade(node, value(second), points), { state: 'correct', score: 2 });
});

test('多个可接受答案、选词换行与数学定界符沿用原有判分；同分取靠前组合', () => {
  const node = fixture();
  const alternate = node.data.fillAnswerCombinations as { answers: Record<string, string[]> }[];
  alternate[0].answers.b0.push('$x=5$');
  assert.equal(grade(node, value(['x=5', ...second.slice(1)]), points)?.state, 'correct');
  assert.equal(grade(node, value(second.map(text => text.slice(0, 3) + '\n' + text.slice(3))), points)?.state, 'correct');
  const mixed = [...first.slice(0, 3), ...second.slice(3)];
  assert.deepEqual(fillBlankWrongIndexes(node, value(mixed)), [3, 4, 5]);
});

test('答案组合保留教师参考对应关系，剥离学生端全部答案与组合', () => {
  const node = fixture();
  assert.deepEqual(conditionalFillAnswerReference(node.data, 0), [`组合 1：${first[0]}`, `组合 2：${second[0]}`]);
  const reference = analysisReferenceAnswer(node);
  assert.ok(reference.includes('不可混用'));
  assert.ok(reference.includes(`组合 1：第1空「${first[0]}」`));
  assert.ok(reference.includes(`组合 2：第1空「${second[0]}」`));
  const stripped = stripAnswers({ schemaVersion: 1, nodes: [node] });
  const data = (stripped.nodes[0] as QuestionNode).data;
  assert.equal('fillAnswerCombinations' in data, false);
  assert.equal('answers' in data, false);
  assert.deepEqual(data.fillChoicePool, first);
  assert.ok(node.data.fillAnswerCombinations);
});

test('保存校验拒绝缺空、已删除空、重复标识与联动冲突', () => {
  for (const change of [
    (node: QuestionNode) => { (node.data.fillAnswerCombinations as {answers:Record<string,string[]>}[])[0].answers.b1 = []; },
    (node: QuestionNode) => { (node.data.fillAnswerCombinations as {answers:Record<string,string[]>}[])[0].answers.deleted = ['X']; },
    (node: QuestionNode) => { const items = node.data.fillAnswerCombinations as unknown[]; items.push(items[0]); },
    (node: QuestionNode) => { (node.data.fillBlankSettings as Record<string,unknown>).b0 = {mode:'pool',conditionalAnswer:{sourceId:'b1',cases:[]}}; },
  ]) {
    const node = fixture(); change(node); assert.ok(validateQuestion(node).length > 0);
  }
});

test('收集空不参与组合评分或订正，原有组合数据可保留', () => {
  const node = fixture();
  (node.data.fillBlankSettings as Record<string, unknown>).b1 = {mode:'text',gradingMode:'none',maxScore:1};
  assert.deepEqual(validateQuestion(node), []);
  const texts = [...second]; texts[1] = '自由表达';
  assert.deepEqual(grade(node, value(texts), points), {state:'correct',score:5});
  assert.deepEqual(fillBlankWrongIndexes(node,value(texts)), []);
  assert.deepEqual(wrongBlankAnswers(node,value(texts)), {});
});
