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
 */

const COLORS = {
  stroke: '#527198',
  fill: '#eef3f8',
  root: '#27415f',
  text: '#24364b',
  edge: '#6b86a5',
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
    });
  }
  return { nodes, edges };
}

/** 一边的中点（`handle` 是 React Flow 的方位名：top/right/bottom/left）。 */
function anchorOf(node: FlowRasterNode, handle: string | null, towards: FlowRasterNode): [number, number] {
  const cx = node.position.x + node.width / 2;
  const cy = node.position.y + node.height / 2;
  const side = handle ?? (Math.abs(towards.position.x - node.position.x) > Math.abs(towards.position.y - node.position.y)
    ? (towards.position.x > node.position.x ? 'right' : 'left')
    : (towards.position.y > node.position.y ? 'bottom' : 'top'));
  if (side === 'top') return [cx, node.position.y];
  if (side === 'bottom') return [cx, node.position.y + node.height];
  if (side === 'left') return [node.position.x, cy];
  return [node.position.x + node.width, cy];
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
  const common = `fill="${COLORS.fill}" stroke="${COLORS.stroke}" stroke-width="1.6"`;
  if (node.kind === 'terminator') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ry="${h / 2}" ${common}/>`;
  }
  if (node.kind === 'decision') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" ${common}/>`;
  }
  if (node.kind === 'io') {
    const skew = Math.min(18, w / 5);
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
      + `dominant-baseline="middle" font-family="${FONT}" font-size="${FONT_SIZE}" fill="${COLORS.text}">`
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
    const [x1, y1] = anchorOf(source, edge.sourceHandle, target);
    const [x2, y2] = anchorOf(target, edge.targetHandle, source);
    const hasRoute = Number.isFinite(edge.routeX) && Number.isFinite(edge.routeY);
    const routeX = hasRoute ? edge.routeX as number : (x1 + x2) / 2;
    const routeY = hasRoute ? edge.routeY as number : (y1 + y2) / 2;
    if (hasRoute) {
      const sourceVertical = edge.sourceHandle === 'top' || edge.sourceHandle === 'bottom';
      const targetVertical = edge.targetHandle === 'top' || edge.targetHandle === 'bottom';
      const first: [number, number] = sourceVertical ? [x1, routeY] : [routeX, y1];
      const second: [number, number] = targetVertical ? [x2, routeY] : [routeX, y2];
      parts.push(`<path d="M ${x1} ${y1} L ${first[0]} ${first[1]} L ${second[0]} ${second[1]} L ${x2} ${y2}" `
        + `fill="none" stroke="${COLORS.edge}" stroke-width="1.8" marker-end="url(#flow-arrow)"/>`);
    } else {
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLORS.edge}" `
        + `stroke-width="1.8" marker-end="url(#flow-arrow)"/>`);
    }
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
      parts.push(`<rect x="${routeX - bgWidth / 2}" y="${routeY - LINE_HEIGHT + 3}" width="${bgWidth}" `
        + `height="${LINE_HEIGHT}" rx="3" fill="#ffffff"/>`);
      parts.push(`<text x="${routeX}" y="${routeY}" dy="0.35em" text-anchor="middle" `
        + `font-family="${FONT}" font-size="${FONT_SIZE}" fill="#263b53">${escapeXml(edge.label)}</text>`);
    }
  }
  for (const node of nodes) parts.push(nodeShape(node));
  for (const node of nodes) parts.push(nodeText(node));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
    + `<path d="M 0 0 L 10 5 L 0 10 z" fill="${COLORS.edge}"/></marker></defs>`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`
    + `<g transform="translate(${PADDING - minX}, ${PADDING - minY})">${parts.join('')}</g>`
    + `</svg>`;
  return { svg, width, height };
}
