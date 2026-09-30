/**
 * 笔迹的**渲染层纯逻辑** —— `src/lib/worksheet-ink.ts` 的**镜像**（M6a）。
 *
 * 🔴 **本文件是镜像，不是共享。** 服务端读不到 `src/`，所以这里**必须**再写一份。
 * 改动规则只有一条：**改了 `src/lib/worksheet-ink.ts` 里对应的那一处，这里必须一起改。**
 * `src/lib/worksheet-ink-parity.test.ts` 会红 —— 它把同一批笔画喂给**两份**画线实现
 * （前端 `worksheet-ink.ts` 与**本文件**），`d` 串必须逐字相同；
 * ⚠️ 服务端早已有另一份 `worksheet-ink.ts`，但它**只做校验、没有 `strokePath`** ——
 * 那条用例比的是**常量与判据**（`INK_FORMATS` / `isInkFormat`，三处重复）。
 *
 * ⚠️ **本文件不许 import 任何东西**（连 `./worksheet-ink.js` 也不行）：
 * 对拍用例用 Node 的类型擦除**直接加载本文件**，而 Node **不会**把 `./x.js` 解析到 `./x.ts`
 * （实测：`ERR_MODULE_NOT_FOUND`）⇒ 一旦有 import，那条护栏就加载不起来。
 * 代价是 `INK_FORMATS` / `isInkFormat` 在本仓现在有**三份**（前端、服务端 `worksheet-ink.ts`、
 * 本文件）—— 对拍用例把三份都比一遍，漂了会红。
 *
 * ⚠️ 本文件**只做两件事**：把已归一化的笔画画成 SVG 的 `d`，以及把 Json 列里的值读成 `InkValue`。
 * 它**不碰 `sharp`**（那是 `ink-render.ts` 的事）—— 否则对拍用例会解析不到那个原生依赖。
 *
 * ── 下面每一段都**逐字**来自 `src/lib/worksheet-ink.ts`（含注释）。不要"顺手改顺"。
 */

/** 笔迹颜色与粗细。裁定 2：M4b **不做**颜色 / 粗细的选择，所以它们是常量。 */
export const INK_STROKE_COLOR = '#1f2937';
/** ⚠️ **归一化**宽度（基准是 `min(canvas.w, canvas.h)`，不是像素）—— 见 `InkStroke` 的单位规则。 */
export const INK_STROKE_WIDTH = 0.016;

export const INK_FORMATS = ['ink/v1', 'drawing/v1'] as const;
export type InkFormat = (typeof INK_FORMATS)[number];

/**
 * 一个采样点：`[x, y]`，**两个数都归一化到 0..1**。
 *
 * ⚠️ 用元组不用对象不是口味：上限是 2000 个点，而 `{x, y}` 每点**固定**比 `[x, y]` 多 8 字节
 * （`"x":` / `"y":` 各 4 字节，`{}` 与 `[]` 相抵）。⇒ 这个值要过 HTTP、要进 `localStorage`
 * 离线队列、还会整份发给教师端，所以每点省下的这 8 字节不是小事。
 */
export type InkPoint = [number, number];

/**
 * 一笔。
 *
 * 🔴 **这个对象里的每一个数都与像素无关**（唯一一条单位规则，别在别处再立一条）：
 *   · `points` 的 x / y 归一化到 **0..1**，基准是 `canvas.w × canvas.h`；
 *   · `width` 归一化到 **`min(canvas.w, canvas.h)`**；
 *   · `canvas.w` / `canvas.h` 是**学生作答那一刻画布框的实测 CSS 像素**。
 * ⇒ 渲染时用 `toPixel()` / `strokeWidthPx()`，别在两处各写一遍 `x * canvas.w`。
 */
/**
 * ★ 2026-09-30（教师）：「绘图区支持基本图形工具」。
 *
 * 🔴 **顺序就是工具栏上的顺序**，而两条用例（`worksheet-ink.test.ts`）把它逐条钉住 ——
 *    加一个形状要同时改这里、`shapeOutline`、以及**两个渲染器**（spec 的「爆炸半径」九处）。
 * ⚠️ `angle` 是唯一一个**不在外接框里**的形状：它由三个自由点定义（顶点 + 两条边的端点）——
 *    一个永远 90° 的「角」在几何课上没用。
 */
export const INK_SHAPE_KINDS = [
  'line', 'arrow', 'rect', 'ellipse', 'triangle',
  'right-triangle', 'parallelogram', 'trapezoid', 'angle',
] as const;
export type InkShapeKind = (typeof INK_SHAPE_KINDS)[number];

/** 这个值是九个形状之一吗。**认不出的一律当「不是」**（读值那一侧据此丢整笔）。 */
export function isInkShapeKind(raw: unknown): raw is InkShapeKind {
  return typeof raw === 'string' && (INK_SHAPE_KINDS as readonly string[]).includes(raw);
}

