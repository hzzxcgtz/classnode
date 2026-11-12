import type { QuestionNode } from '../../services/worksheet-questions.js';

/** A real, independent combination question; legacy conditional rules use a different node. */
export function fillCombinationSecurityFixture() {
  return {
    id: 'fill-combination-fixture', type: 'fill-blank',
    prompt: '{填空域}、{填空域}', inputMode: 'keyboard', children: [],
    data: {
      promptRuns: [{ start: 0, end: 5, blank: 'left' }, { start: 5, end: 6 }, { start: 6, end: 11, blank: 'right' }],
      answers: [['组合基础甲保密哨兵'], ['组合基础乙保密哨兵']],
      fillBlankSettings: {
        left: { mode: 'text', choices: [], gradingMode: 'auto', maxScore: 1 },
        right: { mode: 'text', choices: [], gradingMode: 'auto', maxScore: 1 },
      },
      fillAnswerCombinations: [{
        id: 'alternative',
        answers: { left: ['组合备用甲保密哨兵'], right: ['组合备用乙保密哨兵'] },
      }],
    },
  } satisfies QuestionNode;
}
