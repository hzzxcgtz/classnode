/**
 * ★ 2026-10-05（教师）：「点击新任务后，焦点要跳到这个任务的标题，提示用户输入任务标题。」
 *
 * 🔴 本仓没有 jsdom、没有浏览器 ⇒「点一下按钮焦点真的跳过去了没有」在本机**验不了**
 *    （那要真机走查：点「＋ 添加任务」，光标应在标题框里，且「新任务标题」整段选中）。
 *    这一条网能回答的只有：**那几个零件在不在、谁接谁** —— 与 `math-entry.test.ts` 同一路数。
 *
 * 接线一共三处，缺一处都会**静默失效**（屏幕上只是「焦点没跳」）：
 *   ① 两个「添加任务」按钮都必须走**同一个**入口（`addTaskAndFocusTitle`）——
 *      直接 `editor.addTask()` 会加出一个不选中、不聚焦的任务；
 *   ② 页面要能从新树里认出**刚加的那个任务**并选中它 + 记下「要聚焦谁」；
 *   ③ 任务卡要真的 `focus()` + `select()`，而且做完**销账**（否则之后每次渲染都抢焦点，
 *      教师打字打到一半会被拽回来）。
 *
 * ⚠️ 断言一律先剥 import 与注释：`focusTitle` 这种名字本来就出现在 props 类型与注释里，
 *    不剥的话「把调用点删掉、只留声明」照样绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(HERE, 'page.tsx'), 'utf8');
const TASK = fs.readFileSync(path.join(HERE, 'task-card.tsx'), 'utf8');

/** 块注释、整行 `//` 注释、以及 `{/* … *\/}` 里的 JSX 注释。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function stripImports(source: string): string {
  return source.split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
}

const live = (source: string) => stripImports(stripComments(source));

test('阳性对照：读到的确实是这两个文件（否则下面几条对空串永远绿）', () => {
  assert.ok(live(PAGE).length > 3000, '剥完之后剩下的仍是编辑页');
  assert.ok(live(TASK).length > 1000, '剥完之后剩下的仍是任务卡');
});

test('🔴 两个「添加任务」按钮都走同一个入口（不再直接调 `editor.addTask()`）', () => {
  const page = live(PAGE);
  const a = (page.match(/onClick=\{addTaskAndFocusTitle\}/g) ?? []).length;
  assert.equal(a, 2, `两个「添加任务」按钮要都走 addTaskAndFocusTitle（现在 ${a} 个）`);
  // 🔴 反面：**除了那个入口自己**，别处一律不许直接加任务 —— 直接加 = 加出一个不选中、
  //    不聚焦的任务（教师得自己找到它、再点一下标题框，而屏幕上没有任何提示）。
  const withoutHandler = page.replace(
    /const addTaskAndFocusTitle = useCallback\(\(\) => \{[\s\S]*?\}, \[blocks, editor\]\);/,
    '',
  );
  assert.ok(!/editor\.addTask\(\)/.test(withoutHandler), '还有人直接调 editor.addTask() —— 那个新任务不会被选中/聚焦');
  // 入口本人在加之前先记下现有的任务 id（比对出「刚加的是哪一个」的那份底稿）。
  assert.match(
    page,
    /const addTaskAndFocusTitle = useCallback\(\(\) => \{[\s\S]{0,200}?pendingNewTaskIds\.current = new Set\(/,
    'addTaskAndFocusTitle 没有先记下现有的任务 id —— 之后就认不出新任务',
  );
});

test('🔴 页面能把「刚加的那个任务」认出来：选中它 + 请求把焦点落到它的标题上', () => {
  const page = live(PAGE);
  // 判据是 pendingNewTaskIds（与「新题自动选中」同一手法）。
  assert.match(page, /pendingNewTaskIds\.current = null;/, '认出新任务之后没有销账（会反复选中/聚焦）');
  assert.match(page, /setFocusTaskTitleId\(task\.node\.id\)/, '没有记下「要聚焦哪一个任务的标题」');
  assert.match(page, /selectTask\(block\)/, '新任务没有被选中 —— 主工作区会停在旧任务上');
  // ⚠️ 焦点**不在这里**用 DOM 查询硬找：新任务这一刻还没渲染出来（见 page.tsx 的注释）。
  assert.ok(!/querySelector[^;]*worksheet-editor-task-title/.test(page), '页面又用 DOM 查询去抓标题框了');
  // 一次性请求：任务卡聚焦完回调销账。
  assert.match(page, /const clearTaskTitleFocus = useCallback\(\(\) => setFocusTaskTitleId\(null\), \[\]\)/,
    '没有销账的回调 —— 每次渲染都会抢一次焦点');
  assert.match(page, /focusTitle=\{focusTaskTitleId === activeBlock\.task\.node\.id\}/, 'TaskCard 没有拿到 focusTitle');
  assert.match(page, /onTitleFocused=\{clearTaskTitleFocus\}/, 'TaskCard 没有拿到销账回调');
});

test('🔴 任务卡：聚焦 + 整段选中 + 销账，三件事都在', () => {
  const task = live(TASK);
  assert.match(task, /focusTitle\?: boolean;/, 'TaskCard 没有 focusTitle 这个 prop');
  assert.match(task, /ref=\{titleRef\}/, '标题框没有 ref —— 拿不到 DOM 就没法聚焦');
  assert.match(task, /input\?\.focus\(\)/, '没有把焦点落到标题框');
  // 🔴 整段选中不是装饰：标题里预填的是**一句提醒**（`新任务标题`），选中它 ⇒ 直接打字就替换掉
  //    不用先按退格清空；少了这一句，教师得先全选/删一遍，那个提醒就成了负担。
  assert.match(task, /input\?\.select\(\)/, '没有整段选中标题 —— 那句提醒得先手动删掉才写得进去');
  assert.match(task, /onTitleFocused\?\.\(\)/, '聚焦完没有销账 —— 之后每次渲染都会再抢一次焦点');
});