/**
 * 一条**折线**（★ 2026-09-30：形状的统一形态）。
 *
 * 🔴 为什么把椭圆与弧也做成折线：形状要在**两个渲染器**里画出来（学生端 Canvas、
 *    教师端 SVG），而它们的曲线能力是两套 API（`ctx.ellipse` / SVG 的 `A` 命令）。
 *    让判据层只产出折线 ⇒ 两边都只需要 `moveTo`/`lineTo` ⇒ **画法在结构上不可能分叉**
 *    （本仓最防的就是「学生画的和教师看到的不一样」）。顺带也少引一个本机核不了的 API。
 * ⚠️ 代价：椭圆是 32 段折线（视觉上无差别）、`d` 串略长。这是**知情的选择**。
 */
export interface ShapeOutline { closed: boolean; points: InkPoint[] }
/**
 * 画布上的**档**（★ 2026-09-30）：手写 / 九个图形 / 选择。
 *
 * 🔴 **顺序就是工具栏上的顺序**，而且**默认档恒是手写**（`INK_DEFAULT_TOOL`）——
 *    老习惯的学生进题目要能**直接画**；默认成别的档他会以为画布坏了。
 * ⚠️ `select` 不是一个形状：它是「选中并移动已有的图形」那一档（教师选的「甲」）。
 */
export const INK_TOOL_PEN = 'pen';
export const INK_TOOL_SELECT = 'select';
export const INK_TOOLS = [INK_TOOL_PEN, ...INK_SHAPE_KINDS, INK_TOOL_SELECT] as const;
export type InkTool = (typeof INK_TOOLS)[number];
/** 默认档：**手写**。见上面那条 🔴。 */
export const INK_DEFAULT_TOOL: InkTool = INK_TOOL_PEN;
/** 这一档是不是「画某个图形」（`pen` / `select` 都不是）。 */
export function isInkShapeTool(tool: string): tool is InkShapeKind {
  return isInkShapeKind(tool);
}
/**
 * 笔的粗细：**三档**（★ 2026-09-30 教师：「笔的粗细」+「要能选」）。
 *
 * 🔴 **中间那一档就是原来的默认值**（`INK_STROKE_WIDTH`）—— 加选项**不改默认手感**，
 *    否则「以前画的」与「现在画的」会不一样粗，而那在屏幕上只是「今天这笔怎么变粗了」。
 * ⚠️ 单位与 `InkStroke.width` 同一条规则：**归一化到 `min(画布宽, 画布高)`**，
 *    所以同一档在不同尺寸的画布上看起来一样粗（A1 的 `strokeWidthPx` 负责换算）。
 * ⚠️ 下限那一档不能太细：老 iPad 上 0.4px 的线画不出来（`strokeWidthPx` 里有 1px 的兜底）。
 */
/**
 * 画笔与文字的**八色固定色板**（★ 2026-09-30 教师：「还缺少颜色工具」+「八色固定色板」）。
 *
 * 🔴 **第一个就是 `INK_STROKE_COLOR`** ⇒ 默认色 = 改动前的那个常量，**加颜色不改默认观感**。
 * ⚠️ 值必须是**十六进制**：`server/src/services/ink-render.ts` 的 `safeColor` 只认
 *    `#rgb` / `#rrggbb`，别的写法会被那张图回落成常量色，而**屏幕上看着是好的**。
 * ⚠️ 八色都要在白底上读得清（「黄」取的是偏深的 `#ca8a04`，纯黄在白纸上几乎看不见）。
 */
export const INK_PALETTE = [
  { value: INK_STROKE_COLOR, label: '黑' },
  { value: '#6b7280', label: '灰' },
  { value: '#dc2626', label: '红' },
  { value: '#ea580c', label: '橙' },
  { value: '#ca8a04', label: '黄' },
  { value: '#16a34a', label: '绿' },
  { value: '#2563eb', label: '蓝' },
  { value: '#7c3aed', label: '紫' },
] as const;
/** 默认色 = 笔迹常量（颜色是**每个元素各自**的字段，所以这只是「新元素用哪个」）。 */
export const INK_DEFAULT_COLOR = INK_STROKE_COLOR;
/** 这一串是不是十六进制颜色（与编辑器那一侧 `safeColor` 同一把尺子）。 */
export function isInkColor(raw: unknown): raw is string {
  return typeof raw === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw);
}

export const INK_WIDTH_OPTIONS = [0.009, INK_STROKE_WIDTH, 0.028] as const;
export type InkWidth = (typeof INK_WIDTH_OPTIONS)[number];
/** 默认档 = 中间那一档。 */
export const INK_DEFAULT_WIDTH: InkWidth = INK_STROKE_WIDTH;
/** 这一档是不是三档之一（读值那一侧据此决定要不要回落）。 */
export function isInkWidth(raw: unknown): raw is InkWidth {
  return typeof raw === 'number' && (INK_WIDTH_OPTIONS as readonly number[]).includes(raw);
}



