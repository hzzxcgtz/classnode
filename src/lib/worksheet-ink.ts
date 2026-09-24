/**
 * 笔迹（`ink/v1` / `drawing/v1`）的**纯逻辑层** —— 没有 React、没有 DOM、没有 `@/` 路径。
 *
 * 🔴 这个文件存在的理由与 `worksheet-drag.ts` 逐字同一条，而且更硬：M4b 真正决定成败的
 * 那些东西是**手感**（跟不跟手、延迟、手掌误触、落笔与滚动抢不抢），而它们
 * **本机一条都验不了**（Global Constraint 16）。本机能钉住的只有这一层：笔迹的形状、
 * 上限、归一化、坐标换算、撤销 / 清空。所以 C1（学生端画布组件）与 E1（教师抽屉的 SVG
 * 渲染）**都不自己写判据** —— 它们按本文件的接口逐字消费，正确性建立在这里。
 *
 * 与 `worksheet-answer-value.ts` 同一条纪律：
 *   · **不引任何 React / DOM，也不引任何联名路径（`@/…`）** —— 它要能被 `node --test`
 *     直接执行（Node 24 的类型擦除），所以 `worksheet-ink.test.ts` 能真的跑到这些判据；
 *   · `import type` 是**唯一**的 import 形态（本文件不需要任何 import）；
 *   · 本文件在 `scripts/check-classroom-browser-compat.mjs` 的扫描根（`src/lib`）内：
 *     不得出现 `Object.hasOwn` / `structuredClone` / `findLast` / `.at(` / `:has(` /
 *     `@container` / `content-visibility` / `color-mix(`（学生端跑在 Safari 15 的老 iPad 上）。
 *
 * ⚠️ 本文件里每一个函数都在**渲染路径**上：一次 TypeError 会让学生的作答区白屏，
 * 而白屏的学生会以为「老师没布置」。所以「坏形状」一律收成 `null` / 空数组 / 夹取后的值，
 * **不抛**。唯一的例外是入参本身不是对象（那已不是「坏形状的值」，而是调用点的编程错误）。
 */

/**
 * 🔴 与 `server/src/services/worksheet-ink.ts` 的同名常量是**同一对**字面量，两处必须一起改。
 *
 * ⚠️ 服务端读不到 `src/`，所以那一份是**第二份**、不是共享 —— 它由 M4b 的 B1 新建（`e1ff80c`）。
 * 两份有没有漂，跑这一条（实测 2026-09-24，B1 之后）：
 * ```
 * $ ls server/src/services/worksheet-ink.ts
 * server/src/services/worksheet-ink.ts
 * $ /usr/bin/grep -n '^export const INK_MAX' src/lib/worksheet-ink.ts server/src/services/worksheet-ink.ts
 * src/lib/worksheet-ink.ts:43:export const INK_MAX_STROKES = 400;
 * src/lib/worksheet-ink.ts:44:export const INK_MAX_POINTS = 2000;
 * server/src/services/worksheet-ink.ts:15:export const INK_MAX_STROKES = 400;
 * server/src/services/worksheet-ink.ts:16:export const INK_MAX_POINTS = 2000;
 * ```
 * ⊘ 2026-09-24（B1）：这一段原是一段 `ls … No such file or directory (os error 2)` 的实测输出，
 * 用来记「服务端那一份还不存在」。B1 把那个文件建出来了 ⇒ 换成上面这条能**同时**证明
 * 「两份都在」与「两份的字面量逐字相同」的命令，而「第二份、不是共享」这个结论没变。
 * 两处各写一份的代价是「改了一处、另一处没改」，而它不报错：客户端收下一幅 400 笔的画、
 * 服务端按旧上限拒绝 ⇒ 学生看到的是「提交失败」，且提示里的数字与他自己屏幕上的不一致。
 */
export const INK_MAX_STROKES = 400;
export const INK_MAX_POINTS = 2000;

/** 采样阈值（CSS 像素）：两点比它更近就不记 —— 见 `isFarEnough` 的理由。 */
export const INK_MIN_POINT_DISTANCE_PX = 1.5;
/** 笔迹颜色与粗细。裁定 2：M4b **不做**颜色 / 粗细的选择，所以它们是常量。 */
export const INK_STROKE_COLOR = '#1f2937';
/** ⚠️ **归一化**宽度（基准是 `min(canvas.w, canvas.h)`，不是像素）—— 见 `InkStroke` 的单位规则。 */
export const INK_STROKE_WIDTH = 0.016;

export const INK_FORMATS = ['ink/v1', 'drawing/v1'] as const;
export type InkFormat = (typeof INK_FORMATS)[number];

