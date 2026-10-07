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
  FLOW_HANDLE_HALF,
  FLOW_LABEL_GAP,
  FLOW_LABEL_LINE,
  FLOW_LABEL_REACH,
  FLOW_STRAIGHT_SNAP,
  flowAnchorPoint,
  flowEdgeGeometry,
  flowLabelOffset,
  flowLabelWidth,
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

/*
  ======================= 边端点的**约定**：与库同一个（教师第二次报障的根因） =======================

  🔴 库给边的端点**不是节点边框上的点**，而是**句柄那个小方块的边**：
     `getHandlePosition` 里 `Top` 直接取 `handle.y`（方块的上边）、`Bottom` 取 `handle.y + height`……
     而句柄是**骑在边框上**的 ⇒ 端点比边框再往外**半个方块**（6px）。
  🔴 我们原来按「边框上的点」算 ⇒ 与库画的那条线差 6px。**后果只在两端现形**：
     绕行点的能走范围因此比线自己的宽 6px ⇒ 拖到最两端时控制柄还在动、看着**偏出线外一点**
     （竖直的边上下偏、水平的边左右偏）。这两条用例把那个约定逐面钉住。
*/
test('端点约定：上/下/左/右四侧都落在**句柄方块的外边**（比节点边框再出去半个方块）', () => {
  const box = { x: 100, y: 200, width: 150, height: 54 };
  assert.deepEqual(flowAnchorPoint(box, 'top'), { x: 175, y: 200 - FLOW_HANDLE_HALF }, '上侧：y 在边框**上方**半个方块');
  assert.deepEqual(flowAnchorPoint(box, 'bottom'), { x: 175, y: 254 + FLOW_HANDLE_HALF }, '下侧：y 在边框**下方**半个方块');
  assert.deepEqual(flowAnchorPoint(box, 'left'), { x: 100 - FLOW_HANDLE_HALF, y: 227 }, '左侧：x 在边框**左方**半个方块');
  assert.deepEqual(flowAnchorPoint(box, 'right'), { x: 250 + FLOW_HANDLE_HALF, y: 227 }, '右侧：x 在边框**右方**半个方块');
});

test('端点约定直接决定「能走多远」—— 按边框算就会多出那半个方块', () => {
  /*
   * 一条竖直的边：源框（边框底边 y=54）的**下侧**句柄 → 目标框（边框顶边 y=246）的**上侧**句柄。
   * 端点各往外 6px ⇒ 留白之后的范围随之收紧 6px。
   */
  const source = flowAnchorPoint({ x: 100, y: 0, width: 150, height: 54 }, 'bottom');
  const target = flowAnchorPoint({ x: 100, y: 246, width: 150, height: 54 }, 'top');
  const ends = { sourcePosition: 'bottom', targetPosition: 'top' } as const;
  const track = flowRouteTrack({ ...ends, sourceX: source.x, sourceY: source.y, targetX: target.x, targetY: target.y });
  assert.deepEqual(track, { axis: 'y', min: 80, max: 220 }, '60+20 与 240-20');
  // 反面对照：按**边框上的点**算（= 老的那一版）—— 上下各宽 6px，正是「到头了还在动」的那一点。
  const borderTrack = flowRouteTrack({ ...ends, sourceX: 175, sourceY: 54, targetX: 175, targetY: 246 });
  assert.deepEqual(borderTrack, { axis: 'y', min: 74, max: 226 });
  assert.equal(
    borderTrack.max - track.max,
    FLOW_HANDLE_HALF,
    '差的正是那半个方块 —— 这就是教师看到的「拖到最两端时控制柄偏出线外一点」',
  );
});

