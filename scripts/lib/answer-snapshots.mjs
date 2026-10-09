/**
 * 学生的绘图作答 → **一张 PNG 快照**（★ 2026-10-08，**仅供种子脚本造测试数据**）。
 *
 * 🔴 为什么必须有这个文件 —— 少了它，AI 分析看到的是一叠**空格子**：
 *
 *   2026-10-06 起，四种画板（`free` / `math` / `mind-map` / `flowchart`）**都不再产 `strokes`**，
 *   结构化内容改挂在作答值的 `drawing.data` 里（`src/lib/worksheet-drawing-document.ts`）。
 *   而服务端**渲染不了**这些文档（`server/src/services/analysis-render.ts` 只认笔迹）。
 *   ⇒ 服务端读作答值的顺序是（`server/src/services/analysis-payload.ts:280-295`）：
 *        ① `readDrawingRaster` —— 取 `drawing.image`（那张快照）当**照片**用；
 *        ② `readInk` —— 认 `strokes`，而新画板的 `strokes` **恒为空数组**。
 *     所以：**没有 `drawing.image` 的绘图作答，在 AI 眼里等于交了白卷**。
 *     这不是"画得潦草"，是"那一格什么都没有"，而且**两边都不报错**。
 *
 * 🔴 所以本文件的产物**必须落盘成真 PNG**，与照片作答同一条纪律（见 `seed-worksheet-demo.mjs`
 *   文件头第 4 条）：指向空文件的 URL 会让分析当场抛错，而屏幕上只有"分析失败"四个字。
 *
 * ── 边界（别拿它当产品渲染器）──────────────────────────────────────────────
 * 这是**测试数据的脚手架**，不是产品代码：
 *   · 产品里那张快照由**学生端画布自己抓**（`useDrawingRaster` → `safeCapture`），
 *     与我们这里画的必然不完全一致（字体、抗锯齿、坐标微差）。
 *   · 这里只求"教师与 AI 看得懂学生画了什么"，与 `worksheet-flowchart-svg.ts` 的定位一致。
 *   · ⚠️ 但**几何**要照产品的真源来：四个记号的算法直接 import 产品的纯函数
 *     （`rightAngleOf` / `parallelMarkOf` / `equalMarkOf`），不在这里重推一遍 ——
 *     重推一份的后果是"快照里的直角方框与画板上那个位置不一样"，而那是静默的。
 *
 * ── 坐标口径 ──────────────────────────────────────────────────────────────
 *   · `math` 档：元素坐标就是**数学坐标**。画板固定视野 `[-10, 8, 10, -8]`
 *     （`math-drawing.tsx:138` 的 `boundingbox`），所以映射是纯比例。
 *   · `free` 档：`data.paths` 的点是**画布 CSS 像素**（0..320 / 0..240）。
 *   · 两档的默认画布框都是 `{w:320, h:240}`（`worksheet-ink.ts` 的 `INK_BOX_DRAWING`）。
 */
import { rightAngleOf, parallelMarkOf, equalMarkOf } from '../../src/lib/worksheet-math-shapes.ts';

/** 与产品一致的默认绘图框。`canvas.w/h` 写的就是它。 */
export const CANVAS_W = 320;
export const CANVAS_H = 240;
/** 栅格化倍率：AI 要看字，1x 的 320×240 太小。 */
export const SNAPSHOT_SCALE = 2;

const INK = '#1f2937';       // 与 `INK_STROKE_COLOR` 同一支笔
const GRID = '#dbe3ec';
const AXIS = '#94a3b8';
const ECHO = '#64748b';      // 文字（标注、数字）
const BG = '#ffffff';

const esc = (value) => String(value).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

const n = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0);

/** 一个 320×240 的白底画布，内容由 `body` 给。 */
function frame(body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W * SNAPSHOT_SCALE}" height="${CANVAS_H * SNAPSHOT_SCALE}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">`
    + `<rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="${BG}"/>`
    + body
    + '</svg>';
  return { svg, width: CANVAS_W * SNAPSHOT_SCALE, height: CANVAS_H * SNAPSHOT_SCALE };
}

/* ── 数学作图 ─────────────────────────────────────────────────────────────
   画板视野固定 20×16 个单位。取**等比**的 14px/单位（而不是 x 用 16、y 用 15）——
   后者会把直角画成非直角，而这道题考的就是直角。 */
const MATH_UNIT = 14;
const MX = (x) => 160 + x * MATH_UNIT;
const MY = (y) => 120 - y * MATH_UNIT;

