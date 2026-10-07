/**
 * 流程图**边**的几何判据（★ 2026-10-07 教师）。
 *
 * 教师原话：「在移动某个图形时，**连接线接近直线时需要吸附成直线**，否则可能会出现一个
 * **非常小的拐角**，很难看」——「相当于是一个**微调**」。
 *
 * ★ 2026-10-07 同一天第二次报障，又加了两条：
 *   ①「连线的控制点必须**永远压在线上面**，不能漂移到线外」；
 *   ②「这是这条横线往下移动的**最低位置**，再往下移会超过最右侧竖线的最低高度，
 *      会导致两条线交叉点的**弧线折返**」。
 *
 * 🔴 两条其实是**同一件事**：绕行点只能待在这条边**允许它走的那条线**上，而且**只能走到头**。
 *    · 「那条线」= 库画出来的路径 ⇒ 绕行点由 `flowRouteTrack` 定轴、由库的默认值补另一个轴；
 *    · 「走到头」= `clampToTrack` 夹出来的范围 —— **越过它，中段就会反着折回去**。
 *    ⚠️ 那个范围不是拍脑袋的余量：库的 `getPoints` 在两端各留一个 `offset`（默认 20）的「留白点」，
 *       中段落在两个留白点**之间**才画得出正常的拐角；越过任一个，库就会在留白点上**掉头**
 *       （`getBend` 认出来是共线反向 ⇒ 直接画成一根 L，线**原路折返**）。教师那张图里
 *       「再往下移就会超过最右侧竖线的最低高度」说的正是这个。
 *
 * ⚠️ 这里用**注入**的假 `smoothStep`（而不是真的 `@xyflow/react`）—— 库那一份 import 了 React，
 *    在纯 Node 下加载不了（本仓没有 jsdom）。判据只关心**「绕行点怎么算、什么时候不走库」**，
 *    真实路径由库自己算，不该在这里被复刻一遍。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FLOW_STRAIGHT_SNAP,
  flowEdgeGeometry,
  flowRoutePoint,
  flowRouteTrack,
} from './worksheet-flowchart-edge.ts';

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

/** 最常见的那个场景：上面的框底边 → 下面的框顶边（教师两张图里都是它）。 */
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

/*
  ★ 2026-10-07（教师）：「水平方向上我可以调整一条竖线，**但在垂直方向上，我无法拖动去调整
  一条横线**」。

  🔴 根因：拖动时**只写了一个轴**（竖直的边写 `routeY`、水平的写 `routeX`），另一个是 `undefined`
     ⇒ 门槛那句 `Number.isFinite(centerX) && Number.isFinite(centerY)` 不成立 ⇒ **线根本不动**。
  ✅ 现在这条规矩由**自由轴**（`flowRouteTrack`）定：认哪条轴、就只认那条轴，
     另一个轴归**两端中点**（= 库自己的默认值，见 `getPoints` 里 `center.x ?? …`）。
*/
test('竖直的边：给 routeY 就生效（上下拖那条横线），另一个轴归两端中点', () => {
  const [path] = flowEdgeGeometry({ ...base, centerY: 150 }, fakeSmooth);
  assert.match(path, /^SMOOTH\(/, '给了 centerY 就该走库 —— 否则控制柄拖了没反应');
  assert.match(path, /c=100,150\)/, 'centerX 归两端中点（两端 x 都是 100）—— 标签要落在线段正中');
});

test('水平的边：给 routeX 才生效（左右拖那条竖线）', () => {
  const [path] = flowEdgeGeometry({
    sourceX: 0, sourceY: 50, targetX: 400, targetY: 300,
    sourcePosition: 'right', targetPosition: 'left', centerX: 140,
  }, fakeSmooth);
  assert.match(path, /c=140,175\)/, 'centerY 归两端中点（50 与 300 的中点 = 175）');
});

