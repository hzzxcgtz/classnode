/**
 * 「题目开放方式」四档：归一化 + 学生端闸门（★ 2026-09-30）。
 *
 * 🔴 这个文件存在的理由：那套闸门原先**内联在学生面板里**、零回归网，而本次加了第四档
 *（教师手动逐题开放）。加一档要改四处，**每一处漏改都不报错**：
 *   · 归一化（三份内联副本）；
 *   · 闸门分支；
 *   · 末尾「怎么解锁」那句提示（漏改 ⇒ 手动档对学生说「完成当前小题后继续解锁」）；
 *   · 「谁推进」这件事（学生交卷推进 vs 老师手动推进）。
 *
 * ⚠️ 跑法：`node --test src/lib/worksheet-answer-mode.test.ts`（类型擦除直接加载 `.ts`，
 * 所以下面 import 都带 `.ts` 后缀，且被加载的文件不能有**运行时** import）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUBMITTED_STATUS,
  WORKSHEET_ANSWER_MODES,
  answerModeView,
  normalizeAnswerMode,
  normalizeOpenQuestions,
  unlockHintFor,
} from './worksheet-answer-mode.ts';
import { groupAnswerable } from './worksheet-questions.ts';
import { TASK_TYPE } from './worksheet-questions.ts';
import type { WorksheetQuestionNode } from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 借题一个最小的合法节点（与 `worksheet-questions.test.ts` 同一套写法）。 */
function q(id: string, children: WorksheetQuestionNode[] = []): WorksheetQuestionNode {
  return { id, type: 'single-choice', prompt: `题干 ${id}`, inputMode: 'keyboard', data: {}, children };
}

function task(id: string, prompt: string, children: WorksheetQuestionNode[]): WorksheetQuestionNode {
  return { id, type: TASK_TYPE, prompt, inputMode: 'keyboard', data: {}, children };
}

/** 三题两段（任务一：a/b，任务二：c）—— 分步与手动两档都用它。 */
const GROUPS = groupAnswerable([task('t1', '任务一', [q('a'), q('b')]), task('t2', '任务二', [q('c')])]);

const ids = (view: ReturnType<typeof answerModeView>): string[] =>
  view.groups.flatMap(group => group.items.map(({ node }) => node.id));

/* ── 1. 归一化 ─────────────────────────────────────────────────────── */

test('🔴 四档原样保留，其余一律回 `open`（认不出时**不许**把学生的屏幕锁上）', () => {
  for (const mode of WORKSHEET_ANSWER_MODES) {
    assert.equal(normalizeAnswerMode(mode), mode);
  }
  for (const bad of ['', 'MANUAL', 'step', 'manual ', 42, null, undefined, {}, []]) {
    assert.equal(normalizeAnswerMode(bad), 'open', `${String(bad)} 应回落 open`);
  }
  // 阳性对照：四档**确实**是四个不同的值（不是「全都等于 open」那种假绿）。
  assert.equal(new Set(WORKSHEET_ANSWER_MODES).size, 4);
});

/* ── 2. 开放式：一道都不挡 ─────────────────────────────────────────── */

test('开放式：全放行，`openQuestions` 再怎么填也不起作用', () => {
  const view = answerModeView({
    groups: GROUPS, statuses: {}, answerMode: 'open',
    // 故意喂一份「只开了 c」的清单 —— 开放式下它必须被**整个忽略**
    //（老师从「手动」改回「开放式」之后，库里剩下的那些 id 不许继续截断卷子）。
    openQuestions: ['c'],
  });
  assert.deepEqual(ids(view), ['a', 'b', 'c']);
  assert.equal(view.hiddenCount, 0);
  assert.equal(view.unlockHint, '');
});

/* ── 3. 按任务分步：学生推进 ───────────────────────────────────────── */