function line(x1, y1, x2, y2, { color = INK, width = 2, dash = null, arrowEnd = false, arrowBoth = false } = {}) {
  const d = dash ? ` stroke-dasharray="${dash}"` : '';
  let out = `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"${d}/>`;
  if (arrowEnd || arrowBoth) out += arrowHead(x1, y1, x2, y2, color, width);
  if (arrowBoth) out += arrowHead(x2, y2, x1, y1, color, width);
  return out;
}

/** 箭头：在线段末端画一个实心三角（`size` 跟着线宽走，与本仓画板的手感一致）。 */
function arrowHead(x1, y1, x2, y2, color, width) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 7 + width;
  const spread = 0.42;
  const p = (a) => `${n(x2 - size * Math.cos(a))},${n(y2 - size * Math.sin(a))}`;
  return `<polygon points="${n(x2)},${n(y2)} ${p(angle - spread)} ${p(angle + spread)}" fill="${color}"/>`;
}

function text(x, y, value, { size = 10, color = ECHO, anchor = 'start', weight = 'normal' } = {}) {
  return `<text x="${n(x)}" y="${n(y)}" font-size="${size}" font-family="sans-serif" fill="${color}" text-anchor="${anchor}" font-weight="${weight}">${esc(value)}</text>`;
}

/** 一个数学元素 → SVG。认不出或字段不全时回空串（**不抛** —— 快照坏一格不该毁掉整批数据）。 */
function mathElement(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const kind = entry.kind;
  const pt = (p) => (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null);
  const seg = (a, b) => [pt(a), pt(b)];
  try {
    if (kind === 'point') {
      const p = pt(entry.p); if (!p) return '';
      return `<circle cx="${n(MX(p[0]))}" cy="${n(MY(p[1]))}" r="3" fill="${INK}"/>`;
    }
    if (kind === 'segment' || kind === 'line' || kind === 'arrow') {
      const [a, b] = seg(entry.a, entry.b); if (!a || !b) return '';
      let x1 = MX(a[0]); let y1 = MY(a[1]); let x2 = MX(b[0]); let y2 = MY(b[1]);
      if (kind === 'line') {
        // 直线延伸到画布外一圈（画板上的 `line` 是无限长的）。
        const dx = x2 - x1; const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const far = 1200;
        x1 -= (dx / len) * far; y1 -= (dy / len) * far;
        x2 += (dx / len) * far; y2 += (dy / len) * far;
        return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`;
      }
      return line(x1, y1, x2, y2, { arrowEnd: kind === 'arrow' });
    }
    if (kind === 'circle') {
      const c = pt(entry.center); const e = pt(entry.edge); if (!c || !e) return '';
      const r = Math.hypot(MX(e[0]) - MX(c[0]), MY(e[1]) - MY(c[1]));
      return `<circle cx="${n(MX(c[0]))}" cy="${n(MY(c[1]))}" r="${n(r)}" fill="none" stroke="${INK}" stroke-width="2"/>`;
    }
    if (kind === 'polyline') {
      const points = Array.isArray(entry.points) ? entry.points.map(pt) : [];
      if (points.length < 2 || points.some((p) => !p)) return '';
      const d = points.map((p) => `${n(MX(p[0]))},${n(MY(p[1]))}`).join(' ');
      return entry.closed
        ? `<polygon points="${d}" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
        : `<polyline points="${d}" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    if (kind === 'label') {
      const at = pt(entry.at); if (!at) return '';
      return text(MX(at[0]), MY(at[1]), entry.text ?? '', { size: 10, color: INK });
    }
    if (kind === 'angle') {
      const v = pt(entry.vertex); const a = pt(entry.a); const b = pt(entry.b);
      if (!v || !a || !b) return '';
      return line(MX(v[0]), MY(v[1]), MX(a[0]), MY(a[1]))
        + line(MX(v[0]), MY(v[1]), MX(b[0]), MY(b[1]));
    }
    /**
     * 四个几何记号 —— 🔴 **几何交给产品的纯函数算**（`worksheet-math-shapes.ts`），
     * 不在这里重推。画板渲染它们走的正是同三个函数（`math-drawing.tsx:401-431`）。
     */
    if (kind === 'rightAngle') {
      const square = rightAngleOf(entry.vertex, entry.a, entry.b);
      if (!square) return '';
      const d = square.map((p) => `${n(MX(p[0]))},${n(MY(p[1]))}`).join(' ');
      return `<polyline points="${d}" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
    }
    if (kind === 'parallelMark') {
      const bar = parallelMarkOf(entry.a, entry.b);
      if (!bar) return '';
      return line(MX(bar[0][0]), MY(bar[0][1]), MX(bar[1][0]), MY(bar[1][1]), { arrowBoth: true });
    }
    if (kind === 'equalMark') {
      const tick = equalMarkOf(entry.a, entry.b);
      if (!tick) return '';
      return line(MX(tick[0][0]), MY(tick[0][1]), MX(tick[1][0]), MY(tick[1][1]), { width: 3 });
    }
    if (kind === 'angleArc') {
      const v = pt(entry.vertex); const a = pt(entry.a); const b = pt(entry.b);
      if (!v || !a || !b) return '';
      return arcPath(v, a, b, 22) + (entry.text ? text(MX(v[0]), MY(v[1]) - 16, entry.text, { size: 10, color: INK, anchor: 'middle' }) : '');
    }
    if (kind === 'coordinateSystem') return coordinateSystem(entry.a, entry.b);
    if (kind === 'numberLine') return numberLine(entry.a, entry.b);
  } catch {
    return '';
  }
  return '';
}

/**
 * 坐标系：从 `a` 到 `b` 那一块矩形里铺网格 + 两条轴 + 轴上的刻度数字。
 * ⚠️ 数字**每个整数都标** —— 条形统计图那道题就是要从图上读高度，标稀了 AI 读不出来。
 */
function coordinateSystem(a, b) {
  const p = Array.isArray(a) && Array.isArray(b);
  if (!p) return '';
  const x0 = Math.min(a[0], b[0]); const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]); const y1 = Math.max(a[1], b[1]);
  let out = '';
  for (let x = Math.ceil(x0); x <= Math.floor(x1); x += 1) {
    out += line(MX(x), MY(y0), MX(x), MY(y1), { color: x === 0 ? AXIS : GRID, width: x === 0 ? 1.6 : 1 });
  }
  for (let y = Math.ceil(y0); y <= Math.floor(y1); y += 1) {
    out += line(MX(x0), MY(y), MX(x1), MY(y), { color: y === 0 ? AXIS : GRID, width: y === 0 ? 1.6 : 1 });
  }
  // 刻度数字：贴着轴走；轴不在视野里时就贴着那块矩形的边。
  const axisY = y0 <= 0 && y1 >= 0 ? 0 : y0;
  const axisX = x0 <= 0 && x1 >= 0 ? 0 : x0;
  for (let x = Math.ceil(x0); x <= Math.floor(x1); x += 1) {
    if (x === 0) continue;
    out += text(MX(x), MY(axisY) + 11, String(x), { size: 6.5, color: ECHO, anchor: 'middle' });
  }
  for (let y = Math.ceil(y0); y <= Math.floor(y1); y += 1) {
    if (y === 0) continue;
    out += text(MX(axisX) - 3, MY(y) + 2.5, String(y), { size: 6.5, color: ECHO, anchor: 'end' });
  }
  if (x0 <= 0 && x1 >= 0 && y0 <= 0 && y1 >= 0) out += text(MX(0) - 4, MY(0) + 11, 'O', { size: 7, color: ECHO, anchor: 'end' });
  return out;
}

