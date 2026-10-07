/**
 * 流程图 → **SVG**（★ 2026-10-06）。纯函数：给一份流程数据，吐一张图。
 *
 * 🔴 为什么自己写而不用 `html-to-image` 之类：那类库的做法是 `<foreignObject>` 里塞 HTML，
 *    老 iPad（Safari 15）对它的支持很勉强 —— 出来的可能是**空白图**，而且**不报错**。
 *    流程图的形状与文字都是我们自己的数据（矩形/菱形/椭圆/平行四边形 + 连线 + 文字），
 *    自己吐一份纯 SVG 就能栅格化，跑在 Safari 15 上稳，也**不用多一个依赖**。
 *
 * ⚠️ 它是**快照**，只求「教师与 AI 看懂学生画了什么」，不追求与编辑器逐像素一致：
 *    `measured`（React Flow 量出来的真实尺寸）在就照着画，不在就按字数估一个。
 *    字号、配色跟着应用那一套（深浅蓝 + 白底），避免快照长得像另一个产品。
 * 🔴 **但有两件事必须与画板一字不差**（★ 2026-10-07）：**边端点的约定**（`flowAnchorPoint`）
 *    与**绕行点的规则**（`flowRoutePoint`）—— 差一点，快照里的线就与画板上那条对不上，
 *    而这份快照正是教师与 AI 看到的那张图。两处都走同一份纯函数，别在这里再写一遍。
 */

import { flowAnchorPoint, flowLabelOffset, flowRoutePoint } from './worksheet-flowchart-edge.ts';
/* ⚠️ 平行四边形的斜角**只有一份真源**（它与样式表里 `.flowNode_io` 的 `skew(-10deg)` 对拍）。 */
import { FLOW_IO_SKEW_DEG } from './worksheet-flowchart-node.ts';
/*
 * ★ 2026-10-07：**路径交回库自己算**（`@xyflow/system`，与画板同一个函数）——
 *   画板画的就是它，我们再手搓一份必然分叉（拐角位置、留白、圆角都对不上）。
 *   ⚠️ 这个包**不含 React**（画板用的是 `@xyflow/react`），所以纯 Node 下能加载、判据照跑。
 */
import { getSmoothStepPath, Position } from '@xyflow/system';

/*
 * ★ 2026-10-07（教师）：「监控面板里看到的流程图……跟学生手机画的有比较大的差异……至少要接近」。
 * 下面这几个值**不是调出来的**，是从教师截图里**逐个取色量出来的**（ImageMagick 取像素）：
 *   · 节点边框 = `#7895b3`（`.flowNode` 的 `border-color`；原来是 `#527198`，那是**句柄**的颜色）；
 *   · 节点填充 = `#fff`（`.flowNode` 的 `background`；原来的 `#eef3f8` 偏蓝，一眼能看出两样）；
 *   · 节点文字 = `#263b53`（`.flowNode` 的 `color`）；
 *   · **连线** = `#b1b1b7`（库默认那条 `--xy-edge-stroke-default`；原来写的是蓝灰 `#6b86a5`，
 *     那是**箭头**的颜色 —— 画板正是「灰线 + 蓝灰箭头」）。
 */
const COLORS = {
  stroke: '#7895b3',
  fill: '#ffffff',
  root: '#27415f',
  text: '#263b53',
  /** 连线本体（灰）——与库默认值一致。 */
  edge: '#b1b1b7',
  /** 箭头（蓝灰）——画板 `FLOW_ARROW` 显式指定的那个颜色。 */
  arrow: '#6b86a5',
};

const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
const FONT_SIZE = 13;
const LINE_HEIGHT = 17;
const PADDING = 18;
const MIN_WIDTH = 96;
const MAX_WIDTH = 240;