test('按任务分步：只放行到「第一个还有没交的题」的那个任务', () => {
  const first = answerModeView({ groups: GROUPS, statuses: {}, answerMode: 'task-step', openQuestions: [] });
  assert.deepEqual(ids(first), ['a', 'b'], '第一个任务里全是空的 ⇒ 只给第一段');
  assert.equal(first.hiddenCount, 1);
  assert.equal(first.unlockHint, '完成当前任务后继续解锁');

  const second = answerModeView({
    groups: GROUPS, statuses: { a: SUBMITTED_STATUS, b: SUBMITTED_STATUS }, answerMode: 'task-step', openQuestions: [],
  });
  assert.deepEqual(ids(second), ['a', 'b', 'c'], '任务一交完 ⇒ 任务二出现');
  assert.equal(second.hiddenCount, 0);

  const all = answerModeView({
    groups: GROUPS, statuses: { a: SUBMITTED_STATUS, b: SUBMITTED_STATUS, c: SUBMITTED_STATUS },
    answerMode: 'task-step', openQuestions: [],
  });
  assert.deepEqual(ids(all), ['a', 'b', 'c'], '全交完 ⇒ 一道都不藏（回头检查不许看不见）');
  assert.equal(all.hiddenCount, 0);
});

/* ── 4. 按小题分步 ─────────────────────────────────────────────────── */

test('按小题分步：放行到第一道没交的题（含它），再往后全挡', () => {
  const none = answerModeView({ groups: GROUPS, statuses: {}, answerMode: 'question-step', openQuestions: [] });
  assert.deepEqual(ids(none), ['a']);
  assert.equal(none.hiddenCount, 2);
  assert.equal(none.unlockHint, '完成当前小题后继续解锁');

  const one = answerModeView({
    groups: GROUPS, statuses: { a: SUBMITTED_STATUS }, answerMode: 'question-step', openQuestions: [],
  });
  assert.deepEqual(ids(one), ['a', 'b']);
  // 跨段的那个空段要**整个去掉**：留一个只有标题的空壳会让那个任务看起来坏了。
  assert.equal(one.groups.length, 1);
  assert.equal(one.hiddenCount, 1);
});

/* ── 5. 手动逐题开放：教师推进 ─────────────────────────────────────── */

test('🔴 手动档**不看 `statuses`**（这是它与两种分步唯一的、最要紧的差别）', () => {
  // 🔴 两个方向都要钉，只钉一个方向会是假绿：
  //   · 只喂「全交完」⇒ 若实现要求「交了才显示」，结果同样是 ['b']（**分不出来**）；
  //   · 只喂「全没交」⇒ 若实现要求「没交才显示」… 同理。
  // ⇒ 同一份开放清单、两种极端状态，结果必须**逐字相同**。
  const opened = (statuses: Record<string, string>) => answerModeView({
    groups: GROUPS, statuses, answerMode: 'manual', openQuestions: ['b'],
  });
  const nothing = opened({});
  const everything = opened({ a: SUBMITTED_STATUS, b: SUBMITTED_STATUS, c: SUBMITTED_STATUS });
  assert.deepEqual(ids(nothing), ['b'], '一道都没交时，开着的 b 照样能作答');
  assert.deepEqual(ids(everything), ['b'], '全交完也一样 —— 交没交都不算数');
  assert.equal(nothing.hiddenCount, 2);
  assert.equal(nothing.unlockHint, '老师还没开放后面的题');
});

test('🔴 手动档：跳着开也照**题目顺序**排（不按开放顺序重排）', () => {
  // 老师先开第 3 题、再开第 1 题 —— 学生看到的顺序必须是题目的顺序，
  // 否则他手里那张卷子与老师对着讲的那张对不上号。
  const view = answerModeView({
    groups: GROUPS, statuses: {}, answerMode: 'manual', openQuestions: ['c', 'a'],
  });
  assert.deepEqual(ids(view), ['a', 'c']);
  assert.equal(view.hiddenCount, 1);
  // 两段各剩一道题 ⇒ 两段都留着（段里的题被挡光才是空段）。
  assert.equal(view.groups.length, 2);
});