export interface InkStroke {
  color: string;
  width: number;
  points: InkPoint[];
  /**
   * ★ 2026-09-30：九个基本图形之一。**缺省 = 手写笔迹** ⇒ 库里所有老值一个字节不用动，
   * 也不需要迁移（本项目从没有一条迁移碰过 `WorksheetAnswer.value`）。
   * 🔴 有 `shape` 时，`points` 是**定义几何**（框 = 2 点、角 = 3 点），不是画出来的点。
   */
  shape?: InkShapeKind;
}

/** 作答那一刻画布框的**实测 CSS 像素**。`{ w: 0, h: 0 }` = 读不出来（见 `readInkValue`）。 */
export interface InkCanvas { w: number; h: number }

/** 一份笔迹作答值：落在 `WorksheetAnswer.value` 那个 Json 列里（Global Constraint 18）。 */
export interface InkValue { format: InkFormat; canvas: InkCanvas; strokes: InkStroke[] }

/** 这个 `format` 串是不是笔迹（`ink/v1` / `drawing/v1`）。服务端 B1 有一份同名的对应实现。 */
export function isInkFormat(raw: unknown): raw is InkFormat {
  return typeof raw === 'string' && (INK_FORMATS as readonly string[]).includes(raw);
}

/** 夹到 0..1。`readPoint` 与 `normalizeAxis` 共用这一处（两处各写一份会漂）。 */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 归一化 → 像素。★ **学生端 canvas 与教师端 SVG 都只走这一个函数。**
 *
 * 🔴 各写一份的后果是**两边画出来的形状不一样**（基准不同 / 少乘一个 `canvas.h`），
 * 而两处都「看起来正常」：学生在自己的 iPad 上看到的是他对的那一份，
 * 教师在抽屉里看到的是错的那一份，**没有任何报错、没有一条用例会红**。
 */
export function toPixel(point: InkPoint, box: InkCanvas): InkPoint {
  return [point[0] * box.w, point[1] * box.h];
}

/** 一笔在 `box` 坐标系里的线宽（= `width * min(w, h)`，下限 1：老 iPad 上一个 0.4px 的线画不出来）。 */
export function strokeWidthPx(stroke: InkStroke, box: InkCanvas): number {
  const base = Math.min(box.w, box.h);
  const width = stroke.width * base;
  return width > 1 ? width : 1;
}

/** 保留两位小数（`d` 串里不该出现 17 位小数）。它是**内部**函数，不导出。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * SVG 的 `d`。
 *
 * 🔴 **单点笔画必须画出一个点**：学生在屏幕上点一下就是一个只有 1 个点的笔画，
 * 而 `M x y` 后面什么都不接的路径在 Safari 上**不渲染任何东西**（round linecap 对
 * 零长度子路径的处理各家不同）⇒ 用一个极短的线段代替（`l0.01 0`）。
 * 「点了一下没反应」正是那种没人会报的缺陷。
 * ⚠️ 空数组回空串（不是 `'M0 0'`）：没有点的笔画不该在画布上留下一笔。
 */
/** 一条折线 → SVG 的 `d`。★ 手写与图形**共用这一个**（图形的折线也走它）。 */
function polylinePath(points: readonly InkPoint[], box: InkCanvas, closed: boolean): string {
  if (points.length === 0) return '';
  const parts: string[] = [];
  points.forEach((point, index) => {
    const [x, y] = toPixel(point, box);
    parts.push(`${index === 0 ? 'M' : 'L'}${round2(x)} ${round2(y)}`);
  });
  if (points.length === 1) parts.push('l0.01 0');
  // ⚠️ 少于 3 个点的「闭合」是画不出闭合的（两条边重合成一条），别硬加一个 Z。
  if (closed && points.length >= 3) parts.push('Z');
  return parts.join(' ');
}

/**
 * 一笔 → SVG 的 `d`。
 *
 * ★ 2026-09-30：第三个参数是**可选的形状**。**不传 = 手写**，那条路与今天逐字相同
 * （四个渲染点、以及服务端镜像都在跑它）—— 有一条用例专门钉这一点。
 * ⚠️ 形状认得、但几何不够（点数不足）时**回落到手写那条路**：画出定义点，
 *    比画出一片空白好（空白会被当成「学生没画」）。
 */
export function strokePath(points: readonly InkPoint[], box: InkCanvas, shape?: unknown): string {
  if (isInkShapeKind(shape)) {
    const outlines = shapeOutline({ shape, points }, box);
    if (outlines.length > 0) {
      return outlines.map((outline) => polylinePath(outline.points, box, outline.closed)).join(' ');
    }
  }
  return polylinePath(points, box, false);
}