/*
  ── ★ 2026-10-06（教师上传的标准流程图）：快照里两处**必须与画板逐项对齐** ─────────────
  🔴 这是本仓最防的那类不一致：**别处看见的（快照 / 报告 / AI 联系表）与画板不一样，
     而两边都不报错**。所以这两个数都**读画板的真源**、不各自猜一份：
      · 交点的外框尺寸 —— 画板 CSS `.flowNode_junction` 的 `width`（8×8，`box-sizing: border-box`）；
        `readFlowRaster` 里那个 `12` 也得跟着它走（节点盒子 = 尺寸，`position` 是左上角）。
      · 标签离线多远 —— 画板 `flowchart-drawing.tsx` 的 `EDGE_LABEL_GAP`（≡ 8，流坐标）。
     `worksheet-flowchart-svg.test.ts` 会把这三处对起来（改任一边 ⇒ 红）。
     ⚠️ 真源在**另一个模块**里 ⇒ 只能用**字符串/注释**指过去，不在编译期耦合
        （这个文件是纯序列化器，别把 React 组件那一坨拖进依赖图）。
*/
/** 交点外框边长（画板 CSS `.flowNode_junction`：8×8 的描边空心小环，白底 + 2px 描边）。 */
const JUNCTION_DIAMETER = 8;
/**
 * 交点半径（SVG 画的是圆心 + r ⇒ 直径的一半）。
 * 🔴 **由 `JUNCTION_DIAMETER` 现算**，不另写一个 `4`：只改直径、忘了改半径 ⇒ 快照上那颗圆
 *    就会与画板差一圈，而两边都不报错（`worksheet-flowchart-svg.test.ts` 也钉住这条关系）。
 */
const JUNCTION_RADIUS = JUNCTION_DIAMETER / 2;
/** 交点描边宽（画板 CSS `border: 2px solid …`）。 */
const JUNCTION_STROKE_WIDTH = 2;
/** 交点描边色 = 画板 `.flowNode_junction` 的 border 色（也与线的箭头 `COLORS.edge` 同色）。 */
const JUNCTION_STROKE = '#6b86a5';
/** 交点填充 = 画板 `.flowNode_junction` 的 `background` —— **空心**（原来是 `COLORS.stroke` 实心）。 */
const JUNCTION_FILL = '#fff';
/*
 * ⊘ 2026-10-06（教师：「全回原版」）：这里原有 `FLOW_LABEL_OFFSET = 8` —— 它让快照的标签
 *   「离线多远」与画板的 `EDGE_LABEL_GAP` 同值（当时标签摆在线旁边）。
 *   标签交回库之后，画板那边不再摆标签、这边也改成「中点 + 白底框」⇒ 这个偏移没有对象了。
 */

export interface FlowRasterNode {
  id: string;
  position: { x: number; y: number };
  label: string;
  kind: string;
  width: number;
  height: number;
}

export interface FlowRasterEdge {
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  /** ★ 2026-10-06：线上的文字（判断框分出来的 Y / N）。**必须画进快照**。 */
  label: string;
  routeX: number | null;
  routeY: number | null;
  /** ★ 2026-10-07：标签被拖过的位置（相对线条中点）；没拖过是 `null` ⇒ 用默认那一侧。 */
  labelDX: number | null;
  labelDY: number | null;
}

/** XML 文本转义 —— 学生写的东西会原样进 SVG。 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 按字数估一个能装下文字的框（`measured` 缺席时的兜底）。 */
function estimateWidth(label: string): number {
  const units = Array.from(label).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55), 0);
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, 30 + units * 14));
}

