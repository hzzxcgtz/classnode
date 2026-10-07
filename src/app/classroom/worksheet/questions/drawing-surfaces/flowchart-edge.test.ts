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

/* ⚠️ 相对路径而不是 `@/lib/…`：判据跑在**纯 Node** 下（没有打包器解析别名）。 */
import { FLOW_HANDLE_HALF } from '../../../../../lib/worksheet-flowchart-edge.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8');

/**
 * **对拍**：端点往外那半个方块（`FLOW_HANDLE_HALF`）必须等于样式表里句柄尺寸的一半。
 * 这是本仓的老套路（交点那颗 8px 也是这么对的）：改了一边忘了另一边，当场红。
 * ⚠️ 认的是 `.flowNode :global(.react-flow__handle)` 那条规则里的 `width` —— 换句柄尺寸就得回来。
 */
test('端点外扩量 == 样式表里句柄尺寸的一半（对拍）', () => {
  const css = fs.readFileSync(path.join(HERE, '..', '..', 'worksheet.module.css'), 'utf8');
  /*
   * ⚠️ 必须连 `{` 一起认：`.flowNode :global(.react-flow__handle)` 这串字在**注释里**也出现过
   *   （交点那段解释「线要接在它的上/下」）—— 只 `indexOf` 那串字会切到一段注释上，
   *   判据于是在**别人的样式**里读 `width`（施工时实测：读到的是 `8px`）。
   */
  const rule = css.match(/\.flowNode :global\(\.react-flow__handle\)\s*\{([\s\S]*?)\}/);
  assert.ok(rule, '样式表里找不到句柄那条规则 —— 先修这条判据');
  const width = rule[1].match(/width:\s*(\d+)px/);
  assert.ok(width, `句柄那条规则里没读到 width（抠出来的是「${rule[1].slice(0, 40)}」）—— 先修这条判据`);
  assert.equal(
    Number(width[1]) / 2,
    FLOW_HANDLE_HALF,
    '句柄尺寸与 `FLOW_HANDLE_HALF` 对不上了 —— 端点会算错，绕行点的能走范围会与线差半个方块',
  );
});

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
  ⊘ 2026-10-07：这里曾经有「同列吸附」的一整套判据（拖动时 / 松手时 / 门槛对拍）—— **全删了**。

  那件事来回了**五轮**，值得记下来，因为每一轮都不是实现写错，而是**需求没收敛**：
    1. 「连接线接近直线时要吸附成直线」 → 我做成「拖框时吸节点」，教师说方向不对（他要的是**线**直）；
    2. 「略微倾斜」 → 我改成拖动中实时吸，教师说**框乱跳**（拖动中改位置与 React Flow 每帧打架）；
    3. 改成松手吸 → 教师说**还是跳**；
    4. 改成「只矫正线的角度」（不动节点）→ 教师接受，但发现**箭头落不到 target 上**；
    5. 为了补落点又去吸框 → 教师：「**还是不要自动校正那个矩形框了，斜线就斜线吧**」。

  ⇒ 当时留下的只有一条：**折线短到一定程度就画成一根直线**（斜就斜着），**节点一个都不动**。

  ⊘ 2026-10-07（同一天里**又改了一次**）：那条「短了就拉直」的规则**也撤了** —— 教师看到实物：
    「**这里还是取消自动变换成斜线吧，很怪异。所有的线条要不就是竖线，要不就是横线**」。
    ⇒ 现在路径**一律**交回库（它的每一段本来就是横的或竖的），
      **一条斜线都不画**，节点也一个都不动。判据在 `src/lib/worksheet-flowchart-edge.test.ts`。
  🔴 教训（这一串来回的收束）：**「自动矫正」每加一层都会带出新的偏差**，再补一层又带出下一个；
    最后站得住的是**库原本那套折线** —— 不要替它做决定。
*/