/** 点到线段的距离（像素）。命中测试与折线共用。 */
function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  // 把点投影到线段上，参数夹到 [0,1]（**夹取**是「线段」与「直线」的区别）。
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 折线的最近距离。`closed` 时还要量最后一段「尾 → 首」。 */
function distanceToPolyline(px: number, py: number, points: readonly InkPoint[], closed: boolean): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(px - points[0][0], py - points[0][1]);
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const d = distanceToSegment(px, py, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    if (d < best) best = d;
  }
  if (closed && points.length >= 3) {
    const last = points[points.length - 1];
    const d = distanceToSegment(px, py, last[0], last[1], points[0][0], points[0][1]);
    if (d < best) best = d;
  }
  return best;
}

/** 射线法：点在多边形内部吗（像素坐标）。 */
function pointInPolygon(px: number, py: number, points: readonly InkPoint[]): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    // 「这一条边跨过了 y」且交点在点的右边 ⇒ 翻一次。
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 这个点**点得中**这一笔吗（★ 2026-09-30，「选择」档用它挑图形）。
 *
 * 🔴 **手写笔迹一律不命中。** 学生的手指在画布上点一下，十有八九是想继续画；
 *    如果手写也算命中，他一点就选中了自己刚画的那条线 —— 而屏幕上只是「多了一圈虚线」。
 * 🔴 **闭合图形内部也算命中**（否则一个矩形要点它的边框才选得中，手指根本点不准）。
 *    线状（直线 / 箭头 / 角）**只有轮廓附近**算 —— 它们本来就没有内部。
 * ⚠️ `tolPx` 是**像素**宽容度：手指比线粗得多，不给宽容度就点不中。
 */
export function hitTestStroke(point: InkPoint, stroke: InkStroke, box: InkCanvas, tolPx: number): boolean {
  // ⚠️ 「手写笔迹一律不命中」这条规则的**守卫在 `shapeOutline` 里**（它对手写与坏值返回空数组），
  //    这里**不重复一遍** —— 变异检验实测：把这里那句 `if (!isInkShapeKind(...)) return false`
  //    删掉，**行为一个字不变**（那是句冗余代码）。重复的守卫会让下一个人以为
  //    「手写不命中」是靠这一句保证的，从而在改 `shapeOutline` 时放心地把它漏掉。
  const outlines = shapeOutline(stroke, box);
  if (outlines.length === 0) return false;
  const [px, py] = toPixel(point, box);
  const tol = Number.isFinite(tolPx) && tolPx > 0 ? tolPx : 0;
  for (const outline of outlines) {
    const pixels = outline.points.map((p) => toPixel(p, box));
    if (outline.closed && pointInPolygon(px, py, pixels)) return true;
    if (distanceToPolyline(px, py, pixels, outline.closed) <= tol) return true;
  }
  return false;
}

/**
 * 这一笔的**把手**（控制点）在哪儿（★ 2026-09-30，「选择」档据此画控制点、并判断拖的是哪一个）。
 *
 * - 两点框图形（矩形/椭圆/三角形/…）⇒ **4 个角**；
 * - 直线 / 箭头 ⇒ **2 个端点**；
 * - 角 ⇒ **3 个顶点**（它是唯一一个不在外接框里的形状）；
 * - 手写 ⇒ **空**（它不参与选中）。
 * ⚠️ 4 个角而不是 8 个：手指比控制点粗，8 个会互相压住（真机走查项）。
 */
