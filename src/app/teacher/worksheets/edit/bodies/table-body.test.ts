/**
 * ★ 2026-09-30（教师选「A」）：表格填空题编辑器的新形状。
 *
 * 教师原话：「这个表格填空的编辑有没有更好的实现方式？现在看了有点简陋，不够直观」，
 * 并在三条路里选了 A：**「填空」收进格子里**，填空格长得就像学生看到的那个空。
 *
 * 🔴 本仓没有 jsdom、没有浏览器 ⇒「看上去直不直观」在本机**验不了**。
 *    这一条网能回答的只有：**那一格的 DOM 是不是按定的形状写的**。
 *    ⚠️ 真机走查要看的：整张表是不是矮了一半、填空格是不是一眼认得出、
 *       小方框点得准不准（它只有 15px）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BODY = fs.readFileSync(path.join(HERE, 'table-body.tsx'), 'utf8');

/** 块注释（含 JSX 的 `{/* … *\/}`）与整行 `//` 注释。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 连 `import` 行也剥掉（那些名字**本来就出现在 import 里**）。 */
function stripImports(source: string): string {
  return source.split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
}

const body = stripImports(stripComments(BODY));

test('★ 填空格**不给输入框** —— 那一格是留给学生作答的', () => {
  assert.ok(body.length > 1000, '阳性对照：剥完注释与 import 之后剩下的仍是这个组件');
  // 🔴 这条是本轮改动的**实质**：学生端**从不渲染**填空格里的文字
  //    （`worksheet-table-view.tsx` 只画输入框/落点槽）⇒ 留一个输入框只会让教师
  //    打进去一段**学生永远看不到**的字，而屏幕上一切正常。
  // ⚠️ 锚**花括号一起**匹配：`!isBlank ? (` 里面**含有** `isBlank ? (` 这个子串 ⇒
  //    不带花括号的话，「把条件取反、两个分支对调」照样绿（变异检验抓出来的假绿）。
  const at = body.indexOf('{isBlank ? (');
  assert.ok(at >= 0, '找不到「是填空格」那个分支（或者它的条件被取反了）');
  const blankBranch = body.slice(at, body.indexOf(') : (', at));
  assert.ok(blankBranch.includes('worksheet-editor-table-blank-face'), '填空格没有那个「学生填」的样子');
  assert.ok(!blankBranch.includes('<input'), '填空格里还有一个输入框 —— 打进去的字学生看不到');
  // 另一半：普通格**必须**留着输入框（少了它教师一个字都打不进去）。
  // ⚠️ 边界取「三元表达式结束、那个小方框的 label 开始」——
  //    第一版按 `</td>` 取，而普通格那支一旦空了，`</td>` 就跑到很远的地方去，
  //    切片把文件剩下的部分整个吞进来 ⇒ 「把输入框删掉」照样绿（变异检验抓出来的假绿）。
  const plainBranch = body.slice(body.indexOf(') : (', at), body.indexOf('blank-toggle', at));
  assert.ok(plainBranch.includes('<input'), '普通格没有输入框（教师一个字都打不进去）');
});

test('★ 那个小方框仍然是**真的复选框**（读屏与键盘天然可用），而且有名字', () => {
  // ★ 2026-09-28 那条理由不变（「用真的复选框：读屏与键盘都天然可用，
  //   也不用为它写一套按钮的选中态样式」）—— 本次只把它从「独占一行的
  //   `☐ 填空`」缩成「右上角一个小方块」，**没有**换成自定义按钮。
  assert.match(body, /className="worksheet-editor-table-blank-toggle"[\s\S]{0,400}?type="checkbox"/,
    '那个小方框不再是真的复选框了');
  // 🔴 它现在**没有文字**了 ⇒ 名字只能由 `aria-label` 给。
  //    少了它，读屏读出来是一个没有名字的勾选框（只有 `title` 是不够的：
  //    title 对触屏与读屏都不是可靠的可访问名）。
  const labelAt = body.indexOf('worksheet-editor-table-blank-toggle');
  const label = body.slice(labelAt, body.indexOf('</label>', labelAt));
  assert.ok(label.includes('aria-label='), '那个小方框没有 aria-label（读屏读不出它是什么）');
  assert.ok(label.includes('title='), '那个小方框没有悬停说明');
  // 🔴 反面：原来那个独占一行的「填空」两个字不许回来 —— 它就是「一行占两排」的来源。
  assert.ok(!/\n\s*填空\n/.test(body), '「填空」那两个字又回到格子里独占一行了');
});
