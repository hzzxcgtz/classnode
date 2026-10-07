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
  ★ 2026-10-07（教师）：「线条是能够直接变直线了，但是可能出现**略微倾斜**的情况」——
  几何上的死结：一条边**必须**连两端句柄 ⇒ 两端 x 只差一点点时，画折线有疙瘩、画直线又必然斜。
  ⇒ 唯一根治的是让**两端的 x 真的相等**：拖框时吸附对齐。

  纯函数在 `alignSnapX`（6 条用例）；这条判据钉**接线**：
  必须拦在 `onNodesChange`（位置变化的**入口**）、只处理**正在拖**的那条、而且 `<ReactFlow>` 真的挂上了。
  ⚠️ 挂在 `onNodeDrag` 里事后修正的话，学生会看到它**先歪一下再被拽正**。
*/
test('拖动时的同列吸附：拦在 onNodesChange，且只对「正在拖」的那条生效', () => {
  assert.match(SOURCE, /const onNodesChangeSnapped = useCallback/, '没有包那一层');
  assert.match(SOURCE, /alignSnapX\(nodes, edges, change\.id\)/, '没有算吸附');
  assert.match(
    SOURCE,
    /change\.dragging !== true/,
    '要只处理**正在拖**的那条 —— 程序化改位置（撤销 / 一键整理）不该再被吸一次',
  );
  assert.match(
    SOURCE,
    /onNodesChange=\{disabled \? undefined : onNodesChangeSnapped\}/,
    '`<ReactFlow>` 没挂上包过的那个（拦了等于没拦）',
  );
});

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
