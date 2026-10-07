/**
 * 边的**几何**判据（★ 2026-10-07 教师）。
 *
 * 教师原话：「在移动某个图形时，**连接线接近直线时需要吸附成直线**，否则可能会出现一个
 * **非常小的拐角**，很难看」——「相当于是一个**微调**」。
 *
 * 🔴 那个「很小的拐角」是 `smoothstep` 的固有表现：两端 **x 差一点点**时，中间那段横线
 *    只有几个像素。**短到一定程度就干脆画成一条直线**，视觉上就干净了。
 *
 * ⚠️ 这里用**注入**的假 `smoothStep`（而不是真的 `@xyflow/react`）—— 库那一份 import 了 React，
 *    在纯 Node 下加载不了（本仓没有 jsdom）。判据只关心**「什么时候不走库、直接画直线」**，
 *    真实路径由库自己算，不该在这里被复刻一遍。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FLOW_STRAIGHT_SNAP, flowEdgeGeometry } from './worksheet-flowchart-edge.ts';

/** 假库函数：只回一个能被认出来的字符串，外加一个固定的标签点。 */
const fakeSmooth = (p: { sourceX: number; sourceY: number; targetX: number; targetY: number }) =>
  [`SMOOTH(${p.sourceX},${p.sourceY}->${p.targetX},${p.targetY})`, 111, 222] as [string, number, number];

const base = {
  sourceX: 100, sourceY: 0,
  targetX: 100, targetY: 300,
  sourcePosition: 'bottom', targetPosition: 'top',
} as const;

test('竖直相邻、x 几乎相同 ⇒ 直接画直线（那个很小的拐角消失）', () => {
  const [path] = flowEdgeGeometry({ ...base, targetX: 100 + FLOW_STRAIGHT_SNAP - 2 }, fakeSmooth);
  assert.equal(path, 'M 100 0 L 110 300', '两端几乎同列 ⇒ 一条直线，而不是「下—横—下」');
  /*
   * ⚠️ 它**略微斜**（差 10px），这是**故意的**。教师 2026-10-07 试过「矫正成正的」之后否掉了：
   *   「还是不要自动校正那个矩形框了，**斜线就斜线吧**」。
   *   矫正会让箭头落不到 target 上（线画在 source 的垂线上），补那个又得挪框 —— 越弄越复杂。
   */
});

test('竖直相邻、x 差得明显 ⇒ 仍走 smoothstep', () => {
  // 偏 100px 远超 12px 的门槛 ⇒ 那是个正常的拐弯，照旧交给库（不该被「直线化」）。
  const [path] = flowEdgeGeometry({ ...base, targetX: 200 }, fakeSmooth);
  assert.match(path, /^SMOOTH\(/, '偏得够远 ⇒ 该拐弯就拐弯（那是流程图的正常样子）');
});

test('横向相邻、y 几乎相同 ⇒ 同样画直线', () => {
  const [path] = flowEdgeGeometry({
    sourceX: 0, sourceY: 50, targetX: 400, targetY: 50 + FLOW_STRAIGHT_SNAP - 2,
    sourcePosition: 'right', targetPosition: 'left',
  }, fakeSmooth);
  assert.equal(path, 'M 0 50 L 400 60', '横着的边同理（同样允许略微斜）');
});

test('有绕行点（控制柄拖过）⇒ 一切照库，不做直线判断', () => {
  const [path] = flowEdgeGeometry({ ...base, centerX: 140, centerY: 150 }, fakeSmooth);
  assert.match(path, /^SMOOTH\(/, '学生亲手调过走向的边，不该被「自动变直」抹掉');
});

test('两端句柄不同向（拐弯的边）⇒ 不碰，照库 —— 那种边「直线化」只会更怪', () => {
  const [path] = flowEdgeGeometry({ ...base, targetPosition: 'left' }, fakeSmooth);
  assert.match(path, /^SMOOTH\(/, '从底边出、进左边：两点重合也画不出有意义的直线');
});

test('偏得太远（30° 以上）⇒ 照旧给库', () => {
  const [path] = flowEdgeGeometry({
    sourceX: 100, sourceY: 0, targetX: 250, targetY: 300,
    sourcePosition: 'bottom', targetPosition: 'top',
  }, fakeSmooth);
  assert.match(path, /^SMOOTH\(/);
});

test('直线的标签点取两端中点 —— 否则线上的字会飘到别处', () => {
  const [, labelX, labelY] = flowEdgeGeometry({ ...base, targetX: 104 }, fakeSmooth);
  // 画的是「两端相连」的那条直线 ⇒ 标签点就是它的中点。
  assert.equal(labelX, 102);
  assert.equal(labelY, 150);
});