/*
  ===================== 线上文字摆在哪：**贴在线旁边 + 可以拖着走**（★ 2026-10-07 教师） =====================

  教师：「如果是**竖线**，默认在**右侧**；如果是**横线**，默认在**上方**」，
  并选了「**贴着线拖**」（拖得到处都是的话，这个标签就没意义了）。

  ⚠️ 「线」指的是**标签待着的那一段**，不是整条边：竖直的边（bottom→top）中间那一段是**横的**
     ⇒ 字在它上方；水平的边（right→left）中间那一段是**竖的** ⇒ 字在它右侧。
     那一段的方向从 `flowRouteTrack().axis` 来（`axis === 'y'` ⇒ 中段是横的）。
*/
test('竖直的边（中段是横线）⇒ 默认摆在**上方**', () => {
  const offset = flowLabelOffset(base, '是', null);
  assert.equal(offset.dx, 0, '横线上方的字，左右不动');
  assert.ok(offset.dy < 0, '要**往上**让开：白底框不能压在那条横线上');
  assert.equal(offset.dy, -(FLOW_LABEL_LINE / 2 + FLOW_LABEL_GAP), '让开半行字 + 一点空隙');
});

test('水平的边（中段是竖线）⇒ 默认摆在**右侧**', () => {
  const params = { sourceX: 0, sourceY: 50, targetX: 400, targetY: 50, sourcePosition: 'right', targetPosition: 'left' };
  const offset = flowLabelOffset(params, '是', null);
  assert.equal(offset.dy, 0, '竖线右侧的字，上下不动');
  assert.ok(offset.dx > 0, '要**往右**让开');
  assert.equal(offset.dx, flowLabelWidth('是') / 2 + FLOW_LABEL_GAP, '让开半个字宽 + 一点空隙');
});

test('标签越长，往右让开的距离越大 —— 否则白底框还是压着线', () => {
  const params = { sourceX: 0, sourceY: 50, targetX: 400, targetY: 50, sourcePosition: 'right', targetPosition: 'left' };
  const short = flowLabelOffset(params, '是', null);
  const long = flowLabelOffset(params, '继续处理', null);
  assert.ok(long.dx > short.dx, '四个字比一个字宽 ⇒ 要让开更多');
  assert.equal(long.dx - short.dx, (flowLabelWidth('继续处理') - flowLabelWidth('是')) / 2, '差的就是那半个字宽');
});

test('拐弯的边（库不认绕行点、没有 track）⇒ 按两端的主方向猜', () => {
  // 两端横向拉开得多 ⇒ 库把标签摆在**最长的那一段**上（那是横的）⇒ 上方。
  const wide = { sourceX: 0, sourceY: 0, targetX: 400, targetY: 60, sourcePosition: 'bottom', targetPosition: 'left' };
  assert.equal(flowRouteTrack(wide), null, '前提：拐弯的边没有 track（库不认绕行点）');
  assert.equal(flowLabelOffset(wide, '是', null).dx, 0, '横的那一段 ⇒ 字在上方');
  // 纵向拉开得多 ⇒ 最长的那一段是竖的 ⇒ 右侧。
  const tall = { sourceX: 0, sourceY: 0, targetX: 60, targetY: 400, sourcePosition: 'bottom', targetPosition: 'left' };
  assert.ok(flowLabelOffset(tall, '是', null).dx > 0, '竖的那一段 ⇒ 字在右侧');
});

test('拖过的位置优先生效 —— 不再用默认的那一侧', () => {
  const moved = flowLabelOffset(base, '是', { dx: 40, dy: -30 });
  assert.deepEqual(moved, { dx: 40, dy: -30 }, '拖到哪儿就是哪儿（还在「线附近」的范围里）');
});

test('贴着线拖：拖太远会被拉回**线附近**（方向不变，只缩短）', () => {
  const far = flowLabelOffset(base, '是', { dx: 600, dy: 800 });
  assert.equal(Math.round(Math.hypot(far.dx, far.dy)), FLOW_LABEL_REACH, '距离被夹到上限');
  assert.ok(Math.abs(far.dx / far.dy - 600 / 800) < 1e-9, '方向不许变 —— 否则拖着拖着会拐弯');
  const near = { dx: 30, dy: -20 };
  assert.deepEqual(flowLabelOffset(base, '是', near), near, '范围里就原样，别顺手缩');
  assert.deepEqual(flowLabelOffset(base, '是', { dx: 0, dy: 0 }), { dx: 0, dy: 0 }, '正好压回线上也是允许的（学生自己拖的）');
});
