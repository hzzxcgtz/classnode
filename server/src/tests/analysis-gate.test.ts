/**
 * ★ M7a：闸门（谁可以被「分析」）必须与另外两个推导**三方一致**。
 *
 * 仓里今天有**两个**「主观题」的推导，而它们恰好等价但没有任何东西守着：
 *   · 前端**声明式**：`src/lib/worksheet-questions.ts` 的 `graded: false`
 *     （`:101` short-answer、`:110` drawing）
 *   · 服务端**行为式**：`worksheet-questions.ts` 的 `JUDGES` 里
 *     `'short-answer': () => null`（`:870`）与 `drawing: () => null`（`:878`）
 * 本设计引入**第三个**：`ANALYZABLE_TYPES`。
 * ⇒ 三者里任意两个分叉的表现是「教师对一道会自动判分的客观题也能点『分析』」
 *   或「主观题没有入口」—— **两个方向都不报错、没有测试红**。
 *
 * 本文件钉住「服务端注册表 × judge 行为 × 闸门」这条边；
 * 「前端 graded × 服务端闸门」那条边在前端的 `src/lib/analysis-gate-parity.test.ts` 里
 * （服务端的 `worksheet-questions.ts` 带 import，前端 runner 加载不了它）。
 *
 * ⚠️ 本文件的夹具必须让 7 个客观题**真的判出分**（不是靠「形状不合也算 incorrect」）——
 * 那样将来某个判分器对畸形输入改回 `null` 时，这条用例会**假红**，而假红会被当成噪音忽略。
 */
import { test } from 'node:test';

/**
 * ★ 2026-09-25：**可作答的**题型 —— 即 `QUESTION_TYPES` 去掉容器（`task`）。
 *
 * 🔴 本文件那几条遍历测的是**二分法**：「每个题型，要么判分、要么送去 AI 分析」。
 * 而 `task`（任务容器）**两者都不是** —— 它**根本没有作答值**（教师裁定 ①a）。
 * ⇒ 它不该进那两个集合中的任何一个，但**必须被显式地排除**：
 * 直接用 `QUESTION_TYPES` 会让 `task` 从缝里掉进「不判分 ⇒ 那就该送去分析」那一侧，
 * 而那正是这道闸存在的意义（把「没作答值」误判成「主观题」）。
 * 下面另有一条用例专门钉住 `task` 两边都不属于。
 */
const ANSWERABLE_TYPES = QUESTION_TYPES.filter((t) => t !== 'task');
import assert from 'node:assert/strict';
import {
  DEFAULT_POINTS, QUESTION_TYPES, grade, type QuestionNode,
} from '../services/worksheet-questions.js';
import { ANALYZABLE_TYPES, isAnalyzableType } from '../services/analysis-gate.js';

/** 造一道「数据齐全、答案对得上」的题 —— 让它判出 `correct` 而不是靠畸形回落。 */
function nodeOf(type: string): QuestionNode {
  const data: Record<string, unknown> = {};
  switch (type) {
    case 'single-choice': case 'true-false': case 'multi-choice':
      data.options = [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }];
      data.correctKeys = ['a'];
      break;
    case 'fill-blank':
      data.blanks = [{ answers: ['甲'] }];
      break;
    case 'order':
      data.correctOrder = ['a', 'b'];
      break;
    case 'match':
      data.pairs = [{ leftId: 'l1', rightId: 'r1' }];
      break;
    case 'categorize':
      data.items = [{ id: 'a' }];
      data.placement = { a: 'z1' };
      break;
    default:
      break;
  }
  return { id: 'q1', type: type as QuestionNode['type'], prompt: '题干', inputMode: 'keyboard', data, children: [] };
}

/** 与 `nodeOf` 配套的、**答对**的作答值。 */
function valueOf(type: string): unknown {
  switch (type) {
    case 'single-choice': case 'true-false': case 'multi-choice':
      return { format: 'choice/v1', selected: ['a'] };
    case 'fill-blank':
      return { format: 'fill-multi/v1', texts: ['甲'] };
    case 'short-answer':
      return { format: 'text/v1', text: '我的看法' };
    case 'order':
      return { format: 'order/v1', order: ['a', 'b'] };
    case 'match':
      return { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }] };
    case 'categorize':
      return { format: 'categorize/v1', assignment: { a: 'z1' } };
    case 'drawing':
      return {
        format: 'ink/v1', canvas: { w: 320, h: 240 },
        strokes: [{ points: [[0, 0], [1, 1]], width: 0.01, color: '#111111' }],
      };
    default:
      return null;
  }
}

test('阳性对照：夹具本身要立得住（7 个客观题判出分、2 个主观题不判分）', () => {
  assert.ok(ANSWERABLE_TYPES.length > 2, '题型表里不止两个题型，否则本用例空转');
  const graded = ANSWERABLE_TYPES.filter((t) => grade(nodeOf(t), valueOf(t), DEFAULT_POINTS) !== null);
  assert.equal(graded.length, ANSWERABLE_TYPES.length - 2,
    `夹具应当让「除那两个之外」全部判出分，实际判出分的：${graded.join(', ')}`);
  // 两个主观题必须恰好回 null（夹具的答案值不是 ink，所以 drawing 走的是「题型」那一格闸）
  for (const t of ['short-answer', 'drawing']) {
    assert.equal(grade(nodeOf(t), valueOf(t), DEFAULT_POINTS), null, `${t} 不该判分`);
  }
});

test('★ 注册表 × judge 行为 × 闸门：三方必须逐题型一致（遍历全部题型，不是只测那两个）', () => {
  const misaligned: string[] = [];
  for (const type of ANSWERABLE_TYPES) {
    const notGraded = grade(nodeOf(type), valueOf(type), DEFAULT_POINTS) === null;
    if (notGraded !== isAnalyzableType(type)) {
      misaligned.push(`${type}: judge 回 ${notGraded ? 'null（不判分）' : '有判分'}，而闸门说 isAnalyzableType=${isAnalyzableType(type)}`);
    }
  }
  assert.deepEqual(misaligned, [], `闸门与判分器的口径分叉了：\n  ${misaligned.join('\n  ')}`);
});

test('闸门只放这两个题型，且对非字符串/空值一律为假（不抛）', () => {
  assert.deepEqual([...ANALYZABLE_TYPES].sort(), ['drawing', 'short-answer']);
  for (const bad of [undefined, null, 42, '', 'nope', {}, []]) {
    assert.equal(isAnalyzableType(bad), false, `${String(bad)} 不该放行`);
  }
});

test('反证：往闸门集合里塞一个客观题 ⇒ 三方对拍必须红', () => {
  // 不真改源码：把同一套判据喂给一份「多了一个 single-choice」的假集合。
  const fake = [...ANALYZABLE_TYPES, 'single-choice'];
  const misaligned = ANSWERABLE_TYPES.filter((t) =>
    (grade(nodeOf(t), valueOf(t), DEFAULT_POINTS) === null) !== fake.includes(t));
  assert.ok(misaligned.includes('single-choice'), '多放一个客观题必须被三方对拍发现');
});

test('反证：从闸门里抽掉一个主观题 ⇒ 三方对拍必须红', () => {
  const fake = ANALYZABLE_TYPES.filter((t) => t !== 'drawing');
  const misaligned = ANSWERABLE_TYPES.filter((t) =>
    (grade(nodeOf(t), valueOf(t), DEFAULT_POINTS) === null) !== fake.includes(t));
  assert.deepEqual(misaligned, ['drawing'], '抽掉 drawing 必须被发现，且只报它一个');
});