function numberLine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return '';
  const y = a[1];
  const x0 = Math.min(a[0], b[0]); const x1 = Math.max(a[0], b[0]);
  let out = line(MX(x0), MY(y), MX(x1), MY(y), { color: INK, width: 1.8, arrowEnd: true });
  for (let x = Math.ceil(x0); x <= Math.floor(x1); x += 1) {
    out += line(MX(x), MY(y) - 4, MX(x), MY(y) + 4, { width: 1.4 });
    out += text(MX(x), MY(y) + 14, String(x), { size: 7, anchor: 'middle' });
  }
  return out;
}

/** 角弧：从 `vertex→a` 转到 `vertex→b` 的那段圆弧（半径固定，够看清就行）。 */
function arcPath(vertex, a, b, radius) {
  const vx = MX(vertex[0]); const vy = MY(vertex[1]);
  const a1 = Math.atan2(MY(a[1]) - vy, MX(a[0]) - vx);
  const a2 = Math.atan2(MY(b[1]) - vy, MX(b[0]) - vx);
  let sweep = a2 - a1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const p1 = [vx + radius * Math.cos(a1), vy + radius * Math.sin(a1)];
  const p2 = [vx + radius * Math.cos(a2), vy + radius * Math.sin(a2)];
  const large = Math.abs(sweep) > Math.PI ? 1 : 0;
  const dir = sweep > 0 ? 1 : 0;
  return `<path d="M ${n(p1[0])} ${n(p1[1])} A ${radius} ${radius} 0 ${large} ${dir} ${n(p2[0])} ${n(p2[1])}" fill="none" stroke="${INK}" stroke-width="2"/>`;
}

