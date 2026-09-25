/**
 * 笔迹的**渲染层纯逻辑** —— `src/lib/worksheet-ink.ts` 的**镜像**（M6a）。
 *
 * 🔴 **本文件是镜像，不是共享。** 服务端读不到 `src/`，所以这里**必须**再写一份。
 * 改动规则只有一条：**改了 `src/lib/worksheet-ink.ts` 里对应的那一处，这里必须一起改。**
 * `src/lib/worksheet-ink-parity.test.ts` 会红 —— 它把同一批笔画喂给三份实现
 * （前端 `worksheet-ink.ts` · 服务端 `worksheet-ink.ts` · 本文件），`d` 串必须逐字相同。
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
export interface InkStroke { color: string; width: number; points: InkPoint[] }

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
export function strokePath(points: readonly InkPoint[], box: InkCanvas): string {
  if (points.length === 0) return '';
  const parts: string[] = [];
  points.forEach((point, index) => {
    const [x, y] = toPixel(point, box);
    parts.push(`${index === 0 ? 'M' : 'L'}${round2(x)} ${round2(y)}`);
  });
  if (points.length === 1) parts.push('l0.01 0');
  return parts.join(' ');
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
  return {
    color: typeof color === 'string' && color ? color : INK_STROKE_COLOR,
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : INK_STROKE_WIDTH,
    points,
  };
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
