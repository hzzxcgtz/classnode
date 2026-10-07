/**
 * ★ 2026-10-07（教师）：「线段两端的点只有当我选中这个线段的时候才会出现；
 *   我不选择的时候，它就是一根看不见端点的线条」。
 *
 * 🔴 为什么必须单独钉「待定点」和「独立的点」这两条例外：它们是**同一句需求的边界**。
 *   把 mkPoint 一刀切成 invisible，表现是「多击工具点下去没有任何反馈」
 *   （角弧要点三下，没有点就不知道点了两下）与「学生标了一个点，屏幕上什么都没有」——
 *   两种都不报错，只在真机上看得见。
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

test('★ 两种点工厂都在，而且默认可见性相反', () => {
  assert.match(SOURCE, /const mkHandle = \(at: Pt\)/, '没有 mkHandle');
  assert.match(SOURCE, /const mkMark = \(at: Pt\)/, '没有 mkMark');
  // 图形端点那一档必须**看不见**。
  const handle = SOURCE.slice(SOURCE.indexOf('const mkHandle'), SOURCE.indexOf('const mkMark'));
  assert.match(handle, /visible: false/, 'mkHandle 没关掉可见性 ⇒ 端点一直露着');
  // 待定点那一档**必须看得见**（它是「你已经点了两下」的反馈）。
  const mark = SOURCE.slice(SOURCE.indexOf('const mkMark'), SOURCE.indexOf('const mkMark') + 400);
  assert.ok(!/visible: false/.test(mark), 'mkMark 也关掉了可见性 ⇒ 多击工具点下去没有任何反馈');
});

test('★ 多击工具的待定点走 mkMark（不是 mkHandle）', () => {
  assert.match(SOURCE, /marks\.push\(mkMark\(/, '待定点还在用那个默认不可见的工厂');
});

test('★ 独立的「点」走 mkMark（那一个点就是学生的作答本身）', () => {
  const at = SOURCE.indexOf("entry.kind === 'point'");
  assert.notEqual(at, -1, '找不到 point 那一支');
  assert.match(SOURCE.slice(at, at + 260), /mkMark\(entry\.p\)/, '独立的点用了看不见的工厂 ⇒ 画上去什么都没有');
});

test('★ 选中时把端点露出来（重画之后、按选中那一条改）', () => {
  const at = SOURCE.indexOf('const applySelection = (');
  assert.notEqual(at, -1, '找不到 applySelection');
  const body = SOURCE.slice(at, SOURCE.indexOf('\n    };', at));
  assert.match(body, /renderAll\(/, '① 没有先重画 ⇒ 上一条选中的端点不会消失');
  assert.match(body, /visible: true/, '② 没有把选中那条的端点露出来');
});
