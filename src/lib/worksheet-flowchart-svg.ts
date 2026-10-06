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
    nodes.push({
      id: node.id,
      position: { x: finite(position?.x, 0), y: finite(position?.y, 0) },
      label,
      kind,
      // ⚠️ 下限兜住「测出来是 0」那一帧（React Flow 首帧常常 width=0）——否形会画成一条线。
      width: Math.max(24, finite(measured?.width, estimateWidth(label))),
      height: Math.max(20, finite(measured?.height, 44)),
    });
  }
  const edges: FlowRasterEdge[] = [];
  for (const item of rawEdges) {
    const edge = asRecord(item);
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') continue;
    edges.push({
      source: edge.source,
      target: edge.target,
      sourceHandle: typeof edge.sourceHandle === 'string' ? edge.sourceHandle : null,
      targetHandle: typeof edge.targetHandle === 'string' ? edge.targetHandle : null,
      label: typeof edge.label === 'string' ? edge.label : '',
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
  const width = Math.ceil(maxX + PADDING * 2);
  const height = Math.ceil(maxY + PADDING * 2);

  const parts: string[] = [];
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const [x1, y1] = anchorOf(source, edge.sourceHandle, target);
    const [x2, y2] = anchorOf(target, edge.targetHandle, source);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLORS.edge}" `
      + `stroke-width="1.8" marker-end="url(#flow-arrow)"/>`);
    // 线上的字：白底圆角垫一层，压在线上也读得清（与编辑器里那个标签同一个位置：中点）。
    if (edge.label) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const w = 14 + edge.label.length * 11;
      parts.push(`<rect x="${mx - w / 2}" y="${my - 12}" width="${w}" height="24" rx="6" fill="#ffffff" `
        + `stroke="${COLORS.stroke}" stroke-width="1"/>`);
      parts.push(`<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="middle" `
        + `font-family="${FONT}" font-size="${FONT_SIZE}" fill="${COLORS.text}">${escapeXml(edge.label)}</text>`);
    }
  }
  for (const node of nodes) parts.push(nodeShape(node));
  for (const node of nodes) parts.push(nodeText(node));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
    + `<path d="M 0 0 L 10 5 L 0 10 z" fill="${COLORS.edge}"/></marker></defs>`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`
    + `<g transform="translate(${PADDING}, ${PADDING})">${parts.join('')}</g>`
    + `</svg>`;
  return { svg, width, height };
}