/*
  ⊘ 2026-10-07：下面这段记的是**同一件事的前两次翻车**（都发生在「线矫正」做出来之前）。

  经过：教师先要「线不要倾斜」，我把它做成了「拖框时吸节点」；他随后连说两次跳跃
  （拖动中吸会与 React Flow 每帧打架 ⇒ 框乱跳；改成松手吸之后，那一下本身也是跳）。
  他随后给了准确的要求（⊘ 这条**也随上面那次撤销一起没了** —— 它正是「把线画正」那一路）：

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
test('折线上的控制柄：压在线上、轴由走向定、拖的位置夹在合法范围里', () => {
  assert.match(SOURCE, /<FlowRouteHandle/, '没有渲染那个控制柄');
  /*
   * ★ 2026-10-07（第二次报障）：「连线的控制点必须**永远压在线上面**，不能漂移到线外」。
   * 🔴 上一版锚点取自 `data.routeX/routeY`，而且要求**两个轴都在**才用它 —— 可拖动只写一个轴
   *    ⇒ 它退回「库算的**默认**中点」：线已经跟着手指走了，把手还钉在原来那儿
   *    （教师截图里那颗飘在线外的空心圆就是这么来的）。
   * ✅ 现在锚点**一律**取锚点表里那个**画出来的路径**的中点 —— 与线同源，漂不了。
   */
  assert.match(
    SOURCE,
    /anchor=\{\{ x: viewport\.x \+ anchors\.midX \* viewport\.zoom/,
    '把手不是画在**画出来的那条路径**的中点上 —— 那就还会漂',
  );
  assert.ok(
    !/route\?\.routeX !== undefined && route\?\.routeY !== undefined/.test(SOURCE),
    '把手又回去读绕行点的原值了 —— 那条路要求**两个轴都在**，正是漂移的根',
  );
  /*
   * ★ 2026-10-07（教师）：「这是这条横线往下移动的**最低位置**，再往下移…会导致弧线折返」。
   * 轴与范围都来自 `track`（`flowRouteTrack` —— 复刻库 `getPoints` 的判据）。
   * ⚠️ 轴**不能**由句柄 id 定：同一个 `bottom→top`，源在上面时中段是**横**的、在下面时是**竖**的
   *    —— 看句柄 id 的那种写法在后者上就是「拖了没反应」（教师刚报过的同一类错）。
   */
  assert.match(SOURCE, /track=\{anchors\.track\}/, '没有把「能走的那条线 + 范围」交给把手');
  assert.ok(
    !/axis=\{vertical \? 'y' : 'x'\}/.test(SOURCE),
    '轴又回去看句柄 id 了 —— 源在目标下面时会「拖了没反应」',
  );
  assert.match(
    SOURCE,
    /if \(!anchors\?\.track\) return null/,
    '拐弯的边上也画了把手 —— 那种边库压根不读绕行点，拖了没反应；宁可没有，也不给一个骗人的',
  );
  const handleFn = blockBetween(SOURCE, 'function FlowRouteHandle(', '\n}\n');
  assert.ok(handleFn.length > 300, `控制柄那段没抠出来（${handleFn.length}）—— 先修这条判据`);
  assert.match(handleFn, /clampToTrack\(/, '拖它没有夹进合法范围 —— 越过去中段就会折返（教师那张图的「最低位置」）');
  assert.match(handleFn, /routeX|routeY/, '拖它没有写回绕行点');
  assert.match(handleFn, /screenToFlowPosition/, '没有把屏幕坐标换算成流坐标（拖起来会飘）');
  /*
   * ⊘ 2026-10-07：`onDragStateChange` 那条守卫（拖动期间不记历史）**故意不在这里判** ——
   *   它已经在 `flowchart-history-wiring.test.ts` 里有一条更结实的判据
   *   （读变化检测 effect 的守卫 + 依赖），在这里再来一条只会是同一件事的副本。
   */
});

/*
  ★ 2026-10-07（教师）：「线上文字……如果是竖线，默认在右侧；如果是横线，默认在上方」，
  并选了「**贴着线拖**」。几何在 `@/lib/worksheet-flowchart-edge.ts`（`flowLabelOffset` 等，
  那边有纯函数用例）；这里只钉**接线**：偏移有没有加给库、把手有没有画、拖的时候夹没夹。

  🔴 这一轮**没有**把标签从库手里拿回来 —— 库画的还是它（白底框/居中/配色全不动），
     我们只是把它收到的那两个坐标挪一下。所以「全回原版」没有被推翻。
*/
test('★ 标签：偏移加给库的坐标（不是自己画）、把手跟着标签、拖的时候夹在「线附近」', () => {
  assert.match(SOURCE, /const labelX = baseLabelX \+ labelOffset\.dx;/, '没有把标签偏移加给**库的入参** —— 那就变成我们自己摆标签了');
  assert.match(SOURCE, /labelX=\{labelX\}/, 'BaseEdge 没拿到挪过的标签坐标');
  assert.match(SOURCE, /<FlowLabelHandle/, '没有渲染拖标签的把手');
  assert.match(SOURCE, /if \(!anchors \|\| !edge\?\.label\) return null/, '没有文字的线也画了把手 —— 没东西可拖');
  assert.match(SOURCE, /clampLabelOffset\(/, '拖标签没有夹在「线附近」—— 拖丢了就找不回来了');
  assert.match(SOURCE, /labelDX: next\.dx, labelDY: next\.dy/, '拖它没有把位置写回边数据');
  assert.match(SOURCE, /labelX: labelX \+ labelOffset\.dx, labelY: labelY \+ labelOffset\.dy/, '锚点表没有吐出「标签画在哪」');
  assert.match(SOURCE, /const \{ labelX, labelY \} = anchors;/, '就地输入框没有跟着标签走 —— 会停在线上与那几个字分家');
  /*
   * ⚠️ 命中区**跟着字走**：只有 44px 的话，四个字以上的标签只能从正中间拖得动（抓边上会掉到线上）。
   * ⚠️ 而且必须**乘缩放**：命中区是**屏幕像素**（浮层不跟着画布缩放），字宽是**流坐标** ——
   *    不乘的话，放大到 2 倍时命中区只有字的一半宽。
   */
  assert.match(
    SOURCE,
    /width=\{Math\.max\(44,[^}]*flowLabelWidth\([^)]*\)[^}]*viewport\.zoom[^}]*\)\}/,
    '拖标签的命中区不是「字宽 × 缩放」（放大后只能从字中间拖得动）',
  );
});

/*
  ★ 2026-10-07（教师）：「连接线上的文字说明，在我选中以后、移动之前，能不能套一个**简单的
  文本框**，表示我选中了、可以移动了？」
  ✅ 框套在**库那块白底矩形**上（`labelBgStyle`）—— 它本来就贴着字量出来 ⇒ 缩放变了也严丝合缝。
  🔴 别改成自己画一个 `<rect>`：自己算的那个在缩放一变就与字差几个像素。
*/
test('★ 选中这条线时，线上的字套一个虚线框（框走库那块白底矩形）', () => {
  assert.match(SOURCE, /const labelBg = selected && label/, '没有按「选中 + 有字」决定要不要套框');
  const box = blockBetween(SOURCE, 'const labelBg = selected && label', 'labelBgStyle;');
  assert.ok(box.length > 60, `套框那一段没抠出来（${box.length}）—— 先修这条判据`);
  assert.match(box, /strokeDasharray/, '框没有画成虚线（实线会与线的样式混在一起）');
  assert.match(box, /\.\.\.labelBgStyle/, '没有把库原本那身样式带上 —— 会把库的白底盖掉');
  assert.match(SOURCE, /labelBgStyle=\{labelBg\}/, '套好的框没有传给 BaseEdge');
});