/**
 * 一个采样点：`[x, y]`，**两个数都归一化到 0..1**。
 *
 * ⚠️ 用元组不用对象不是口味：上限是 2000 个点，`{x, y}` 的 JSON 体积约为 `[x, y]` 的两倍
 * （键名各两个字符 + 两个引号 + 一次冒号），而这个值要过 HTTP、要进 `localStorage`
 * 离线队列、还会整份发给教师端。
 */
export type InkPoint = [number, number];

/**
 * 一笔。
 *
 * 🔴 **这个对象里的每一个数都与像素无关**（唯一一条单位规则，别在别处再立一条）：
 *   · `points` 的 x / y 归一化到 **0..1**，基准是 `canvas.w × canvas.h`；
 *   · `width` 归一化到 **`min(canvas.w, canvas.h)`**；
 *   · `canvas.w` / `canvas.h` 是**学生作答那一刻画布框的实测 CSS 像素**（不是题型默认框、
 *     不是 devicePixelRatio 之后的物理像素）。
 * ⇒ 渲染时用 `toPixel()` / `strokeWidthPx()`（`strokeWidthPx` 内部乘 `min(w, h)`），
 *   别在两处各写一遍 `x * canvas.w`。
 * ⚠️ 为什么 `width` 的基准是 `min(w, h)` 而不是高度：绘制框在两个屏幕上的宽高比可以不相等，
 *   拿某一边当基准时另一种屏幕上的线宽会跟着那个比例跑。取短边是「两种都不至于离谱」的那一档，
 *   而它的代价（**长宽比差异很大时线宽略有出入**）比另一边小得多。
 *
 * 🔴 `width` 与 `points` 的单位规则**不同**（一个是长度、一个是比例），而它们的类型都是
 * `number` —— 这正是必须在这里写清、并由 `worksheet-ink.test.ts` 钉住的原因：写错一个单位
 * 不会有任何报错，只会让线宽随屏幕变化。
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

/**
 * 这道题是不是「用画布作答」（绘图题、或作答方式 = 手写）。
 *
 * ⚠️ 判据是**两条**（`type === 'drawing'` 或 `inputMode === 'handwriting'`），而
 * `inputMode` 那一条在本任务里**还没有任何生产者**（编辑器的开关在 D1）—— 这不是死代码，
 * 它让「手工改过的库行」也走进同一条路，而它的消费者（A2 的 `draftKindOf`）离它只有一个任务。
 *
 * ⚠️ 两条之间是**或**：`drawing` 的 `inputMode` 是什么都不影响结论（绘图题的输入方式由题型
 * 天然决定，规格 §7.5：真正需要教师决策的只有填空题和问答题）。
 */
export function isInkNode(node: { type: string; inputMode?: unknown }): boolean {
  if (node.type === 'drawing') return true;
  return node.inputMode === 'handwriting';
}

/**
 * 这道题的作答值格式（规格 §12 裁定 6：**一个实现、两个 format 名**）。
 * 差别只在题型默认的画布尺寸与提示语 —— 存储与渲染完全相同。
 *
 * 🔴 判据是**题型优先**：`drawing` 恒 `drawing/v1`，哪怕它的 `inputMode` 被手改成
 * `keyboard`（那个字段对绘图题根本没有意义）。反过来写（先看 `inputMode`）会让一道绘图题
 * 因为一个无关字段的脏值而**换一个 format 名**，而两个 format 名的存储与渲染完全相同
 * ⇒ 屏幕上一切正常，只有「这题当初按哪种形状存的」静默变了。
 */
export function inkFormatOf(node: { type: string; inputMode?: unknown }): InkFormat {
  return node.type === 'drawing' ? 'drawing/v1' : 'ink/v1';
}

/**
 * 绘图题的**默认画布**（4:3）与手写问答的框（2:1）。
 *
 * ⚠️ `canvas.h` **同时是元素的高度**（`ink-canvas.tsx` 用它当 CSS `height`），
 * 所以这两个数是**界面上看得见的**，不只是元数据 —— 改它们等于改 UI。
 * `w` 只在「还没有量过框」时当名义宽度（空输入态的占位、手改过的值）。
 */
const INK_BOX_DRAWING: InkCanvas = { w: 320, h: 240 };
const INK_BOX_WRITING: InkCanvas = { w: 320, h: 160 };

/**
 * 题型**默认**的画布框（裁定 6：差别只在题型默认的画布尺寸 / 提示语）。
 *
 * ⚠️ 每次调用都回**新对象**（`{ ...INK_BOX_DRAWING }`）：这两个常量是模块级的，
 * 把它们本身交出去之后，调用点任何一次「就地改框」（`box.h = 180`）都会改掉**之后每一道题**
 * 的默认框 —— 而那是一道看不见的题与另一道题之间的耦合。
 */
export function defaultInkBox(node: { type: string; inputMode?: unknown }): InkCanvas {
  return node.type === 'drawing' ? { ...INK_BOX_DRAWING } : { ...INK_BOX_WRITING };
}

