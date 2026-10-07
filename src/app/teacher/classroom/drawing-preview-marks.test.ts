/**
 * ★ 2026-10-07：教师端预览要跟上四个几何记号。
 *
 * 🔴 为什么不能只靠 `worksheet-math-shapes.test.ts`：那几条证的是几何算得对。
 *   预览**愿不愿意画**是另一件事 —— 把 MathPreview 那四个分支删掉，那几条照样全绿，
 *   而教师看到的图里**学生标的记号全部消失**（有快照时看不到，没快照时才现形）。
 *
 * 🔴 还要钉住**别改错档**：`Background` 是基础绘图与数学作图**共用**的，
 *   而基础绘图那边的画板就是 `background-size: 100% 100%`（铺满）⇒ 它的预览也该铺满。
 *   顺手把 `Background` 改成 contain 就是**基础绘图的回归**，而且没人会为此报 bug。
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
const SOURCE = stripComments(fs.readFileSync(path.join(HERE, 'drawing-document-preview.tsx'), 'utf8'));

/** 按函数名切一段出来（三个被钉的函数首尾相接，顺序由文件结构保证）。 */
function section(from: string, to: string): string {
  const at = SOURCE.indexOf(from);
  const end = SOURCE.indexOf(to);
  assert.ok(at !== -1 && end !== -1 && at < end, `切不出这一段：${from} → ${to}`);
  return SOURCE.slice(at, end);
}
const BACKGROUND = section('function Background(', 'function BasicPreview(');
const BASIC_PREVIEW = section('function BasicPreview(', 'function MathPreview(');
const MATH_PREVIEW = section('function MathPreview(', 'function MindBranch(');

test('★ MathPreview 画得出四种新记号（逐个点名）', () => {
  for (const kind of ["item.kind === 'equalMark'", "item.kind === 'rightAngle'", "item.kind === 'angleArc'"]) {
    assert.ok(MATH_PREVIEW.includes(kind), `教师预览不画 ${kind}`);
  }
  // 等号与平行共用一个分支（它们只差箭头），所以那两个 kind 一起点名。
  assert.match(MATH_PREVIEW, /item\.kind === 'equalMark' \|\| item\.kind === 'parallelMark'/,
    '教师预览不画平行记号');
});

test('★ 预览与画板用**同一组纯函数**（各推一套迟早分叉）', () => {
  for (const fn of ['equalMarkOf(', 'parallelMarkOf(', 'rightAngleOf(', 'arcPathOf(']) {
    assert.ok(MATH_PREVIEW.includes(fn), `教师预览没有走纯函数 ${fn}`);
  }
  assert.ok(!/Math\.atan2\(/.test(MATH_PREVIEW), '教师预览里在算角度 —— 应当在 worksheet-math-shapes.ts 里算');
});

test('★ 底图摆法只改数学作图那一档（基础绘图跟着改就是回归）', () => {
  assert.match(MATH_PREVIEW, /fit="xMidYMid meet"/, '数学作图的底图没有改成 contain（与画板不一致）');
  assert.ok(!/fit=/.test(BASIC_PREVIEW), '基础绘图的底图被顺手改了 —— 它那边画板就是铺满的');
  // 默认值必须还是铺满（`Background` 是两档共用的）。
  assert.match(BACKGROUND, /preserveAspectRatio=\{fit \?\? 'none'\}/, 'Background 的默认不再是铺满');
});