export function strokeHandles(stroke: InkStroke, box: InkCanvas): InkPoint[] {
  if (!isInkShapeKind(stroke.shape)) return [];
  const points = stroke.points;
  if (stroke.shape === 'angle') return points.slice(0, 3);
  if (stroke.shape === 'line' || stroke.shape === 'arrow') return points.slice(0, 2);
  if (points.length < 2) return [];
  const [ax, ay] = points[0];
  const [bx, by] = points[1];
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/**
 * 点在这个图形的**哪个控制点**上？（`-1` = 没有）
 *
 * 🔴 它必须**独立于 `hitTestStroke`** —— 这是 2026-09-30 复审抓出来的一个**真缺陷**：
 *    选择档原来是「先用 `hitTestStroke` 找到图形、再在它身上找控制点」，而
 *    `hitTestStroke` 量的是**轮廓**距离 ⇒ 椭圆 / 三角形 / 梯形 / 平行四边形 / 直角三角形的
 *    控制点（**外接框的角**）落在轮廓外面很远（实测椭圆 ≈30px、三角形 ≈75px）
 *    ⇒ 学生按下那个**画出来的白点**时，所有笔迹都不命中 ⇒ `onSelect(null)` ⇒
 *    **选中被丢掉、什么都没拖起来**。屏幕上只是「控制点画在那儿，一按就没了」。
 * ⇒ 所以控制点判定要在轮廓命中**之前**、针对**已选中的那一笔**先跑一次。
 */
/**
 * 这个图形**太小、不成形**吗（松手时丢掉）。
 *
 * ★ 2026-09-30（复审）：这条规则原来散在组件里，而且**三份说法互相打架** ——
 *   spec 说「任一边 < 8px 就丢」、组件代码写的是「两边都小才丢」、组件注释又写回 spec 那一版。
 *   落到判据层之后只剩一份说法，而且**可测**。
 *
 * 三档不同的判据（各按各自的几何意义，不搞一刀切）：
 *   · `line` / `arrow` —— 两个定义点**不重合**就算成形。一条 200×2 的水平直线是**合法**的
 *     （它本来就是一条线，没有「宽高」可言）。
 *   · `angle` —— 两条边**都要有长度**。⚠️ 拿外接框量它是错的：一条竖直的边会让宽 = 0，
 *     「任一边太小就丢」会把一个完全正常的角判掉。
 *   · 其余（外接框图形）—— **任一边** < `minPx` 就丢（3×3 的手抖、200×2 的薄片都不要）。
 *
 * ⚠️ 单位：`minPx` 是**像素**（学生的手指抖不抖是按屏幕量的），所以这里要 `box`。
 */
export function isShapeTooSmall(stroke: InkStroke, box: InkCanvas, minPx: number): boolean {
  if (!isInkShapeKind(stroke.shape)) return false;          // 手写不走这条判据
  const points = stroke.points;
  const limit = Number.isFinite(minPx) && minPx > 0 ? minPx : 0;
  /** 两个定义点的**像素**距离。 */
  const spanPx = (a: InkPoint, b: InkPoint) => Math.hypot((b[0] - a[0]) * box.w, (b[1] - a[1]) * box.h);
  if (stroke.shape === 'line' || stroke.shape === 'arrow') {
    return points.length < 2 || spanPx(points[0], points[1]) < limit;
  }
  if (stroke.shape === 'angle') {
    if (points.length < 3) return true;
    return spanPx(points[0], points[1]) < limit || spanPx(points[0], points[2]) < limit;
  }
  if (points.length < 2) return true;
  const widthPx = Math.abs(points[1][0] - points[0][0]) * box.w;
  const heightPx = Math.abs(points[1][1] - points[0][1]) * box.h;
  // 🔴 **任一边**太小就丢（不是「两边都小才丢」—— 那会放进来 200×2 的薄片）。
  return widthPx < limit || heightPx < limit;
}

export function pickInkHandle(point: InkPoint, stroke: InkStroke, box: InkCanvas, tolPx: number): number {
  const handles = strokeHandles(stroke, box);
  const [px, py] = toPixel(point, box);
  const tol = Number.isFinite(tolPx) && tolPx > 0 ? tolPx : 0;
  for (let index = 0; index < handles.length; index += 1) {
    const [hx, hy] = toPixel(handles[index], box);
    if (Math.hypot(px - hx, py - hy) <= tol) return index;
  }
  return -1;
}

/**
 * 点中了**哪一笔**图形？（`-1` = 空白）从**后往前**找：后画的在上，重叠处该选中看得见的那一个。
 * ⚠️ 手写一律不命中（判据在 `shapeOutline` 返回空数组那一层）。
 */
export function pickInkStroke(
  point: InkPoint, strokes: readonly InkStroke[], box: InkCanvas, tolPx: number,
): number {
  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    if (hitTestStroke(point, strokes[index], box, tolPx)) return index;
  }
  return -1;
}

/**
 * 读一个点：只收**两个都是有限数的二元数组**，并把两个数**夹到 0..1**
 * （手改过的行可能写着 `x: 7`）。其余一律 `null` —— 那个点丢掉。
 */
function readPoint(raw: unknown): InkPoint | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const x = raw[0];
  const y = raw[1];
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [clamp01(x), clamp01(y)];
}

/**
 * 读一笔。
 *
 * 🔴 **几何是必需的，样式不是**：`points` 读不出来（不是数组 / 一个点都不剩）⇒ 整笔丢掉；
 * 而 `color` / `width` 读不出来时**回落本文件的常量**。理由是裁定 2 —— M4b 只有一种颜色
 * 一种粗细，所以一个坏样式里没有信息可丢（回落出来的就是它本该是的那一个值），
 * 而为一个坏样式丢掉几何就是**学生画的一条线从屏幕上消失**。
 *
 * ⚠️ 点的处理是**逐点**的：`points` 里混进一个 `['a','b']` 只丢那一个点，其余照留。
 */
function readStroke(raw: unknown): InkStroke | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.points)) return null;
  const points: InkPoint[] = [];
  row.points.forEach((item) => {
    const point = readPoint(item);
    if (point) points.push(point);
  });
if (points.length === 0) return null;
  const color = row.color;
  const width = row.width;
  const shape = row.shape;
  // ★ 2026-09-30：`shape` **缺省 = 手写**（库里所有老值都是这样）⇒ 老数据一个字节不用动。
  // 🔴 但**写了却不认识**（拼错、或者是别的版本写的）⇒ **整笔丢掉**，不是静默当手写。
  //    静默当手写是最坏的一种：学生画了个矩形、教师看到一条怪手写线，两边都不报错。
  //    丢掉整笔与「坏点丢整笔」（上面那条）是同一条纪律 —— 一致的代价。
  if (shape !== undefined && !isInkShapeKind(shape)) return null;
  const stroke: InkStroke = {
    color: typeof color === 'string' && color ? color : INK_STROKE_COLOR,
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : INK_STROKE_WIDTH,
    points,
  };
  if (isInkShapeKind(shape)) stroke.shape = shape;
  return stroke;
}