/**
 * 画布下面那句提示语（裁定 6 的「提示语」那一半）。
 *
 * 只有两种文案：**绘图题**与**手写题**（同为手写的填空题与问答题共用一句 —— 裁定 6 的差别
 * 在「绘图题 / 手写题」之间，不在填空题与问答题之间）。文案里说的两件事都是屏幕上真有的东西：
 * 那一句是画布，下面那两个按钮是「撤销」与「清空」（`task-C1-brief.md` 的工具栏一节）。
 */
export function inkHint(node: { type: string; inputMode?: unknown }): string {
  if (node.type === 'drawing') return '用手指在画布上作图（画错了可以点「撤销」或「清空」）。';
  return '用手指在方框里写字（写错了可以点「撤销」或「清空」）。';
}

/** 所有笔画加起来的点数。上限判据用的是**总数**，不是「每笔最多多少点」。 */
export function countPoints(strokes: readonly InkStroke[]): number {
  let total = 0;
  strokes.forEach((stroke) => { total += stroke.points.length; });
  return total;
}

/**
 * 还能不能落新的一笔。`null` = 可以；否则是**给学生的中文原因**。
 *
 * 🔴 **先背下来这条判据在防什么**：值是 Json 列、要过 HTTP、还要进 `localStorage`
 * 离线队列（规格 §12 裁定 4）⇒ 没有上限时，学生按住不放画十分钟就是一个几十 MB 的值，
 * 它会（a）挤爆 `localStorage` 配额（`writeQueue` 的 `catch` 会**静默降级**成「这一次会话
 * 内还在、撑不过刷新」）、（b）让教师抽屉里那条渲染卡死。上限是**机械可判**的那条线。
 *
 * ⚠️ 两条判据都是 `>=`：**恰好到 400 笔 / 2000 点时已经不能落新的一笔**（`appendStroke`
 * 那一侧才是收下「恰好到 2000 点的那一笔」的地方，见它自己的注释）。
 */
export function inkLimitReason(strokes: readonly InkStroke[]): string | null {
  if (strokes.length >= INK_MAX_STROKES) {
    return `笔迹已达上限（${INK_MAX_STROKES} 笔）—— 请撤销几笔，或点「清空」重画。`;
  }
  if (countPoints(strokes) >= INK_MAX_POINTS) {
    return `笔迹已达上限（${INK_MAX_POINTS} 个点）—— 请撤销几笔，或点「清空」重画。`;
  }
  return null;
}

/**
 * 加一笔。🔴 **超上限时原样返回**（同一个对象），**不抛、也不截断**。
 *
 * ⚠️ 为什么**不截断**：截断会把学生那一笔的后半段吃掉，而他看到的是「我的线怎么短了一截」——
 * 那比「这一笔没画上 + 一句上限提示」难懂得多。整笔丢掉时至少屏幕上少一条完整的线，
 * 配合 `inkLimitReason` 的那句话，学生知道发生了什么。
 * ⇒ 调用方（组件）**在落笔之前**先用 `inkLimitReason` 拦一次，所以这条分支正常走不到；
 *   它留着是因为「值可能来自手改过的行 / 上个版本」，而那时代码不该抛。
 *
 * ⚠️ 第二个门槛（`countPoints + 本笔点数 > INK_MAX_POINTS`）与 `inkLimitReason` 的
 * `>=` **不是重复**：前者管「加上这一笔之后**会不会超**」，后者管「**现在**还能不能落笔」。
 * 一处写成 `>=` 就会让「总点数恰好落在 2000 的那一笔」永远画不上（差一位）。
 *
 * ⚠️ `points` 为空的一笔**不记**（回原对象）：它画不出任何东西，却会占掉 400 笔的额度。
 */
export function appendStroke(value: InkValue, stroke: InkStroke): InkValue {
  if (stroke.points.length === 0) return value;
  if (inkLimitReason(value.strokes) !== null) return value;
  if (countPoints(value.strokes) + stroke.points.length > INK_MAX_POINTS) return value;
  return { ...value, strokes: [...value.strokes, stroke] };
}

/**
 * 撤销最后一笔（**按笔画撤销**，裁定 3）。
 *
 * ⚠️ 空数组上是**空操作**，不是异常：学生连点两下「撤销」的第二下就走这条分支
 * （按钮在 `strokes.length === 0` 时本来就该 `disabled`，但那是一条界面纪律，
 * 而这里不该依赖它）。
 * ⚠️ 与 `appendStroke` 的「超上限时原样返回」**刻意不同**：这里**总是**回新对象
 * （`canvas` / `format` 原样带过去，`strokes` 是新数组）—— 调用方拿它交给 `setState`，
 * 新身份让 React 一定重画，而撤销按下去本来就必须看到变化。
 */
