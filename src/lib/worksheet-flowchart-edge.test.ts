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

/**
 * 假库函数：把**收到的绕行点**原样回显出来 —— 这样判据能验「我们是否真的把它传下去了」。
 * ⚠️ 只回一个认得出来的字符串是不够的：绕行点缺一个轴时**调用照样发生**，只是库那边不生效，
 *    那种错只有把实参摊开看才抓得住（教师 2026-10-07 报的「垂直方向拖不动横线」就是它）。
 */
const fakeSmooth = (p: { sourceX: number; sourceY: number; targetX: number; targetY: number; centerX?: number; centerY?: number }) =>
  [
    `SMOOTH(${p.sourceX},${p.sourceY}->${p.targetX},${p.targetY};c=${String(p.centerX)},${String(p.centerY)})`,
    111,
    222,
  ] as [string, number, number];

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
  assert.match(path, /c=140,150\)/, '两个轴都要原样传下去');
});

/*
  ★ 2026-10-07（教师）：「你在折线上面加的控制点，**水平方向上我可以调整一条竖线，
  但在垂直方向上，我无法拖动去调整一条横线**」。

  🔴 根因：拖动时**只写了一个轴**（竖直的边写 `routeY`、水平的写 `routeX`），另一个是 `undefined`
     ⇒ 门槛那句 `Number.isFinite(centerX) && Number.isFinite(centerY)` 不成立 ⇒ **线根本不动**。
  ✅ 缺的那个轴要用**两端中点**补上（那正是库自己的默认值，见 `getPoints` 里 `center.x ?? …`）。
*/
test('只给一个绕行轴也要生效 —— 另一个轴补上两端中点', () => {
  const [path] = flowEdgeGeometry({ ...base, centerY: 150 }, fakeSmooth);
  assert.match(path, /^SMOOTH\(/, '给了 centerY 就该走库 —— 否则控制柄拖了没反应');
  assert.match(path, /c=100,150\)/, 'centerX 要补成两端中点的 x（这里两端 x 都是 100）');
});

test('反过来也一样：只给 centerX', () => {
  const [path] = flowEdgeGeometry({ ...base, centerX: 140 }, fakeSmooth);
  assert.match(path, /c=140,150\)/, 'centerY 补成两端中点的 y（这里 0 与 300 的中点 = 150）');
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
