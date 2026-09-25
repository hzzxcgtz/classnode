/**
 * ★ M7a：**服务端闸门与前端 `graded: false` 必须是同一个集合。**
 *
 * 两个推导分叉的表现是静默的：教师对一道会自动判分的客观题也能点「分析」，
 * 或者一道主观题没有入口 —— 两个方向都不报错、没有测试红。
 * （服务端还有第三份口径：`JUDGES` 里那两格恒回 `null`。那条边由
 * `server/src/tests/analysis-gate.test.ts` 钉住 —— 它加载不了进本文件，
 * 因为服务端的 `worksheet-questions.ts` 带 import。）
 *
 * 🔴 **必须遍历全部题型，不能只断言那两个。** 只断言 `{short-answer, drawing}` 的话，
 * 将来加第 10 个题型而只改了一边时，这条用例**照样绿**。所以下面同时断言
 * 「前端 `graded` 全集 == 前端题型表全集」（防漏一个 `graded` 字段）
 * 与「两边的不判分集合相等」。
 *
 * ⚠️ 跨工程 import 用 `.ts` 扩展名（Node 不会把 `.js` 解析成 `.ts`）——
 * 写法照抄 `worksheet-ink-parity.test.ts`（那条已经跑通）。被加载的
 * `analysis-gate.ts` **零 import**，所以类型擦除加载得起来。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUESTION_TYPE_OPTIONS } from './worksheet-questions.ts';
import { ANALYZABLE_TYPES } from '../../server/src/services/analysis-gate.ts';

test('阳性对照：前端题型表的每一项都有布尔 `graded`（少了它 `!o.graded` 会把谁都算成主观题）', () => {
  assert.ok(QUESTION_TYPE_OPTIONS.length > 2, '题型表里不止两个题型，否则本用例空转');
  const missing = QUESTION_TYPE_OPTIONS.filter((o) => typeof o.graded !== 'boolean').map((o) => o.value);
  assert.deepEqual(missing, [], `这些题型没有布尔 graded：${missing.join(', ')}`);
});

test('★ 前端 graded:false 的集合与服务端闸门集合相等（遍历全部题型）', () => {
  const notGraded: string[] = QUESTION_TYPE_OPTIONS.filter((o) => !o.graded).map((o) => o.value);
  assert.ok(notGraded.length > 0, '阳性对照：必须至少有一个 graded:false 的题型');
  assert.deepEqual(
    [...notGraded].sort(),
    [...ANALYZABLE_TYPES].sort(),
    '前端「不自动判分」的题型与服务端「可分析」的闸门分叉了 —— 教师会对客观题点出「分析」，或主观题没有入口',
  );
});

test('反证：往闸门里多塞一个客观题 ⇒ 上一条必须红', () => {
  const notGraded: string[] = QUESTION_TYPE_OPTIONS.filter((o) => !o.graded).map((o) => o.value);
  const fake = [...ANALYZABLE_TYPES, 'single-choice'];
  assert.notDeepEqual([...notGraded].sort(), [...fake].sort(), '判据必须能发现「多放了一个客观题」');
  assert.deepEqual(fake.filter((t) => !notGraded.includes(t)), ['single-choice']);
});

test('反证：从前端抽掉一个 graded:false ⇒ 上一条必须红（另一个方向也要有牙）', () => {
  const fakeOptions = QUESTION_TYPE_OPTIONS.map((o) => (o.value === 'drawing' ? { ...o, graded: true } : o));
  const notGraded: string[] = fakeOptions.filter((o) => !o.graded).map((o) => o.value);
  assert.notDeepEqual([...notGraded].sort(), [...ANALYZABLE_TYPES].sort(),
    '把 drawing 改成 graded:true 之后，两边必须不再相等 —— 否则这条边只在一个方向上有守护');
});