/**
 * 读作答那一刻的框。
 *
 * 🔴 **`w` / `h` 都必须读出来**，否则整块回落 `{ w: 0, h: 0 }`（不是逐字段回落）：
 * 逐字段会产出 `{ w: 0, h: 240 }` 这种框，而 `toPixel` 会把它下面的**每一个点都压到 x = 0**，
 * 画出来是一条贴在左边的竖线 —— 看起来像「学生画了一条线」，其实是读出来的半个框。
 * ⚠️ 零 / 负数 / `NaN` 一律当成读不出来。
 */
function readCanvas(raw: unknown): InkCanvas {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { w: 0, h: 0 };
  const row = raw as Record<string, unknown>;
  const w = row.w;
  const h = row.h;
  if (typeof w !== 'number' || typeof h !== 'number') return { w: 0, h: 0 };
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { w: 0, h: 0 };
  return { w, h };
}

/**
 * 读一份笔迹值。**容错到底**（值可能来自手改过的行 / 上一个版本），坏形状回 `null`。
 *
 * 🔴 判据的粒度是**逐笔画**的：一条笔画坏掉只丢那一条（屏幕上少一条线），
 * 整份不是数组才回 `null`。反过来（一条坏笔画作废整幅画）会让**学生画的所有东西消失**。
 *
 * ⚠️ 数量**不在这里截断**：这里是读的一侧，截断会让「库里有什么」与「屏幕上画什么」
 * 变成两件事。上限只在写入口（服务端的 400）。
 */
export function readInkValue(raw: unknown): InkValue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (!isInkFormat(row.format)) return null;
  if (!Array.isArray(row.strokes)) return null;
  const strokes: InkStroke[] = [];
  row.strokes.forEach((item) => {
    const stroke = readStroke(item);
    if (stroke) strokes.push(stroke);
  });
  return { format: row.format, canvas: readCanvas(row.canvas), strokes };
}

/* ══ ★ 2026-09-30：基本图形的几何 ═══════════════════════════════════════════
   规格：`specs/2026-09-30-绘图区-基本图形工具.md`

   🔴 **一切在像素空间里算，算完再转回归一化。** 归一化空间是**各向异性**的
      （x 乘画布宽、y 乘画布高，两者不等）—— 在那儿算角度、翼长、圆，宽高比一变
      形状就是歪的，而屏幕上只是「看着怪」，没有任何报错。
      `worksheet-ink.test.ts` 里有一条专门拿 400×50 与 100×100 两种画布对拍翼长。
   🔴 归一化的输出**统一四舍五入到 6 位**：不四舍五入的话 `0.1 * 200 / 200` 是
      `0.10000000000000002`，而屏幕上完全看不出差别 —— 那条 `deepEqual` 的用例会红得莫名其妙。
*/

/** 四舍五入到 6 位小数（理由见上面那段）。 */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** 像素点 → 归一化点。**不夹取**（夹取会把椭圆的边缘压平）。 */
function toNormPoint(px: number, py: number, box: InkCanvas): InkPoint {
  return [round6(box.w > 0 ? px / box.w : 0), round6(box.h > 0 ? py / box.h : 0)];
}

/** 折线的像素形式（内部用；出去之前一律转回归一化）。 */
type PixelOutline = { closed: boolean; points: InkPoint[] };

/**
 * 一个形状的**折线**。手写（没有 `shape`）或坏值 ⇒ **空数组**（渲染层据此走老路）。
 *
 * 🔴 **`[]` 这一个返回值同时承载两条产品规则**，所以它不只是「防御」：
 *    · 渲染层据此走**手写那条老路**（一个像素都不变）；
 *    · `hitTestStroke` 据此让**手写笔迹永远选不中**（学生点一下十有八九是想接着画）。
 *    ⇒ 改这个返回值之前先看 `hitTestStroke` 的注释。
 *
 * ⚠️ 返回值是**数组**：箭头 = 杆 + 头部；角 = 两条射线 + 弧。其余形状都是 1 条。
 */