/** 流程数据 → 画图用的形状。形状不对就**少给几个**，不抛（它只是快照）。 */
export function readFlowRaster(raw: unknown): { nodes: FlowRasterNode[]; edges: FlowRasterEdge[] } {
  const row = asRecord(raw);
  const rawNodes = Array.isArray(row?.nodes) ? row.nodes : [];
  const rawEdges = Array.isArray(row?.edges) ? row.edges : [];
  const nodes: FlowRasterNode[] = [];
  for (const item of rawNodes) {
    const node = asRecord(item);
    if (!node || typeof node.id !== 'string') continue;
    const position = asRecord(node.position);
    const data = asRecord(node.data);
    const measured = asRecord(node.measured);
    const label = typeof data?.label === 'string' ? data.label : '';
    const kind = typeof data?.kind === 'string' ? data.kind : 'process';
    /**
     * ★ 2026-10-06（教师，A 方案）：**交点**（`kind === 'junction'`）不许走下面那两条兜底下限。
     *   它的真实尺寸就是 12×12（`.flowNode_junction`），而 `Math.max(24, …)` / `Math.max(20, …)`
     *   是给**文字框**兜底的（React Flow 首帧常常量出 0）—— 套在交点上会把节点盒子撑到 24×20，
     *   于是那颗圆点与两段线的落点会整体偏出真正的交点（快照看起来像没连上）。
     */
    const isJunction = kind === 'junction';
    nodes.push({
      id: node.id,
      position: { x: finite(position?.x, 0), y: finite(position?.y, 0) },
      label,
      kind,
      // ⚠️ 下限兜住「测出来是 0」那一帧（React Flow 首帧常常 width=0）——否形会画成一条线。
      width: isJunction ? 12 : Math.max(24, finite(measured?.width, estimateWidth(label))),
      height: isJunction ? 12 : Math.max(20, finite(measured?.height, 44)),
    });
  }
  const edges: FlowRasterEdge[] = [];
  for (const item of rawEdges) {
    const edge = asRecord(item);
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') continue;
    const edgeData = asRecord(edge.data);
    edges.push({
      source: edge.source,
      target: edge.target,
      sourceHandle: typeof edge.sourceHandle === 'string' ? edge.sourceHandle : null,
      targetHandle: typeof edge.targetHandle === 'string' ? edge.targetHandle : null,
      label: typeof edge.label === 'string' ? edge.label : '',
      routeX: typeof edgeData?.routeX === 'number' && Number.isFinite(edgeData.routeX) ? edgeData.routeX : null,
      routeY: typeof edgeData?.routeY === 'number' && Number.isFinite(edgeData.routeY) ? edgeData.routeY : null,
      labelDX: typeof edgeData?.labelDX === 'number' && Number.isFinite(edgeData.labelDX) ? edgeData.labelDX : null,
      labelDY: typeof edgeData?.labelDY === 'number' && Number.isFinite(edgeData.labelDY) ? edgeData.labelDY : null,
    });
  }
  return { nodes, edges };
}

/**
 * 一边的**方位**（`handle` 是 React Flow 的方位名：top/right/bottom/left）。
 * 没给 handle 时按两端相对位置猜（快照是离线重画的，没有库那套句柄信息）。
 */
function sideOf(node: FlowRasterNode, handle: string | null, towards: FlowRasterNode): string {
  return handle ?? (Math.abs(towards.position.x - node.position.x) > Math.abs(towards.position.y - node.position.y)
    ? (towards.position.x > node.position.x ? 'right' : 'left')
    : (towards.position.y > node.position.y ? 'bottom' : 'top'));
}

/**
 * 一边的**边端点**（流坐标）。
 *
 * 🔴 **与画板同一个约定**：`flowAnchorPoint` —— 库给边的端点落在**句柄方块的边**上，
 *    比节点边框再往外 6px。快照这边原来按「边框上的点」画 ⇒ 线比画板上**短 6px**（两头各 6），
 *    而且绕行点的**能走范围**会比画板紧 6px（夹出来的位置两边对不上）。
 */
function anchorOf(node: FlowRasterNode, side: string): [number, number] {
  const point = flowAnchorPoint({
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
  }, side);
  return [point.x, point.y];
}

/** 居中折行：按框宽断，最多三行（快照不追求完整排版，超出部分换行截断）。 */
function wrapLabel(label: string, width: number): string[] {
  const perLine = Math.max(2, Math.floor((width - 12) / FONT_SIZE));
  const chars = Array.from(label);
  const lines: string[] = [];
  for (let i = 0; i < chars.length && lines.length < 3; i += perLine) {
    lines.push(chars.slice(i, i + perLine).join(''));
  }
  return lines.length > 0 ? lines : [''];
}

