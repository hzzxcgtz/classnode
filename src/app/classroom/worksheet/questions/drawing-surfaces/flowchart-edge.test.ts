/**
 * **边**的接线判据（★ 2026-10-07 教师）。
 *
 * 几何（「折线太短就画成直线」）在 `@/lib/worksheet-flowchart-edge.ts`，那边有纯函数用例；
 * 这份文件只钉**接线**：那条边有没有注册、标签有没有原样转交、控制柄有没有画、轴对不对。
 * ⚠️ 少任何一环，那套几何就是死代码 —— 而屏幕上什么都不会报错。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8');

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const at = source.indexOf(startMarker);
  if (at === -1) return '';
  const end = source.indexOf(endMarker, at + startMarker.length);
  return end === -1 ? '' : source.slice(at, end);
}

/*
  ★ 2026-10-07（教师）：重新引入一份自定义边 —— 它**只做两件事**（线变直 + 绕行点），
  其余全部转交给库的 `BaseEdge`。

  🔴 与 2026-10-06 删掉的那份（`FlowLabelEdge`）的**本质区别**：那份还顺手把标签挪到了线旁边
     （教师后来否掉了）。这一份**不许碰标签** —— 一旦有人把它改回去，「全回原版」就白做了。
*/
test('自定义边注册在 ReactFlow 上，而且标签是**转交**给 BaseEdge 的（不碰）', () => {
  assert.match(
    SOURCE,
    /const edgeTypes = useMemo\(\(\) => \(\{ \[FLOW_EDGE_TYPE\]: FlowEdge \}\), \[\]\)/,
    '没有注册那份自定义边',
  );
  assert.match(SOURCE, /edgeTypes=\{edgeTypes\}/, '`<ReactFlow>` 没有接上 edgeTypes（注册了也没用）');
  assert.match(SOURCE, /flowEdgeGeometry\(/, '没有调那个算路径的纯函数');

  const edgeFn = blockBetween(SOURCE, 'function FlowEdge(', '\n}\n');
  assert.ok(edgeFn.length > 300, `自定义边那段没抠出来（${edgeFn.length}）—— 先修这条判据`);
  assert.match(edgeFn, /label=\{label\}/, '标签没有转交给 `BaseEdge` —— 那会退回「我们自己画标签」，教师否过');
  assert.match(edgeFn, /labelShowBg=\{labelShowBg\}/, '`labelShowBg` 没转交（库那个白底框会不见）');
  assert.match(edgeFn, /markerEnd=\{markerEnd\}/, '箭头没转交 —— 线会没有箭头');
});

/*
  ★ 2026-10-07（**一次真实事故换来的判据**）：`<ReactFlow>` 上的**核心回调一个都不能少**。

  🔴 我删「节点吸附」那段代码时，脚本按标记切块，结束标记取的是 `onConnectEnd=` ——
     而它**前面**还有 `onEdgesChange` / `onConnect` / `onReconnect` 三行，被**一起切掉了**。
     后果：**框与框连不上线、拖端点重连失灵、边点不中**。
  🔴 **`tsc` 没报**（那三行只是「赋值了没用」）、**判据也没报**（源码级判据只看它认识的那几处）——
     是 `eslint` 的 `no-unused-vars` 把它抓出来的。**这就是假绿的样子**。
  ⇒ 这里钉住它们，谁再让它们消失就当场红。
*/
test('ReactFlow 的核心回调一个都不能少（删代码时切块切掉过一次）', () => {
  for (const prop of ['onNodesChange', 'onEdgesChange', 'onConnect', 'onReconnect', 'onConnectEnd']) {
    assert.match(
      SOURCE,
      new RegExp(`${prop}=\\{disabled \\? undefined : ${prop}\\}`),
      `\`<ReactFlow>\` 上的 ${prop} 不见了 —— 连线/重连/边变化会静默失灵（2026-10-07 出过一次）`,
    );
  }
});

/*
  ★ 2026-10-07（教师）：「会出现如图这种情况……把上面这个文本框**自动往右边稍微移动一下**，
  这样就能保证上下对齐了」—— 线矫正之后**落点**偏了（箭头贴在菱形的斜边上），得把**框**挪过去。

  🔴 两条规则的门槛**必须同一个数**：线在 `worksheet-flowchart-edge.ts`，框在
  `worksheet-flowchart-layout.ts`（那边是两个**副本**常量，故意不互相 import）。
  不一致的表现是「线还斜着、框却被硬拽」—— 教师说的「框乱跳」就是它（当时线那边 12px、
  框那边固定 75px）。
*/
test('两个门槛常量必须同值 —— 否则会出现「线还斜着、框却被拽」', () => {
  const ROOT = path.resolve(HERE, '../../../../..'); // → src/
  const LAYOUT = fs.readFileSync(path.join(ROOT, 'lib/worksheet-flowchart-layout.ts'), 'utf8');
  const EDGE = fs.readFileSync(path.join(ROOT, 'lib/worksheet-flowchart-edge.ts'), 'utf8');
  const num = (src: string, name: string) => Number((new RegExp(`const ${name} = ([\\d.]+);`).exec(src) ?? [])[1]);
  const shortA = num(LAYOUT, 'FLOW_STRAIGHT_SNAP_FOR_LAYOUT');
  const shortB = num(EDGE, 'FLOW_STRAIGHT_SNAP');
  const slopeA = num(LAYOUT, 'FLOW_SNAP_SLOPE_FOR_LAYOUT');
  const slopeB = num(EDGE, 'FLOW_SNAP_SLOPE');
  assert.ok(Number.isFinite(shortA) && Number.isFinite(shortB), '读不到「折线太短」那两个常量');
  assert.ok(Number.isFinite(slopeA) && Number.isFinite(slopeB), '读不到「斜率」那两个常量');
  assert.equal(shortA, shortB, `「折线太短」的门槛不一致：布局 ${shortA} / 画线 ${shortB}`);
  assert.equal(slopeA, slopeB, `「斜率」的门槛不一致：布局 ${slopeA} / 画线 ${slopeB}`);
});

test('同列吸附挂在拖动结束那一下，而且用的是 alignSnapX', () => {
  assert.match(SOURCE, /onNodeDragStop=\{disabled \? undefined : \(_, node\) =>/, '没有接拖动结束');
  assert.match(SOURCE, /alignSnapX\(current, edges, node\.id\)/, '没有算吸附（要用函数式的 current）');
});

/*
  ⊘ 2026-10-07：下面这段记的是**同一件事的前两次翻车**（都发生在「线矫正」做出来之前）。

  经过：教师先要「线不要倾斜」，我把它做成了「拖框时吸节点」；他随后连说两次跳跃
  （拖动中吸会与 React Flow 每帧打架 ⇒ 框乱跳；改成松手吸之后，那一下本身也是跳）。
  最后他给了准确的要求：

  > 「当变成一根直线以后，慢慢再拖动，**当快接近标准竖线或标准横线时，则自动矫正角度，
  >  将斜线变成真正的竖线和横线**」

  ⇒ **一个节点都不动，只矫正线的画法**。那条规则在 `@/lib/worksheet-flowchart-edge.ts`
    （`FLOW_SNAP_SLOPE`），判据在同名的 `.test.ts`；`alignSnapX` 已随之删除。
*/
/*
  ★ 2026-10-07（教师）：「折线上还是需要出现一个**控制柄**，可以让用户上下拖动这条横线，
  或者是左右拖动一条竖线，但是**这个控制柄本身不允许移动位置**」。

  「不允许移动位置」= 它**长在折线上**（画在库算出来的路径点上），而不是一个自由浮层。
  轴由边的走向定：竖直的边中间是**横线** ⇒ 上下；水平的边中间是**竖线** ⇒ 左右。
*/
test('折线上的控制柄：画在路径点上、而且只动一个轴', () => {
  assert.match(SOURCE, /<FlowRouteHandle/, '没有渲染那个控制柄');
  assert.match(
    SOURCE,
    /axis=\{vertical \? 'y' : 'x'\}/,
    '轴没有按线的走向定 —— 「上下拖横线 / 左右拖竖线」就是这一句',
  );
  const handleFn = blockBetween(SOURCE, 'function FlowRouteHandle(', '\n}\n');
  assert.ok(handleFn.length > 300, `控制柄那段没抠出来（${handleFn.length}）—— 先修这条判据`);
  assert.match(handleFn, /routeX|routeY/, '拖它没有写回绕行点');
  assert.match(handleFn, /screenToFlowPosition/, '没有把屏幕坐标换算成流坐标（拖起来会飘）');
});
