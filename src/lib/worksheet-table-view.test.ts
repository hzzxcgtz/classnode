/**
 * 表格填空的**渲染层源码网**（★ 2026-09-28）。
 *
 * 网格与表格那一层在本机**一行都跑不到**（没有 jsdom、没有浏览器），所以能守的只有
 * 「源码里有没有人写出某一种形状」。这里守的是两件**都没有别的东西守**的事：
 *
 * ① 🔴 **两个空必须是同一个全局类。** 题干里的空用 `worksheet-blank-input`
 *   （`globals.css` 里的全局类，焦点态与自适应宽度都在那儿），表格里的空**必须引同一个**。
 *   这条纪律两边注释里都写着（「另写一份的症状是『题干里的空与表格里的空长得不一样』，
 *   而两边都不报错」），但在这次之前**没有任何东西守着它** —— 把类名换成
 *   `worksheet-table-input`，屏幕上只是那一格的焦点框变了，没有任何报错。
 *   ⚠️ 断言写成**从 PromptText 里读出那个类名、再看表格那份用不用同一个字符串**：
 *      两边各写一份字面量的话，改了一处另一处不动，而这条网会红。
 *      （不写成「等于 `'worksheet-blank-input'`」—— 那样只钉住了一个字面量，
 *        两处同时写错还是绿。）
 *   ⚠️ 顺带钉住那个类**真的在 `globals.css` 里存在**：类名打错时样式静默失效。
 *
 * ② 两个文件里**一个 `position` 都不许有** —— 与 `worksheet-prompt-text.test.ts` 逐字
 *   同一条规矩（标记不许浮到内容上面去）。表格那一份尤其容易破：格子窄，
 *   「把答错那个记号塞到格子右上角」是很自然的下一步。
 *   ★ 2026-09-29：答错从「一枚红叉」改成「那个值的字变暗红 + 删除线」之后，
 *     这一条**一个字都没变**（变的只是那个诱惑的形状）—— 守的仍然是「不许浮到内容上面」。
 *
 * ⚠️ 只读文本、不渲染任何东西 ⇒ 本机跑得起来。
 * ⚠️ 它**不查好不好看**：列宽、横向滚动的手感、软键盘顶不顶掉那一格，只能真机看。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_SOURCE = fs.readFileSync(path.join(HERE, 'worksheet-prompt-text.tsx'), 'utf8');
const TABLE_SOURCE = fs.readFileSync(path.join(HERE, 'worksheet-table-view.tsx'), 'utf8');
const MARK_SOURCE = fs.readFileSync(path.resolve(HERE, '../components/worksheet-wrong-mark.tsx'), 'utf8');
const GLOBAL_CSS = fs.readFileSync(path.resolve(HERE, '../app/globals.css'), 'utf8');

/** 块注释（含 JSX 的 `{/* … *\/}`）与整行 `//` 注释。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 从源码里读出一个 `className="…"` 的字符串字面量（只认最简单的形态 —— 这是刻意的）。 */
function classNameLiteral(source: string): string | null {
  const found = /className="([^"{}]+)"/.exec(stripComments(source));
  return found ? found[1] : null;
}

test('🔴 表格里的空与题干里的空引的是**同一个**全局类', () => {
  const promptClass = classNameLiteral(PROMPT_SOURCE);
  const tableClass = classNameLiteral(TABLE_SOURCE);
  assert.ok(promptClass, '题干那一份必须有一个字符串形态的 className（读不出来说明它换了写法，这条网要跟着改）');
  assert.ok(tableClass, '表格那一份必须有一个字符串形态的 className');
  assert.equal(tableClass, promptClass, '两处必须是同一个类名 —— 各写一份就会「同一个空、两处长得不一样」');
});

test('🔴 那个全局类真的在 globals.css 里（打错字时样式静默失效）', () => {
  const promptClass = classNameLiteral(PROMPT_SOURCE);
  assert.ok(promptClass);
  assert.ok(
    GLOBAL_CSS.includes(`.${promptClass}`),
    `globals.css 里没有 .${promptClass} —— 类名打错不会有任何报错，只是那一格没有样式`,
  );
});

test('🔴 表格那一份里一个定位都没有（标记不许浮到内容上面去）', () => {
  const bare = stripComments(TABLE_SOURCE);
  assert.ok(!/\bposition\s*:/.test(bare), '表格渲染器里出现了 position —— 那正是「红叉盖住字」那条老路');
});

/**
 * 连 `import` 行也剥掉。
 *
 * 🔴 这一层是**变异检验抓出来的**：第一版断言写的是「源码里出现过 `blankValueStyle`」，
 * 而那个名字**还留在 import 行里** ⇒ 把调用点整个删掉、只留一行 import，断言照样绿。
 * ⇒ 「名字出现过」不等于「那件事被做了」，所以先把 import 行剥掉再查。
 * ⚠️ 按行剥，假设这几个文件的 import 都是**单行**（今天都是；换了写法这条要跟着改）。
 */
function stripImports(source: string): string {
  return source.split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
}

test('阳性对照：剥注释之后仍然能看见真正的东西（这条网不是靠「什么都没匹配到」变绿的）', () => {
  // ⚠️ 没有这几条的话，上面两条「不许有 X」的断言在**文件被读空**时也会绿。
  const bareTable = stripComments(TABLE_SOURCE);
  const barePrompt = stripComments(PROMPT_SOURCE);
  // ★ 2026-09-29（教师）：「错误的边上加一个红色的叉叉符号……改用暗红色文字加删除线。」
  // ⇒ 表格那一份**不再画那枚叉**。⚠️ 这一句不能只是删掉：它是「这里真的有东西可守」的
  // 证据，删了之后「顺手把标记整个去掉」会让上面那条（不许定位）更绿。
  // ⇒ 换成断言**标记仍然在**（只是从一枚节点变成了那个值的样式）。
  assert.ok(stripImports(bareTable).includes('WRONG_ANSWER_STYLE'), '表格那一份必须仍然标出答错（换成了样式）');
  assert.ok(bareTable.includes('aria-label'), '空的那几格必须有读屏标签（第 R 行第 C 格）');
  assert.ok(bareTable.includes('overflowX'), '表格必须能横向滚动（iPad 竖屏放不下）');
  assert.ok(barePrompt.includes('worksheet-blank-input'), '题干那一份的空用的就是那个全局类');
  assert.ok(stripComments(MARK_SOURCE).length > 0, '那枚标记的文件不是空的');
});
