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

import { FLOW_SNAP_SLOPE, FLOW_STRAIGHT_SNAP, flowEdgeGeometry } from './worksheet-flowchart-edge.ts';

/** 假库函数：只回一个能被认出来的字符串，外加一个固定的标签点。 */
const fakeSmooth = (p: { sourceX: number; sourceY: number; targetX: number; targetY: number }) =>
  [`SMOOTH(${p.sourceX},${p.sourceY}->${p.targetX},${p.targetY})`, 111, 222] as [string, number, number];

const base = {
  sourceX: 100, sourceY: 0,
  targetX: 100, targetY: 300,
  sourcePosition: 'bottom', targetPosition: 'top',
} as const;

test('竖直相邻、x 几乎相同 ⇒ 直接画**竖直**直线（那个很小的拐角消失）', () => {
  const [path] = flowEdgeGeometry({ ...base, targetX: 100 + FLOW_STRAIGHT_SNAP - 2 }, fakeSmooth);
  assert.equal(path, 'M 100 0 L 100 300', '几乎同列 ⇒ 画竖直的，而不是「下—横—下」，也不是一条歪的');
});

test('竖直相邻、x 差得明显 ⇒ 仍走 smoothstep', () => {
  // 300px 长的线上偏 100px ≈ 18° —— 超出「快接近」的斜率上限，那是一条**真的**斜线。
  const [path] = flowEdgeGeometry({ ...base, targetX: 200 }, fakeSmooth);
  assert.match(path, /^SMOOTH\(/, '偏得够远 ⇒ 该拐弯就拐弯（那是流程图的正常样子）');
});

test('横向相邻、y 几乎相同 ⇒ 同样画直线', () => {
  const [path] = flowEdgeGeometry({
    sourceX: 0, sourceY: 50, targetX: 400, targetY: 50 + FLOW_STRAIGHT_SNAP - 2,
    sourcePosition: 'right', targetPosition: 'left',
  }, fakeSmooth);
  assert.equal(path, 'M 0 50 L 400 50', '横着的边同理：画**水平**的');
});

test('有绕行点（控制柄拖过）⇒ 一切照库，不做直线判断', () => {
  const [path] = flowEdgeGeometry({ ...base, centerX: 140, centerY: 150 }, fakeSmooth);
  assert.match(path, /^SMOOTH\(/, '学生亲手调过走向的边，不该被「自动变直」抹掉');
});

test('两端句柄不同向（拐弯的边）⇒ 不碰，照库 —— 那种边「直线化」只会更怪', () => {
  const [path] = flowEdgeGeometry({ ...base, targetPosition: 'left' }, fakeSmooth);
  assert.match(path, /^SMOOTH\(/, '从底边出、进左边：两点重合也画不出有意义的直线');
});

/*
  ★ 2026-10-07（教师，第二条要求）：
  「当变成一根直线以后，慢慢再拖动，**当快接近标准竖线或标准横线时，则自动矫正角度，
  将斜线变成真正的竖线和横线**」。

  🔴 这与「把节点吸过去」**是两回事** —— 教师明确否掉了后者（松手跳一下也是跳跃）。
     这里**一个节点都不动**，只是**把线画成正的**：末端落在 source 的垂线上（横向偏 `|dx|`）。
  ⚠️ 判据用**角度**（`|dx|/|dy|`）而不是固定的像素数：同样偏 30px，在 300px 长的线上是 5.7°
     （该矫正），在 80px 长的线上是 20°（不该矫正）。固定阈值做不到这个区分。
*/
test('斜着但接近竖直（偏 5.7°）⇒ 画成**真正的竖直线**', () => {
  const [path] = flowEdgeGeometry({
    sourceX: 100, sourceY: 0, targetX: 130, targetY: 300,
    sourcePosition: 'bottom', targetPosition: 'top',
  }, fakeSmooth);
  assert.equal(path, 'M 100 0 L 100 300', '要画成竖直的 —— 末端落在 source 那条垂线上');
});

test('同样偏 30px、但线只有 80px 长（20°）⇒ 不矫正，照旧给库', () => {
  const [path] = flowEdgeGeometry({
    sourceX: 100, sourceY: 0, targetX: 130, targetY: 80,
    sourcePosition: 'bottom', targetPosition: 'top',
  }, fakeSmooth);
  assert.match(path, /^SMOOTH\(/, '角度太大 ⇒ 那是个真的斜线，不该硬掰');
});

test('偏得太远（30° 以上）⇒ 照旧给库', () => {
  const [path] = flowEdgeGeometry({
    sourceX: 100, sourceY: 0, targetX: 250, targetY: 300,
    sourcePosition: 'bottom', targetPosition: 'top',
  }, fakeSmooth);
  assert.match(path, /^SMOOTH\(/);
});

test('横着的边同理：接近水平就画成真正的水平线', () => {
  const [path] = flowEdgeGeometry({
    sourceX: 0, sourceY: 100, targetX: 300, targetY: 130,
    sourcePosition: 'right', targetPosition: 'left',
  }, fakeSmooth);
  assert.equal(path, 'M 0 100 L 300 100', '末端落在 source 那条水平线上');
});

test('斜率阈值是**正切**（约 8.5°）—— 常量本身要能读出来', () => {
  assert.ok(FLOW_SNAP_SLOPE > 0 && FLOW_SNAP_SLOPE < 0.5, `斜率阈值不合理（${FLOW_SNAP_SLOPE}）`);
});

test('直线的标签点落在**画出来的那条线**上 —— 否则线上的字会飘到别处', () => {
  const [, labelX, labelY] = flowEdgeGeometry({ ...base, targetX: 104 }, fakeSmooth);
  // ⚠️ 画的是**竖直**线（末端落在 sourceX 上）⇒ 标签点也在那条竖线上，**不是**两端的平均 102。
  //    取错的话字会飘到线外 2px —— 小，但那正是「线上的字不在线上」。
  assert.equal(labelX, 100);
  assert.equal(labelY, 150);
});
