/**
 * ★ 分析闸门必须覆盖全部可作答题型，并明确排除 `task` 容器。
 * 本地判分回答“对了多少”，智能体分析继续解释“答案反映了怎样的理解方式”；
 * 两者不是互斥集合。前端注册表的对拍在 `src/lib/analysis-gate-parity.test.ts`。
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
 * ⚠️ 「`task` 两边都不属于」那一条**不在本文件里**（本文件只测那个二分法，
 * 而 `task` 已被 `ANSWERABLE_TYPES` 滤掉、根本不进循环）。它在
 * `worksheet-task.test.ts`：那边用真的 `grade()` 与真的 `isAnalyzableType()`
 * 各钉一次。本条注释原先写的是「下面另有一条用例」—— **本文件里没有那一条**。
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

test('阳性对照：夹具本身要立得住（可判分题判出分、两个主观题不判分）', () => {
  assert.ok(ANSWERABLE_TYPES.length > 2, '题型表里不止两个题型，否则本用例空转');
  const graded = ANSWERABLE_TYPES.filter((t) => grade(nodeOf(t), valueOf(t), DEFAULT_POINTS) !== null);
  assert.equal(graded.length, ANSWERABLE_TYPES.length - 2,
    `夹具应当让「除那两个之外」全部判出分，实际判出分的：${graded.join(', ')}`);
  // 两个主观题必须恰好回 null（夹具的答案值不是 ink，所以 drawing 走的是「题型」那一格闸）
  for (const t of ['short-answer', 'drawing']) {
    assert.equal(grade(nodeOf(t), valueOf(t), DEFAULT_POINTS), null, `${t} 不该判分`);
  }
});

test('★ 可作答题型全部支持智能体分析，只有 task 容器不进入', () => {
  assert.deepEqual([...ANALYZABLE_TYPES].sort(), [...ANSWERABLE_TYPES].sort());
  for (const type of ANSWERABLE_TYPES) assert.equal(isAnalyzableType(type), true, `${type} 应支持分析`);
  assert.equal(isAnalyzableType('task'), false, '任务容器没有作答值');
});

test('闸门对非字符串/空值/未知题型一律为假（不抛）', () => {
  for (const bad of [undefined, null, 42, '', 'nope', {}, []]) {
    assert.equal(isAnalyzableType(bad), false, `${String(bad)} 不该放行`);
  }
});

test('反证：从闸门里抽掉任一可作答题型 ⇒ 注册表对拍必须发现', () => {
  const fake = ANALYZABLE_TYPES.filter((t) => t !== 'single-choice');
  assert.notDeepEqual([...fake].sort(), [...ANSWERABLE_TYPES].sort());
  assert.deepEqual(ANSWERABLE_TYPES.filter((type) => !fake.includes(type)), ['single-choice']);
});