function mathSnapshot(data) {
  const elements = Array.isArray(data?.elements) ? data.elements : [];
  return frame(elements.map(mathElement).join(''));
}

/* ── 基础绘图（`free`）─────────────────────────────────────────────────────
   `data.paths` 是 `react-sketch-canvas` 的 `exportPaths()` 产物：
   `{ paths: [{x,y}...], strokeWidth, strokeColor, drawMode }`。
   ⚠️ `drawMode === true` 是**橡皮**。产品那边它是真的擦掉，这里只能近似成**画白线**——
   对测试数据够用（学生会用橡皮，但不会用它在整幅图上作画）。 */
function freeSnapshot(data) {
  const paths = Array.isArray(data?.paths) ? data.paths : [];
  const body = paths.map((item) => {
    if (!item || !Array.isArray(item.paths) || item.paths.length === 0) return '';
    const points = item.paths.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (points.length === 0) return '';
    const eraser = item.drawMode === true;
    const color = eraser ? BG : (typeof item.strokeColor === 'string' ? item.strokeColor : INK);
    const width = Number.isFinite(item.strokeWidth) ? item.strokeWidth : 2;
    if (points.length === 1) {
      return `<circle cx="${n(points[0].x)}" cy="${n(points[0].y)}" r="${n(width / 2)}" fill="${color}"/>`;
    }
    const d = points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');
    return `<polyline points="${d}" fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  return frame(body);
}

/* ── 思维导图 ─────────────────────────────────────────────────────────────
   自己排一份「左一半、右一半」的树。MindElixir 真正的布局比这讲究，但快照只要
   「AI 看得出有几个分支、每个分支写的什么」。

   ⚠️ `data.theme` **刻意不写进种子数据**：画板把主题放在 `new MindElixir({...})` 的
   **选项**里（`mindmap-drawing.tsx:124`），`init(data)` 时数据里没有 `theme` 就用选项那份。
   硬把一份主题塞进作答反而会让快照/画板跟着那份走（而它是从某条真实作答里抄来的死数据）。 */
const MM_FONT = 12;
const MM_NODE_H = 26;
const MM_GAP_Y = 10;
const MM_GAP_X = 34;
const MM_PAD_X = 9;

/** 盒子宽度：中日韩字符按一个字宽算，其余按 0.55 算。 */
function mmWidth(topic) {
  let w = 0;
  for (const ch of String(topic ?? '')) w += ch.codePointAt(0) > 0x2e80 ? MM_FONT : MM_FONT * 0.55;
  return Math.max(46, Math.round(w + MM_PAD_X * 2));
}

function mmHeight(node) {
  const kids = Array.isArray(node?.children) ? node.children : [];
  if (kids.length === 0) return MM_NODE_H;
  let sum = 0;
  kids.forEach((kid, i) => { sum += mmHeight(kid) + (i > 0 ? MM_GAP_Y : 0); });
  return Math.max(MM_NODE_H, sum);
}

function mindMapSnapshot(data) {
  const root = data?.nodeData;
  if (!root || typeof root !== 'object') return frame('');
  const boxes = [];
  const links = [];

  /** `side`：1 = 画在父节点右边，-1 = 左边。`anchorX` 是子节点**靠父节点那条边**的 x。 */
  function place(node, side, anchorX, top, depth) {
    const height = mmHeight(node);
    const width = mmWidth(node.topic);
    const cy = top + height / 2;
    const x = side === 1 ? anchorX : anchorX - width;
    boxes.push({ x, y: cy - MM_NODE_H / 2, w: width, h: MM_NODE_H, topic: node.topic, depth });
    const kids = Array.isArray(node.children) ? node.children : [];
    if (kids.length === 0) return;
    const total = kids.reduce((sum, kid, i) => sum + mmHeight(kid) + (i > 0 ? MM_GAP_Y : 0), 0);
    let childTop = top + (height - total) / 2;
    for (const kid of kids) {
      const kh = mmHeight(kid);
      const childWidth = mmWidth(kid.topic);
      /*
       * 🔴 `anchorX` 的约定是「**靠父节点那条边**的 x」（见本函数的签名注释）——
       * 递归时要传的就是它，不是盒子的左边缘。⊘ 2026-10-08 第一版传的是左边缘，
       * 于是每深一层就**多减一次自己的宽度**：连线端点与盒子对不上，
       * 表现为「曲线悬在半空、差一个盒子的宽度」（渲染出来看了一眼才发现）。
       */
      const childAnchorX = side === 1 ? x + width + MM_GAP_X : x - MM_GAP_X;
      const childY = childTop + kh / 2;
      links.push({
        from: [side === 1 ? x + width : x, cy],
        to: [childAnchorX, childY],
        depth: depth + 1,
      });
      place(kid, side, childAnchorX, childTop, depth + 1);
      childTop += kh + MM_GAP_Y;
    }
  }

  // 根：整棵树居中。左右两组各自垂直居中于根的中心线。
  const rootW = mmWidth(root.topic);
  const rootX = 160 - rootW / 2;
  const rootY = 120 - MM_NODE_H / 2;
  boxes.push({ x: rootX, y: rootY, w: rootW, h: MM_NODE_H, topic: root.topic, depth: 0 });

  const kids = Array.isArray(root.children) ? root.children : [];
  for (const side of [1, -1]) {
    const group = kids.filter((kid) => (Number(kid?.direction) === 0 ? -1 : 1) === side);
    if (group.length === 0) continue;
    const total = group.reduce((sum, kid, i) => sum + mmHeight(kid) + (i > 0 ? MM_GAP_Y : 0), 0);
    let top = 120 - total / 2;
    for (const kid of group) {
      const kh = mmHeight(kid);
      const kw = mmWidth(kid.topic);
      const anchorX = side === 1 ? rootX + rootW + MM_GAP_X : rootX - MM_GAP_X;
      const childX = side === 1 ? anchorX : anchorX - kw;
      links.push({
        from: [side === 1 ? rootX + rootW : rootX, 120],
        to: [side === 1 ? childX : childX + kw, top + kh / 2],
        depth: 1,
      });
      place(kid, side, anchorX, top, 1);
      top += kh + MM_GAP_Y;
    }
  }

  // 树可能比画布宽/高（分支多时）⇒ 整体缩一下，宁可小也别裁掉。
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const fit = Math.min(1, (CANVAS_W - 12) / Math.max(1, maxX - minX), (CANVAS_H - 12) / Math.max(1, maxY - minY));
  const shiftX = (CANVAS_W - (maxX - minX) * fit) / 2 - minX * fit;
  const shiftY = (CANVAS_H - (maxY - minY) * fit) / 2 - minY * fit;
  const T = (x, y) => [n(x * fit + shiftX), n(y * fit + shiftY)];

  const palette = ['#527198', '#6b86a5', '#7893b1', '#879db8', '#607d9e', '#7590ad'];
  let body = '';
  for (const link of links) {
    const [x1, y1] = T(...link.from); const [x2, y2] = T(...link.to);
    const mid = (x1 + x2) / 2;
    body += `<path d="M ${x1} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2}" fill="none" stroke="${palette[Math.min(link.depth, palette.length - 1)]}" stroke-width="${n(1.6 * fit)}"/>`;
  }
  for (const box of boxes) {
    const [x, y] = T(box.x, box.y);
    const w = n(box.w * fit); const h = n(box.h * fit);
    const isRoot = box.depth === 0;
    const fill = isRoot ? '#527198' : '#eef3f8';
    const stroke = isRoot ? 'none' : palette[Math.min(box.depth, palette.length - 1)];
    const color = isRoot ? '#ffffff' : '#27415f';
    body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${n((isRoot ? 12 : 10) * fit)}" fill="${fill}"${isRoot ? '' : ` stroke="${stroke}" stroke-width="${n(fit)}"`}/>`;
    body += `<text x="${n(x + w / 2)}" y="${n(y + h / 2 + 4 * fit)}" font-size="${n(MM_FONT * fit)}" font-family="sans-serif" fill="${color}" text-anchor="middle">${esc(box.topic ?? '')}</text>`;
  }
  return frame(body);
}

/* ── 分发 ─────────────────────────────────────────────────────────────── */

/**
 * `tool` + `data` → 快照 SVG；认不出的档回 `null`（`flowchart` 不在本文件 ——
 * 它已有纯函数真源 `worksheet-flowchart-svg.ts`，由调用方直接用它，别再抄一份）。
 */
export function drawingSnapshot(tool, data) {
  if (tool === 'math') return mathSnapshot(data);
  if (tool === 'free') return freeSnapshot(data);
  if (tool === 'mind-map') return mindMapSnapshot(data);
  return null;
}
