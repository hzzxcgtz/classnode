/**
 * ★ 2026-10-07（教师）：几何题原图当底图。
 *
 * 🔴 这份判据里最要紧的是**命中测试那三处**。jsxgraph 的 `Image.hasPoint` 是
 *   "点在矩形里就算"（我核过 `src/base/image.js:130`），而底图铺满整块画布 ⇒
 *   它会被**每一次点击**命中。后果：`handleDown`/`onDragDown` 的早退守卫
 *   （"点到既有图形就让内核去拖它"）**恒为真** ⇒ **所有绘图工具彻底失效**；
 *   「选择」的 hits[0] 也会是底图 ⇒ 永远选不中自己画的线。
 *   两种表现都是"什么都不发生、什么也不报"。
 *
 * ⚠️ 源码级判据：证「接线在、形态对」。真机上"放大之后还贴不贴得住"另算（交给教师）。
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

test('★ 底图是画板对象（不是 CSS 背景），且压在最下面', () => {
  assert.match(SOURCE, /board\.create\('image',/, '底图没有建进画板 ⇒ 进不了快照');
  assert.match(SOURCE, /layer: -1/, '底图没有压到最下面（它会盖住学生的作答）');
  assert.ok(!/backgroundImage/.test(SOURCE), '底图还挂在 CSS 上 ⇒ 快照里没有它、也不跟缩放');
});

test('★ 底图走**同源 blob**（直接喂 URL 会让 canvas 被污染，快照静默全废）', () => {
  assert.match(SOURCE, /URL\.createObjectURL\(/, '没有把图取成 blob URL');
  assert.match(SOURCE, /URL\.revokeObjectURL\(/, 'blob URL 没有回收（每开一次题都漏一张图）');
});

test('★ 三处命中判断都滤掉底图（三处分别钉，合并成一条会漏）', () => {
  // ① 「选择」那一支
  const selectAt = SOURCE.indexOf("toolRef.current === 'select'");
  assert.notEqual(selectAt, -1, '找不到「选择」那一支');
  assert.match(SOURCE.slice(selectAt, selectAt + 300), /studentHitsUnderMouse\(event\)/,
    '「选择」还在用原始的命中列表 ⇒ hits[0] 是底图，永远选不中自己画的线');
  // ② 单击工具的早退守卫
  assert.match(SOURCE, /if \(studentHitsUnderMouse\(event\)\.length > 0\) return;/,
    '单击工具的守卫没滤底图 ⇒ 底图在场时每一次点击都不新建（所有绘图工具失效）');
  // ③ 拖动工具的早退守卫
  const dragAt = SOURCE.indexOf('const onDragDown = (event: PointerEvent) =>');
  assert.match(SOURCE.slice(dragAt, dragAt + 500), /studentHitsUnderMouse\(event\)/,
    '拖动工具的守卫没滤底图 ⇒ 线段/圆/长方形/铅笔都拖不出来');
  // 反面：原始调用只剩**过滤器内部**那一处。
  assert.equal((SOURCE.match(/getAllObjectsUnderMouse\(/g) ?? []).length, 1,
    '还有地方在直接用原始命中列表（应当只剩过滤器里那一处）');
});

test('★ 摆位走纯函数（画板里不许自己算比例）', () => {
  assert.match(SOURCE, /backgroundRect\(/, '画板没有走 backgroundRect');
});
