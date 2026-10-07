/**
 * ★ 2026-10-07：四个几何记号的**接线**判据。
 *
 * 🔴 为什么不能只靠 `worksheet-math-shapes.test.ts`：那几条证的是"几何算得对"。
 *   而**画板愿不愿意接**是另一件事 —— 把 renderEntry 的四个分支删掉，
 *   那几条照样全绿，而学生点了工具什么都没画出来。本机看不见界面。
 *
 * ⚠️ 源码级判据：证「接线在、形态对」，不证运行时画出来什么样。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SOURCE = stripComments(fs.readFileSync(path.join(HERE, 'math-drawing.tsx'), 'utf8'));

test('★ renderEntry 画得出四种新形状（逐个点名）', () => {
  for (const kind of ["entry.kind === 'equalMark'", "entry.kind === 'parallelMark'",
    "entry.kind === 'rightAngle'", "entry.kind === 'angleArc'"]) {
    assert.ok(SOURCE.includes(kind), `renderEntry 不画 ${kind}`);
  }
});

test('★ buildEntry 认四个新工具，且**顶点都在第二下**（两个三击记号同一种顺序）', () => {
  for (const tool of ["case 'equalMark'", "case 'parallelMark'", "case 'rightAngle'", "case 'angleArc'"]) {
    assert.ok(SOURCE.includes(tool), `buildEntry 不认 ${tool}`);
  }
  // 三次点击的顺序统一是 [a, vertex, b]：`ats[1]` 才是顶点。
  assert.match(SOURCE, /rightAngleOf\(ats\[1\], ats\[0\], ats\[2\]\)/, '直角的顶点取的不是第二下');
  assert.match(SOURCE, /arcPathOf\(ats\[1\], ats\[0\], ats\[2\]\)/, '角弧的顶点取的不是第二下');
});

test('★ 画板里**不许**自己再推一遍几何（两个渲染端必须同源）', () => {
  for (const fn of ['equalMarkOf(', 'parallelMarkOf(', 'rightAngleOf(', 'arcPathOf(']) {
    assert.ok(SOURCE.includes(fn), `画板没有走纯函数 ${fn}`);
  }
  // 反面：画板里不许出现手写的三角函数（那就是第二份算法）。
  assert.ok(!/Math\.atan2\(/.test(SOURCE), '画板里在算角度 —— 应当在 worksheet-math-shapes.ts 里算');
});

test('★ 读得回来 + 存得回去 + 度数输入框', () => {
  for (const kind of ["row.kind === 'equalMark'", "row.kind === 'parallelMark'",
    "row.kind === 'rightAngle'", "row.kind === 'angleArc'"]) {
    assert.ok(SOURCE.includes(kind), `readEntries 不认 ${kind}`);
  }
  // 角弧有可拖的三个点 ⇒ snapshot 必须按**拖动后的位置**存回去，
  // 少这一支的表现是"拖了一下，松手又弹回去"，而且不报错。
  assert.match(SOURCE, /kind: 'angleArc',[\s\S]{0,200}item\.points\[1\]/, 'snapshot 没有按拖动后的位置存角弧');
  assert.match(SOURCE, /aria-label="要标的角度"/, '角弧没有度数输入框');
});
