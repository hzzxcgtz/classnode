/**
 * 面板 → `QuestionInput` 的**接线网**。
 *
 * 🔴 这个文件是一次真 bug 的产物（2026-09-29，教师：「连线题在批改后，如果错误的话，
 * 没有出现错误信息」）。根因不是连线题的渲染，也不是服务端 —— 是**面板漏传了一个 prop**：
 *   · 服务端 2026-09-28 就修好了（`wrongAnswers` 按题型分派，连线题发
 *     「《绝句》 → 《杜甫》」那样一整句话）；
 *   · 客户端那一半（`f6b6ab8`）只给 `ChoiceBlankAnswer` 那条路加了 `correctBlanks`
 *     —— 而**填空题 / 选择填空走的就是那条路**，所以它们当场就好了；
 *   · 连线题走的是 `QuestionInput` 那条路，而那个调用点**从来没接过** `correctBlanks`
 *     ⇒ 学生答错了什么也不显示，**全程没有一处报错**。
 *
 * ⇒ 立的规矩：**面板必须把 `QuestionInputProps` 的每一个可选 prop 都传下去**。
 *   可选 prop 正是「能忘」的那些 —— 必填的漏了是编译错误，而可选的一漏就是
 *   「功能静默地什么都没做」。
 *
 * ⚠️ **只管面板这一个调用点**：教师端的「学生端预览」（`preview-modal.tsx`）**刻意不传**
 * `correctKeys`（传了会让教师以为学生也看得到答案）。那是有意的，不在本网的射程内。
 *
 * ⚠️ 只读文本、不渲染任何东西 ⇒ 本机（无 jsdom、无浏览器）跑得起来。
 * ⚠️ 它**不查好不好看**：它只回答一个问题 —— **有没有哪一个可选 prop 在面板那条路上丢了**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = fs.readFileSync(path.join(HERE, 'worksheet-panel.tsx'), 'utf8');
const DISPATCHER = fs.readFileSync(path.join(HERE, 'questions/index.tsx'), 'utf8');

/**
 * `QuestionInputProps` 里所有**可选** prop 的名字。
 *
 * ⚠️ 只认 `名字?: 类型` 这一种写法（本仓的接口就是这么写的）。换个写法读不出来时
 * 下面第一条断言会红 —— 那是刻意的：**读不出来就等于这条网瞎了**，不能静默地变成空集。
 */
function optionalPropNames(source: string): string[] {
  const block = /export interface QuestionInputProps \{([\s\S]*?)\n\}/.exec(source);
  if (!block) return [];
  return [...block[1].matchAll(/^\s{2}(\w+)\?:/gm)].map((match) => match[1]);
}

/** 面板里那一次 `<QuestionInput … />` 调用（从标签到自闭合的那一对括号）。 */
function questionInputCall(source: string): string | null {
  const found = /<QuestionInput\b([\s\S]*?)\/>/.exec(source);
  return found ? found[1] : null;
}

test('🔴 面板必须把 `QuestionInput` 的每一个**可选** prop 都传下去', () => {
  const names = optionalPropNames(DISPATCHER);
  const call = questionInputCall(PANEL);
  assert.ok(call, '面板里必须能读出那一次 `<QuestionInput … />` 调用（读不出来说明它换了写法，这条网要跟着改）');
  const missing = names.filter((name) => !new RegExp(`\\b${name}=`).test(call));
  assert.deepEqual(
    missing, [],
    `面板没有传这些可选 prop：${missing.join(' / ')}。`
    + '可选 prop 漏了**不会有任何编译错误**，只会让那个功能静默地什么都不做'
    + '（2026-09-29 那条：连线题的正确答案就是这样一直没显示出来）。',
  );
});

test('阳性对照：这条网真的读到了东西（不是靠两个空集合变绿的）', () => {
  const names = optionalPropNames(DISPATCHER);
  // ① 接口那段真的被解析出来了，而且里面确实有可选 prop。
  //    少了这一条，「正则没匹配到 ⇒ names 是空数组 ⇒ 上面那条恒绿」。
  assert.ok(names.length >= 2, `可选 prop 至少要有两个，实际读到 ${JSON.stringify(names)}`);
  assert.ok(names.includes('correctBlanks'), '`correctBlanks` 就是这次漏掉的那一个，它必须在名单里');
  // ② 那一次调用真的被读到了（而不是一个空片段）。
  const call = questionInputCall(PANEL);
  assert.ok(call && call.length > 80, '读到的调用片段太短，多半是正则匹配错了地方');
  assert.ok(/\bnode=/.test(call), '片段里应当有 `node=` —— 它是必填项，证明读到的是那一次调用');
});