function nodeShape(node: FlowRasterNode): string {
  const { x, y } = node.position;
  const w = node.width;
  const h = node.height;
  const common = `fill="${COLORS.fill}" stroke="${COLORS.stroke}" stroke-width="1.5"`;
  if (node.kind === 'terminator') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ry="${h / 2}" ${common}/>`;
  }
  if (node.kind === 'decision') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" ${common}/>`;
  }
  if (node.kind === 'io') {
    /*
     * 🔴 与画板**同一个角**：`.flowNode_io { transform: skew(-10deg) }`。
     *    斜切把上边相对下边推开 `高度 × tan(10°)`（不是半个 —— 上下各偏一半、合起来差一个整的）。
     *    原来这里写死 `Math.min(18, w/5)`（150 宽的框 ⇒ 18px ⇒ ≈18.4°）⇒ **斜了快一倍**，
     *    教师一眼就看出来了。数值从 `worksheet-flowchart-node.ts` 的常量来（那边与 CSS 对拍）。
     */
    const skew = h * Math.tan((FLOW_IO_SKEW_DEG * Math.PI) / 180);
    return `<polygon points="${x + skew},${y} ${x + w},${y} ${x + w - skew},${y + h} ${x},${y + h}" ${common}/>`;
  }
  if (node.kind === 'junction') {
    /*
      ★ 2026-10-06（教师，A 方案）：**交点** —— 连到线上时插进那条线里的小圆点。
      ⚠️ 它必须在这一支里 return：落进下面那个默认分支就会被画成一个**空矩形**
         （AI / 教师 / Word 报告里凭空多出一个框，而编辑器里根本没有那个框）。
      ★ 2026-10-06（对齐画板）：原来画的是 `r="5"`（10px）**实心** `#527198`，
         画板已改成 **8×8 的描边空心小环**（`.flowNode_junction`：`background:#fff` +
         `border:2px solid #6b86a5`）⇒ 快照跟着改：r = 8/2 = 4、白底、2px 描边、同色。
      ⚠️ 圆心在节点中心（`position` 是左上角 ⇒ + 边长/2），与画板那颗
         （`anchors.midX - junctionHalf` 放左上角）落在**同一个点**上。
    */
    return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${JUNCTION_RADIUS}" fill="${JUNCTION_FILL}" `
      + `stroke="${JUNCTION_STROKE}" stroke-width="${JUNCTION_STROKE_WIDTH}"/>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ry="8" ${common}/>`;
}

function nodeText(node: FlowRasterNode): string {
  const lines = wrapLabel(node.label, node.width);
  const cx = node.position.x + node.width / 2;
  const startY = node.position.y + node.height / 2 - ((lines.length - 1) * LINE_HEIGHT) / 2;
  return lines
    .map((line, index) => `<text x="${cx}" y="${startY + index * LINE_HEIGHT}" text-anchor="middle" `
      + `dominant-baseline="middle" font-family="${FONT}" font-size="${FONT_SIZE}" font-weight="600" fill="${COLORS.text}">`
      + `${escapeXml(line)}</text>`)
    .join('');
}