export function shapeOutline(
  stroke: { shape?: unknown; points: readonly InkPoint[] },
  box: InkCanvas,
): ShapeOutline[] {
  if (!isInkShapeKind(stroke.shape)) return [];
  const points = stroke.points;
  if (!Array.isArray(points) || points.length < 2) return [];

  const px = (p: InkPoint): InkPoint => [p[0] * box.w, p[1] * box.h];
  const out = (parts: PixelOutline[]): ShapeOutline[] => parts.map((part) => ({
    closed: part.closed,
    points: part.points.map((p) => toNormPoint(p[0], p[1], box)),
  }));

  // ── 线与箭头：**保持拖拽方向**（尖端在终点那一头），绝不排序。
  if (stroke.shape === 'line' || stroke.shape === 'arrow') {
    const a = px(points[0]);
    const b = px(points[1]);
    const parts: PixelOutline[] = [{ closed: false, points: [a, b] }];
    if (stroke.shape === 'arrow') {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        // ⚠️ 翼长在**像素**里定（上限 12px），并夹取到不超过杆长的三分之一 ——
        //    短杆上挂一个 12px 的大箭头，看起来像一个糊掉的三角形。
        const wing = Math.min(len * 0.3, 12);
        const back = Math.atan2(-dy, -dx);
        const spread = (25 * Math.PI) / 180;
        parts.push({
          closed: false,
          points: [
            [b[0] + Math.cos(back + spread) * wing, b[1] + Math.sin(back + spread) * wing],
            b,
            [b[0] + Math.cos(back - spread) * wing, b[1] + Math.sin(back - spread) * wing],
          ],
        });
      }
    }
    return out(parts);
  }

  // ── 角：三个自由点（顶点 · 边一端点 · 边二端点），不走外接框。
  if (stroke.shape === 'angle') {
    if (points.length < 3) return [];
    const v = px(points[0]);
    const a = px(points[1]);
    const b = px(points[2]);
    const parts: PixelOutline[] = [
      { closed: false, points: [a, v] },
      { closed: false, points: [v, b] },
    ];
    // 弧：半径取两条边较短者的 1/4（像素），**沿较短的那一侧**扫 —— 否则钝角会画成优角。
    const r = Math.min(Math.hypot(a[0] - v[0], a[1] - v[1]), Math.hypot(b[0] - v[0], b[1] - v[1])) / 4;
    if (r > 0) {
      const t0 = Math.atan2(a[1] - v[1], a[0] - v[0]);
      const t1 = Math.atan2(b[1] - v[1], b[0] - v[0]);
      let delta = t1 - t0;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const arc: InkPoint[] = [];
      for (let i = 0; i <= 16; i += 1) {
        const t = t0 + (delta * i) / 16;
        arc.push([v[0] + Math.cos(t) * r, v[1] + Math.sin(t) * r]);
      }
      parts.push({ closed: false, points: arc });
    }
    return out(parts);
  }

  // ── 其余八个：由**外接框**推出。⚠️ 学生可能从任意方向拖 ⇒ 先排序对角。
  const x0 = Math.min(points[0][0], points[1][0]) * box.w;
  const x1 = Math.max(points[0][0], points[1][0]) * box.w;
  const y0 = Math.min(points[0][1], points[1][1]) * box.h;
  const y1 = Math.max(points[0][1], points[1][1]) * box.h;
  const w = x1 - x0;
  const h = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const parts: PixelOutline[] = [];

  if (stroke.shape === 'rect') {
    parts.push({ closed: true, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  } else if (stroke.shape === 'ellipse') {
    const ring: InkPoint[] = [];
    for (let i = 0; i < 32; i += 1) {
      const t = (i / 32) * Math.PI * 2;
      ring.push([cx + Math.cos(t) * (w / 2), cy + Math.sin(t) * (h / 2)]);
    }
    parts.push({ closed: true, points: ring });
  } else if (stroke.shape === 'triangle') {
    parts.push({ closed: true, points: [[cx, y0], [x1, y1], [x0, y1]] });
  } else if (stroke.shape === 'right-triangle') {
    parts.push({ closed: true, points: [[x0, y0], [x0, y1], [x1, y1]] });
    // 直角小方块（一个「L」形折线，画在左下角那个直角上）。
    // ⊘ 2026-09-30（复审）：这里原来写着 `Math.min(Math.min(w, h) / 6, Math.min(w, h) / 3)`
    //    并注释「边长夹取到不超过框的三分之一」—— 而 `min(x/6, x/3)` **恒等于** `x/6`
    //    （x ≥ 0），那个「夹取」是个**恒等式**，它描述的分支永远到不了。
    //    删掉它，只留真正生效的那一条（短边的六分之一）。
    const side = Math.min(w, h) / 6;
    if (side > 0) parts.push({ closed: false, points: [[x0, y1 - side], [x0 + side, y1 - side], [x0 + side, y1]] });
  } else if (stroke.shape === 'parallelogram') {
    parts.push({ closed: true, points: [[x0 + w / 4, y0], [x1, y0], [x1 - w / 4, y1], [x0, y1]] });
  } else if (stroke.shape === 'trapezoid') {
    parts.push({ closed: true, points: [[x0 + w / 4, y0], [x1 - w / 4, y0], [x1, y1], [x0, y1]] });
  }
  return out(parts);
}

/* ══ ★ 2026-09-30：编辑一个形状（移动 / 改大小）═══════════════════════════
   🔴 这两个都是**纯几何**：它们对**手写也能算**（`moveStroke` 尤其）。别在这里加一道
      「只许图形」的闸 —— 那会让这两个函数突然与「选中」扯上关系，而选中是交互层的事
      （手写不能被选中，判据在 `hitTestStroke` / `shapeOutline`）。
*/

/** 把 `delta` 夹到 `[low, high]`（`low > high` 时返回 `low`）。 */
function clampDelta(delta: number, low: number, high: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (low > high) return low;
  if (delta < low) return low;
  if (delta > high) return high;
  return delta;
}

/**
 * 整体平移一笔。**夹取按「包围盒」**，不是逐点。
 *
 * 🔴 逐点夹取会把形状**压扁**：矩形拖到左边界时，左边两个点停住、右边两个继续走
 *    ⇒ 它越来越窄，最后成一条线。而屏幕上只是「矩形变形了」，没有任何报错。
 *    按包围盒夹 ⇒ 只要有一个方向到头，整个形状就停住，形状永远不变形。
 */
export function moveStroke(stroke: InkStroke, dx: number, dy: number): InkStroke {
  const points = stroke.points;
  if (!Array.isArray(points) || points.length === 0) return stroke;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    if (point[0] < minX) minX = point[0];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[1] > maxY) maxY = point[1];
  }
  const moveX = clampDelta(dx, -minX, 1 - maxX);
  const moveY = clampDelta(dy, -minY, 1 - maxY);
  if (moveX === 0 && moveY === 0) return stroke;
  return {
    ...stroke,
    points: points.map((point): InkPoint => [round6(point[0] + moveX), round6(point[1] + moveY)]),
  };
}

