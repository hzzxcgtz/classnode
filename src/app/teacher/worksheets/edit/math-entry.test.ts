/**
 * ★ 2026-09-30：编辑页的**公式入口**接上了没有。
 *
 * 🔴 本仓没有 jsdom、没有浏览器 ⇒「点一下 Σ 会不会弹出输入框」在本机**验不了**。
 *    这一条网能回答的只有一件事：**那几个零件在不在、接没接上**。
 *    ⚠️ 它**不保证观感、不保证交互对**（光标落点、模板按钮会不会抢走焦点）——
 *       那些只能在真机上走查。
 *
 * ⚠️ 断言一律先**剥掉 import 行**：`MathInsertDialog` / `insertPromptText` 这些名字
 *    **本来就出现在 import 里**，不剥的话「把调用点整个删掉、只留一行 import」照样绿。
 *    这个坑 `worksheet-prompt-text.test.ts` 已经踩过一次（那里有一整段注释记着）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDITOR = fs.readFileSync(path.join(HERE, 'prompt-editor.tsx'), 'utf8');
const DIALOG = fs.readFileSync(path.join(HERE, 'math-insert-dialog.tsx'), 'utf8');

/** 块注释（含 JSX 的 `{/* … *\/}`）与整行 `//` 注释。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 连 `import` 行也剥掉（理由见文件头）。
 * ⚠️ 按行剥，假设这两个文件的 import 都是**单行**（今天都是）。
 */
function stripImports(source: string): string {
  return source.split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
}

const body = (source: string) => stripImports(stripComments(source));

test('★ 编辑页的公式入口：Σ 按钮 → 弹窗 → 插入，三个零件都接上了', () => {
  const editor = body(EDITOR);
  // 阳性对照：剥完之后剩下的仍是这个组件，不是一段空壳（否则下面几句对空串永远绿）。
  assert.ok(editor.length > 500, '剥 import 与注释之后剩下的仍是编辑器组件');
  assert.ok(editor.includes('worksheet-editor-math-glyph'), '工具栏上没有 Σ 按钮');
  assert.ok(editor.includes('MathInsertDialog'), '弹窗没有挂上去');
  assert.ok(editor.includes('insertMathAtCaret'), '弹窗没有接到插入逻辑上');
  // 🔴 插入必须走 `insertPromptText`（**与粘贴同一条路**）：自己拼字符串会让
  //    `promptRuns` 的区间与文本分叉 —— 那是本仓最防的那一类缺陷。
  // ⚠️ **只看这个函数的函数体**：`insertPromptText` 在本文件别处（粘贴、表格域）
  //    也被调用，查整个文件的话「把公式这一处换成自己拼」照样绿 —— 假绿。
  const at = editor.indexOf('const insertMathAtCaret');
  assert.ok(at >= 0, '找不到 insertMathAtCaret 的定义');
  const fnBody = editor.slice(at, editor.indexOf('\n  };', at));
  assert.ok(fnBody.includes('insertPromptText'), '插入公式没走 insertPromptText（与粘贴同一条路）');
  // 常显预览（教师裁定 ① 的那一行）。
  // ⚠️ **必须连着引号一起匹配**：`worksheet-editor-math-preview` 是那个 label 的
  //    `worksheet-editor-math-preview-label` 的**前缀** ⇒ 不连引号的话，
  //    「把预览那一块整个摘掉、只留 label」照样绿（变异检验抓出来的）。
  assert.ok(editor.includes('className="worksheet-editor-math-preview"'), '编辑体下方没有常显预览');
  // 🔴 反面：这一页**不许**自己调 KaTeX —— 公式渲染全仓只有 `MathSpan` 一处实现。
  assert.equal((editor.match(/katex\.renderToString/g) ?? []).length, 0,
    'prompt-editor 里直接调了 KaTeX —— 应该走 MathSpan');
});

test('★ 弹窗里那排模板按钮不是装饰（教师不一定记得住 \\frac）', () => {
  const dialog = body(DIALOG);
  assert.ok(dialog.length > 300, '剥 import 与注释之后剩下的仍是弹窗组件');
  for (const must of ['\\frac{a}{b}', '\\sqrt{x}', 'x^2', '\\pi']) {
    assert.ok(dialog.includes(must), `模板里少了 ${must}`);
  }
  // 🔴 实时预览必须在：打错了当场看见，而不是插进题干之后才发现。
  // ⚠️ **只看预览区那一段**：模板按钮里也各有一个 `MathSpan` ⇒ 查整个文件的话，
  //    「把预览整个摘掉」照样绿（变异检验抓出来的第二条假绿）。
  const pv = dialog.indexOf('worksheet-editor-math-dialog-preview');
  assert.ok(pv >= 0, '弹窗里没有预览区');
  const pvEnd = dialog.indexOf('worksheet-editor-math-dialog-templates', pv);
  assert.ok(pvEnd > pv, '找不到模板区（预览区与模板区的顺序变了？）');
  assert.ok(dialog.slice(pv, pvEnd).includes('MathSpan'), '弹窗的预览区里没有 MathSpan（打错了看不见）');
});