export function undoStroke(value: InkValue): InkValue {
  return { ...value, strokes: value.strokes.slice(0, -1) };
}

/**
 * 清空全部笔迹（裁定 4 明确要求的出路：画到上限的学生不能只能一笔一笔撤销 400 次）。
 *
 * ⚠️ `format` / `canvas` **原样保留**：清空的是笔迹，不是这道题的作答形状。
 * 把 `canvas` 也重置成默认框会让「清空后重画」的那幅图按另一个框的宽高比画出来
 * （学生量过的框才是对的）。
 */
export function clearStrokes(value: InkValue): InkValue {
  return { ...value, strokes: [] };
}

/**
 * 两个归一化点之间的**像素**距离够不够远 —— 采样过滤。`minPx` 由调用方给
 * （生产调用点传 `INK_MIN_POINT_DISTANCE_PX`）。
 *
 * 🔴 **不加这条过滤，上限就是形同虚设**：`pointermove` 在 iPad 上按屏幕刷新率派发，
 * 一次 3 秒的涂鸦轻松产生 600~1000 个点（`pointermove` 的派发频率由设备给，不由我们），
 * 学生**几乎一落笔就撞上 2000 点的上限**，而提示说的是「笔迹已达上限」—— 他会以为自己
 * 画得太多，不会想到是采样的问题。
 * 阈值 1.5px 是「手指抖动」与「有效位移」之间的经验值（与 M4a 的 `DRAG_THRESHOLD_PX`
 * 同一个由来，但**不是同一个数**：那个判「点选还是拖拽」，值在
 * `src/app/classroom/worksheet/use-pointer-drag.ts:42`（`= 8`）；这个判「这个采样点要不要记」）。
 *
 * ⚠️ 判据是 `>=`：**恰好等于阈值算「够远」**，所以「阈值本身」是一个会被记下的位移。
 */
export function isFarEnough(from: InkPoint, to: InkPoint, box: InkCanvas, minPx: number): boolean {
  const a = toPixel(from, box);
  const b = toPixel(to, box);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return dx * dx + dy * dy >= minPx * minPx;
}

/** 夹到 0..1。`readPoint` 与 `normalizeAxis` 共用这一处（两处各写一份会漂）。 */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 客户端坐标 → 归一化，**越界夹到 0..1**（手指滑出画布时不该产生界外的点）。
 * `size <= 0` 时回 0（框还没量出来，别产生 NaN）。
 *
 * ⚠️ `NaN` / `Infinity` 也走「回 0」那条路：`Number.isFinite` 挡的是它们，
 * 而不是靠下面的夹取 —— 夹取对 `NaN` 是**无效**的（两个比较都是 false ⇒ 原样返回 `NaN`），
 * 那会让一个 NaN 一路穿过 `toPixel` 进到 SVG 的 `d` 串里。
 */
export function normalizeAxis(offset: number, size: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(size) || size <= 0) return 0;
  return clamp01(offset / size);
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
 * SVG 的 `d`（教师端抽屉用）。
 *
 * 🔴 **单点笔画必须画出一个点**：学生在屏幕上点一下就是一个只有 1 个点的笔画，
 * 而 `M x y` 后面什么都不接的路径在 Safari 上**不渲染任何东西**（round linecap 对
 * 零长度子路径的处理各家不同）⇒ 用一个极短的线段代替（`l 0.01 0`）。
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
 * ⚠️ 点的处理是**逐点**的：`points` 里混进一个 `['a','b']` 只丢那一个点，其余照留 ——
 * 与「坏笔画只丢那一条」同一条粒度纪律（`readEntries` 丢的是缺 id 的条目，不是整份）。
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
 * ⚠️ 零 / 负数 / `NaN` 一律当成读不出来：负宽度的框会把点映射到界外，
 * 而 `{ w: 0, h: 0 }` 这个哨兵有**明确的读者**（E1 的 `InkPreview` 把它当成「用一个最小
 * 可渲染的框」）。回落成题型默认框是另一回事：那会**把学生的图按错误的宽高比画出来**，
 * 即一条看起来正常、形状却错的线。
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
 * 🔴 与 `readEntries` / `readLinks`（`src/lib/worksheet-answer-value.ts`）同一条纪律，
 * 但**判据的粒度是逐笔画的**：一条笔画坏掉只丢那一条（屏幕上少一条线），
 * 整份不是数组才回 `null`。
 * 反过来（一条坏笔画作废整幅画）会让**学生画的所有东西在屏幕上消失**，
 * 而那是渲染路径 —— 学生会以为老师把题撤了。
 *
 * ⚠️ 数量**不在这里截断**：这里是读的一侧，截断会让「库里有什么」与「屏幕上画什么」
 * 变成两件事。上限只在写入口（`appendStroke` 与服务端的 400）。
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