/** 一份流程数据 → `{ svg, width, height }`。没有节点时回 `null`（没东西可拍）。 */
export function flowchartSvg(raw: unknown): { svg: string; width: number; height: number } | null {
  const { nodes, edges } = readFlowRaster(raw);
  if (nodes.length === 0) return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const maxX = Math.max(...nodes.map((node) => node.position.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.position.y + node.height));
  const routeXs = edges.map((edge) => edge.routeX).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const routeYs = edges.map((edge) => edge.routeY).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const minX = Math.min(0, ...nodes.map((node) => node.position.x), ...routeXs);
  const minY = Math.min(0, ...nodes.map((node) => node.position.y), ...routeYs);
  const width = Math.ceil(Math.max(maxX, ...routeXs) - minX + PADDING * 2);
  const height = Math.ceil(Math.max(maxY, ...routeYs) - minY + PADDING * 2);

  const parts: string[] = [];
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const sourceSide = sideOf(source, edge.sourceHandle, target);
    const targetSide = sideOf(target, edge.targetHandle, source);
    const [x1, y1] = anchorOf(source, sourceSide);
    const [x2, y2] = anchorOf(target, targetSide);
    /*
      ★ 2026-10-07（教师：「快照也一起修了吧」）：绕行点交给 `flowRoutePoint` —— **与画板同一份规则**。
      🔴 原来这里是 `Number.isFinite(routeX) && Number.isFinite(routeY)`：**两个轴都在**才认。
         而拖动**只写一个轴**（竖直的边只写 routeY）⇒ 学生拖过的线在快照里**一点都看不出来**
         （画板上是对的，报告里还是老样子）—— 同一类根因，另一个面。
      ✅ 现在：认哪条轴、夹到哪儿、另一个轴补中点，全由那一个函数定 ——
         与画板算出来的绕行点**逐字一致**（夹取范围也一样，因为端点用的是同一个约定）。
    */
    const route = flowRoutePoint({
      sourceX: x1, sourceY: y1, sourcePosition: sourceSide,
      targetX: x2, targetY: y2, targetPosition: targetSide,
      /* ⚠️ 两个轴都要**原样喂进去**（`readFlowRaster` 给的是 `number | null`）——
         认哪条轴由 `flowRoutePoint` 判，我们不在这里挑。忘了喂 = 绕行点静默失效。 */
      ...(edge.routeX === null ? {} : { centerX: edge.routeX }),
      ...(edge.routeY === null ? {} : { centerY: edge.routeY }),
    });
    const routeX = route ? route.x : (x1 + x2) / 2;
    const routeY = route ? route.y : (y1 + y2) / 2;
    /*
     * ★ 2026-10-07（教师）：「**所有的线条要不就是竖线，要不就是横线**」。
     * 🔴 这里原来**没有绕行点的边画一根 `<line>`**（两端直连）—— 两端差几像素时那就是**一条斜线**，
     *    与画板上那条折线对不上，正是教师截图里否掉的那种。
     * ✅ 现在一律画折线（`edgePoints`），每一段不是横的就是竖的；重复点会去掉。
     */
    /*
     * ★ 2026-10-07（教师）：「监控面板里看到的流程图……跟学生（端）画的有比较大的差异……至少要接近」。
     * 🔴 原来这里是我们**手搓**的一根折线：拐角落在**节点边框上**、没有库那 20px 的留白、
     *    也没有圆角 ⇒ 与画板（库画的）形状明显两样。
     * ✅ 现在**直接调库**（与画板同一个函数、同一份入参）⇒ 路径、圆角、留白、标签点全都一致。
     *    ⚠️ 绕行点仍旧走 `flowRoutePoint`（认轴 + 夹范围）—— 那是我们自己的规则，两侧共用。
     */
    const [path, libraryLabelX, libraryLabelY] = getSmoothStepPath({
      sourceX: x1, sourceY: y1, sourcePosition: sourceSide as Position,
      targetX: x2, targetY: y2, targetPosition: targetSide as Position,
      ...(route ? { centerX: route.x, centerY: route.y } : {}),
    });
    parts.push(`<path d="${path}" fill="none" stroke="${COLORS.edge}" stroke-width="1.8" marker-end="url(#flow-arrow)"/>`);
    /*
      ★ 2026-10-06（教师上传的标准流程图）：线上的字画在**线的旁边**，不压线 ——
        与画板 `FlowLabelEdge` **同一条规则**（同一个判据来源：`targetHandle` 的方位）：
          · 进目标那一侧是上/下 ⇒ 末段**竖直** ⇒ 文字在**右侧**：`text-anchor="start"` +
            `x = 中点 + 偏移` ⇒ 不管标签多长，**左边缘**都贴在线右侧，永不压线；
          · 是左/右 ⇒ 末段**水平** ⇒ 文字在**上方**且水平居中：`y = 中点 - 偏移`。
      ⊘ 2026-10-06：原来这里是「居中压线 + 白底圆角框（`<rect fill="#ffffff">`）」——
        与画板现在的摆法不一致（画板已去掉白底框）。**别再画那个 `<rect>`**。
      ⚠️ 快照里的字是 SVG `<text>`（不是 HTML）⇒ CSS 那套 `dy` 用不了，两个方向各取一个
         `text-anchor`，位置靠 `x` / `y` 的偏移表达（画板那两处也是这么摆的）。
      ⚠️ **基线**：不用 `dominant-baseline`（Safari 15 对它的支持不可靠），竖线那一支用
         与画板同值的 `dy="0.35em"`（`em` 相对字号 ⇒ 与 `font-size` 一起缩放）；
         横线那一支靠 `y` 抬到线的上方，字形整体在线之上，不依赖任何基线属性。
    */
    if (edge.label) {
      /*
       * ★ 2026-10-06（教师：「**全回原版**」）：线上的字画在**路径中点**、带**白底框** ——
       *   与画板一致：标签交回库之后，库就是这么画的（`.react-flow__edge-textbg` 那个白底框回来了）。
       * ⊘ 原来这里画的是「偏在线旁边、不压线、无白底框」（配当时那份自定义边）——
       *   教师定了「全回原版」，那条要求连同它的摆法一起撤了。
       * ⚠️ 白底框**不是装饰**：中点那个位置**正好压在线段上**，没有它字和线会叠在一起读不清。
       * ⚠️ 基线不用 `dominant-baseline`（Safari 15 对它支持不可靠），用 `dy="0.35em"` 把字抬到线上。
       */
      const bgWidth = Array.from(edge.label).length * FONT_SIZE + 6;
      /*
        ★ 2026-10-07（教师）：「如果是竖线，默认在右侧；如果是横线，默认在上方」+「贴着线拖」。
        🔴 标签**不再压在线上了** ⇒ 快照也得挪（与画板同一份规则 `flowLabelOffset`）：
           否则报告里那几个字还压着线，而画板上已经让开了 —— 两边都不报错的那种不一致。
      */
      const labelOffset = flowLabelOffset(
        { sourceX: x1, sourceY: y1, sourcePosition: sourceSide, targetX: x2, targetY: y2, targetPosition: targetSide },
        edge.label,
        edge.labelDX === null || edge.labelDY === null ? null : { dx: edge.labelDX, dy: edge.labelDY },
      );
      /*
       * ★ 2026-10-07：标签基点也改成**库回给画板的那个**（`labelX/labelY`）——
       *   原来用的是我们自己算的角点 ⇒ 同一条线上，报告里的字与画板上的字能差出十几像素。
       */
      const labelX = libraryLabelX + labelOffset.dx;
      const labelY = libraryLabelY + labelOffset.dy;
      parts.push(`<rect x="${labelX - bgWidth / 2}" y="${labelY - LINE_HEIGHT + 3}" width="${bgWidth}" `
        + `height="${LINE_HEIGHT}" rx="3" fill="#ffffff"/>`);
      parts.push(`<text x="${labelX}" y="${labelY}" dy="0.35em" text-anchor="middle" `
        + `font-family="${FONT}" font-size="${FONT_SIZE}" fill="#263b53">${escapeXml(edge.label)}</text>`);
    }
  }
  for (const node of nodes) parts.push(nodeShape(node));
  for (const node of nodes) parts.push(nodeText(node));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
    + `<path d="M 0 0 L 10 5 L 0 10 z" fill="${COLORS.arrow}"/></marker></defs>`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`
    + `<g transform="translate(${PADDING - minX}, ${PADDING - minY})">${parts.join('')}</g>`
    + `</svg>`;
  return { svg, width, height };
}