test('轴不对的绕行点**一个都不传** —— 竖直的边不吃 routeX', () => {
  /*
   * 为什么不是「照样传下去」：竖直的边里库**只用 centerY**（中段那条横线的位置），
   * 但 `centerX` 会被它原样当成**标签的 x** 返回 ⇒ 一个陈旧的 routeX 会把线上的字甩到线外。
   * ⚠️ 实际会发生：先连成水平的、拖过线，之后**一键整理**把句柄理成竖直的 —— routeX 就留下来了。
   */
  const [path] = flowEdgeGeometry({ ...base, targetX: 200, centerX: 140 }, fakeSmooth);
  assert.match(path, /c=undefined,undefined\)/, '绕行点整条不认，全交给库的默认（那就是两端中点）');
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

/*
  ============================ 绕行点能走的**那条线**、和**走到头** ============================
*/

test('竖直的边：能走的是上下，范围卡在两端留白点之间', () => {
  assert.deepEqual(
    flowRouteTrack(base),
    /*
     * 起点在下面那个框的底边（y=0）⇒ 留白点 20；终点在上面那个框的顶边（y=300）⇒ 留白点 280。
     * ⚠️ 20 这个数是**库的默认 offset**（`getSmoothStepPath` 的 `offset = 20`）——
     *    不是我们另定的余量，所以它变不了（除非哪天真去改 `pathOptions.offset`）。
     */
    { axis: 'y', min: 20, max: 280 },
    '上下拖（axis y），最上到起点留白点、最下到终点留白点 —— 教师那张图的「最低位置」就是 280',
  );
});

test('起点在目标**下面**时，库把中段画成竖的 ⇒ 拖的是左右', () => {
  /*
   * 同一个 `bottom→top`，但源被拖到了目标的下面。库的 `getPoints` 这时走的是**另一支**
   * （`verticalSplit`）：中段是**竖线**、位置由 `centerX` 定。
   * 🔴 所以「轴」不能只看句柄 id（那就还是「拖了没反应」）—— 必须按**边自己的走向**判。
   */
  assert.deepEqual(
    flowRouteTrack({
      sourceX: 100, sourceY: 300, targetX: 400, targetY: 0,
      sourcePosition: 'bottom', targetPosition: 'top',
    }),
    { axis: 'x', min: 100, max: 400 },
    '中段是竖的 ⇒ 左右拖；范围是两个留白点的 x 之间',
  );
});

test('水平的边：中段是竖线，范围同样卡在两端留白点之间', () => {
  assert.deepEqual(
    flowRouteTrack({
      sourceX: 0, sourceY: 50, targetX: 400, targetY: 50,
      sourcePosition: 'right', targetPosition: 'left',
    }),
    { axis: 'x', min: 20, max: 380 },
    '从左边出、进右边 ⇒ 中段竖直 ⇒ 左右拖',
  );
});

test('拐弯的边没有「能走的那条线」⇒ 不给把手', () => {
  // 库的 `getPoints` 在**相邻句柄**那一支里**压根不读 center** —— 给它把手只会「拖了没反应」。
  assert.equal(flowRouteTrack({ ...base, targetPosition: 'left' }), null);
  assert.equal(flowRoutePoint({ ...base, targetPosition: 'left', centerY: 150 }), null);
});

test('拖过头 ⇒ 夹回范围里（再往下，交叉点的弧线就会折返）', () => {
  const [path] = flowEdgeGeometry({ ...base, centerY: 9999 }, fakeSmooth);
  assert.match(path, /c=100,280\)/, '最远只到终点那侧的留白点 —— 教师那张图说的「最低位置」');
});

test('拖到最上面 ⇒ 夹到起点那侧的留白点', () => {
  const [path] = flowEdgeGeometry({ ...base, centerY: -50 }, fakeSmooth);
  assert.match(path, /c=100,20\)/, '往上同理 —— 越过起点留白点，线会在起点那头折返');
});

test('水平的边拖过头同样夹住', () => {
  const [path] = flowEdgeGeometry({
    sourceX: 0, sourceY: 50, targetX: 400, targetY: 50,
    sourcePosition: 'right', targetPosition: 'left', centerX: 9999,
  }, fakeSmooth);
  assert.match(path, /c=380,50\)/, 'range 的另一头（380 = 终点留白点）');
});

test('范围里就照原样走 —— 别顺手往里缩', () => {
  // ⚠️ 反面：夹取只在**越界**时生效。若把「夹」写成「永远取端点」，拖动就成了一跳一跳的。
  assert.match(flowEdgeGeometry({ ...base, centerY: 137 }, fakeSmooth)[0], /c=100,137\)/);
  assert.deepEqual(flowRoutePoint({ ...base, centerY: 137 }), { x: 100, y: 137 });
});

test('没拖过（两个轴都没有）⇒ 没有绕行点，一切照旧', () => {
  assert.equal(flowRoutePoint(base), null, '别凭空造一个绕行点出来 —— 那会把直线的判断也顶掉');
});