/**
 * 把一个把手拖到新位置（★ 「选择」档拖控制点）。
 *
 * - 外接框图形：把手 0/1/2/3 = 左上 / 右上 / 右下 / 左下，拖完**按包围盒重算两个对角**
 *   ⇒ 拖过头穿过对角也只是框翻了个方向，**不会出现负宽**。
 * - `line` / `arrow`：把手 0/1 = 两个端点。
 * - `angle`：把手 0/1/2 = 三个顶点。
 * - 手写、越界的把手序号、点数不足 ⇒ **原样返回**（坏输入不许造出一个框外的图形）。
 *
 * ⚠️ `box` 现在没用到，但**签名里留着**：形状的几何在像素空间里算（见 `shapeOutline`），
 *    而「拖一个角」将来若要支持等比缩放就需要它。留着的代价是一个参数，改签名的代价是
 *    四个调用点 + 服务端镜像。
 */
export function resizeStroke(
  stroke: InkStroke,
  handleIndex: number,
  point: InkPoint,
  box: InkCanvas,
): InkStroke {
  void box;
  if (!isInkShapeKind(stroke.shape)) return stroke;
  if (!Number.isInteger(handleIndex) || handleIndex < 0) return stroke;
  if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return stroke;
  const points = stroke.points;
  const nx = round6(clamp01(point[0]));
  const ny = round6(clamp01(point[1]));

  if (stroke.shape === 'angle') {
    if (points.length < 3 || handleIndex > 2) return stroke;
    return { ...stroke, points: points.map((p, i) => (i === handleIndex ? [nx, ny] as InkPoint : p)) };
  }
  if (stroke.shape === 'line' || stroke.shape === 'arrow') {
    if (points.length < 2 || handleIndex > 1) return stroke;
    return { ...stroke, points: points.map((p, i) => (i === handleIndex ? [nx, ny] as InkPoint : p)) };
  }
  if (points.length < 2 || handleIndex > 3) return stroke;
  const x0 = Math.min(points[0][0], points[1][0]);
  const x1 = Math.max(points[0][0], points[1][0]);
  const y0 = Math.min(points[0][1], points[1][1]);
  const y1 = Math.max(points[0][1], points[1][1]);
  // 🔴 **拖哪个角就改它那两条边，对角不动。**
  //    ⚠️ 第一版是「把那个角挪一下、再对四个角重算包围盒」—— 那是**错的**：
  //    拖左上角往下时，右上角还在上面 ⇒ 重算出来的顶边**一动不动**，
  //    而教师/学生看到的只是「拖了没反应」。`worksheet-ink.test.ts` 那条用例抓出来的。
  let nx0 = x0, nx1 = x1, ny0 = y0, ny1 = y1;
  if (handleIndex === 0) { nx0 = nx; ny0 = ny; }
  else if (handleIndex === 1) { nx1 = nx; ny0 = ny; }
  else if (handleIndex === 2) { nx1 = nx; ny1 = ny; }
  else { nx0 = nx; ny1 = ny; }
  // 拖过头穿过对角 ⇒ 只是框翻了个方向（这里收回 [min, max]），**不会出现负宽**。
  return {
    ...stroke,
    points: [
      [Math.min(nx0, nx1), Math.min(ny0, ny1)],
      [Math.max(nx0, nx1), Math.max(ny0, ny1)],
    ],
  };
}
