/**
 * ★ 2026-09-30（基本图形工具）：学生端工具栏的**默认档**。
 *
 * 🔴 本仓没有 jsdom、没有浏览器 ⇒「点了那个按钮会不会换档」在本机**验不了**。
 *    这一条网能回答的只有：**默认档是从判据层拿的、而不是随手写的一个字面量**。
 *    ⚠️ 真机走查要看的：进题目直接画能不能画出线（默认档是不是手写）、
 *       十一个按钮在 iPad 竖屏下换不换行、当前档看不看得出高亮。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BODY = fs.readFileSync(path.join(HERE, 'ink-body.tsx'), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const body = stripComments(BODY);

test('🔴 默认档从判据层拿（`INK_DEFAULT_TOOL`），不是随手写的一个字面量', () => {
  assert.ok(body.length > 1000, '阳性对照：剥完注释之后剩下的仍是这个组件');
  // 判据层那条常量自己有用例钉着「= 'pen'」（`worksheet-ink.test.ts`）。
  // 这里钉的是**这一侧接上了没有**：写一个 `useState('pen')` 字面量就成了第二份真源，
  // 而判据层把默认值改掉时这一侧不会跟着动（屏幕上只是「进题目画不出线」）。
  assert.match(body, /useState<InkTool>\(INK_DEFAULT_TOOL\)/, '默认档没有从 INK_DEFAULT_TOOL 拿');
  // 工具栏要把**全部**档画出来（漏一个 = 那个图形没有入口，而屏幕上只是「少一个按钮」）。
  assert.ok(body.includes('INK_TOOLS.map('), '工具栏没有遍历 INK_TOOLS');
  // 只读态（教师端预览渲染同一个组件）整排禁用，但一个都不少。
  assert.ok(body.includes('aria-pressed={tool === item}'), '当前档没有可读的状态（aria-pressed）');
});