test('🔴 手动档：一道都没开 ⇒ 什么都不显示，但**不是**「什么都没有」', () => {
  const view = answerModeView({ groups: GROUPS, statuses: {}, answerMode: 'manual', openQuestions: [] });
  assert.deepEqual(ids(view), []);
  assert.deepEqual(view.groups, []);
  // 学生那一屏要靠这个数说「后面还有 3 道小题」—— 少了它，屏幕上就是一片空白
  //（那种「看着像加载失败」的状态正是本仓最防的）。
  assert.equal(view.hiddenCount, 3);
  assert.equal(view.unlockHint, '老师还没开放后面的题');
});

test('手动档：清单里那些**已不存在的题 id** 无害（老师删了题之后库里的残留）', () => {
  const view = answerModeView({
    groups: GROUPS, statuses: {}, answerMode: 'manual', openQuestions: ['a', 'q_已经删了'],
  });
  assert.deepEqual(ids(view), ['a']);
  assert.equal(view.hiddenCount, 2);
});

/* ── 6. 空卷 / 提示语 ──────────────────────────────────────────────── */

test('没有题目的学习单：四档都不炸，隐藏数恒为 0', () => {
  for (const mode of WORKSHEET_ANSWER_MODES) {
    const view = answerModeView({ groups: [], statuses: {}, answerMode: mode, openQuestions: ['x'] });
    assert.deepEqual(view.groups, [], `${mode}`);
    assert.equal(view.hiddenCount, 0, `${mode}`);
  }
});

test('🔴 四档各自那句解锁提示**互不相同**（加第五档时漏改就会红）', () => {
  // 这是本条用例真正的用途：`manual` 是第四档，而它最容易的漏改就是复用
  // 「完成当前小题后继续解锁」—— 一句学生**做不到**的假话。
  const hints = WORKSHEET_ANSWER_MODES.map(unlockHintFor);
  assert.equal(hints[0], '', '开放式没有「解锁」可言 ⇒ 空串（不渲染那半句）');
  assert.equal(new Set(hints.slice(1)).size, hints.length - 1, `三档的提示语撞了：${hints.join(' / ')}`);
});

test('🔴 收线上那份 id 清单：坏形状丢掉、重复去掉，认不出一律空数组', () => {
  // 两个来路都是外部输入（`student-view` 的读取、socket 广播）—— 一条坏载荷不许让
  // 学生那一屏莫名其妙少几道题（而屏幕上完全看不出是数据坏了）。
  assert.deepEqual(normalizeOpenQuestions(['q1', 42, '', null, 'q1', {}, 'q2']), ['q1', 'q2']);
  for (const bad of [null, undefined, 'q1', 42, {}]) {
    assert.deepEqual(normalizeOpenQuestions(bad), [], `${String(bad)} 应回空数组`);
  }
  // 阳性对照：合法的清单必须原样读出来（否则上面那条「回空」什么都没证明）。
  assert.deepEqual(normalizeOpenQuestions(['q1', 'q2']), ['q1', 'q2']);
});

/* ── 7. 跨文件：那个状态字面量 ─────────────────────────────────────── */

test('🔴 `submitted` 这个字面量在 `app/` 那侧仍然成立（改名会让分步档静默失效）', () => {
  // 🔴 `lib/` 不许依赖 `app/`（方向问题）⇒ 本文件按**结构**收状态、只认这一个字面量。
  //    它哪天在 `app/` 里被改名，这里的判据会**静默**把每一道题都当成「没交」
  //    （表现：分步档下学生永远只看到第一个任务）。所以去那个类型声明里核一遍。
  const source = fs.readFileSync(
    path.resolve(HERE, '../app/classroom/worksheet/use-worksheet-answers.ts'), 'utf8');
  const found = source.match(/export type WorksheetQuestionStatus\s*=\s*([^;]+);/);
  assert.ok(found, '`WorksheetQuestionStatus` 的类型声明没找到 —— 是抽取写错了，不是它改了');
  assert.ok(found[1].includes(`'${SUBMITTED_STATUS}'`),
    `那个联合类型里没有 '${SUBMITTED_STATUS}'：${found[1].trim()}`);
});
