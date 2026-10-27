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

test('填空格显示可选中的横线，普通格直接编辑文字', () => {
  assert.ok(body.length > 1000);
  const at = body.indexOf('{item.blank ?');
  assert.ok(at >= 0, '填空与文字由结构化 blank ID 区分');
  const split = body.indexOf(': <textarea', at);
  const blankBranch = body.slice(at, split);
  assert.ok(blankBranch.includes('worksheet-editor-table-blank-line'));
  assert.ok(blankBranch.includes('aria-label=') && blankBranch.includes('aria-pressed='));
  assert.ok(!blankBranch.includes('<input') && !blankBranch.includes('<textarea'));
  assert.ok(split > at, '普通格保留可直接输入的文本区');
});

test('选中后提供有文字的转换按钮，表格中不再铺满复选框和删除叉', () => {
  assert.ok(body.includes('设为填空') && body.includes('改为文字格'));
  assert.ok(!body.includes('worksheet-editor-table-blank-toggle'));
  assert.ok(!body.includes('worksheet-editor-table-op'));
  assert.ok(body.includes('aria-label="所选单元格操作"'));
  assert.ok(body.includes('行列设置') && body.includes('删除所选行') && body.includes('删除所选列'));
});
