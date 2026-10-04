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
 * 两份有没有漂，跑这一条（实测 2026-09-24，**终审修复轮之后重跑** —— 输出与 B1 那次逐字相同）：
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
 * ⚠️ 用元组不用对象不是口味：上限是 2000 个点，而 `{x, y}` 每点**固定**比 `[x, y]` 多 8 字节
 * （`"x":` / `"y":` 各 4 字节，`{}` 与 `[]` 相抵）。⊘ 2026-09-24（终审 M2）：原句「约为两倍（键名各两个字符 + 两个引号 + 一次冒号）」两个数都不准 —— 多出来的既不是「两倍」也不是「键名两个字符」，而是**每点 8 字节**；实测 2000 点（坐标两位小数）21,761 → 37,761 字节（差 16,000 = 2000 × 8），**比值随坐标的字符数变**（两位小数 1.74×、个位数 2.04×），不是定数。
 * ⇒ 这个值要过 HTTP、要进 `localStorage` 离线队列、还会整份发给教师端，所以每点省下的这 8 字节不是小事。
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
export const INK_TOOL_TEXT = 'text';
export const INK_TOOL_SELECT = 'select';
export const INK_TOOLS = [INK_TOOL_PEN, ...INK_SHAPE_KINDS, INK_TOOL_TEXT, INK_TOOL_SELECT] as const;
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
/**
 * 画布上的一段**文字**（★ 2026-09-30 第二轮，教师：「还缺少文本工具」）。
 *
 * 🔴 它是**第二种元素**（在此之前 `InkValue` 只有笔画）⇒ 那份「九处各自读/画同一份数据」的
 *    爆炸半径**整份再来一遍**（规格第二轮那一节逐条列了）。存储上它走**可选数组**
 *    `texts` ⇒ 老数据零改动、零迁移（与 `stroke.shape` 同一招）。
 *
 * 单位规则**与笔迹逐字相同**（别另立一条）：
 *   · `at` 归一化到 **0..1**（基准 `canvas.w × canvas.h`）；
 *   · `size` 归一化到 **`min(canvas.w, canvas.h)`** —— 与 `InkStroke.width` 同一个基准。
 * ⚠️ 两条规则的单位不同而类型都是 `number`，写错不会有任何报错，只会让字号随屏幕变化。
 */
export interface InkText {
  text: string;
  /** 文本框的锚点：**左上角**（归一化）。 */
  at: InkPoint;
  color: string;
  /** 字号（归一化到画布短边）。 */
  size: number;
}

/**
 * 字号三档 —— **与笔的粗细三档一一对应**（教师：「字号跟着粗细档」）。
 * 🔴 一一对应是**产品决定**：工具栏上因此只需要一组控件（「细/中/粗」同时读作「小/中/大」），
 *    而那正是第二轮「紧凑」那一条要的。
 */
export const INK_TEXT_SIZES = [0.045, 0.07, 0.105] as const;
export type InkTextSize = (typeof INK_TEXT_SIZES)[number];
export const INK_DEFAULT_TEXT_SIZE: InkTextSize = INK_TEXT_SIZES[1];

/** 这一档是不是三档之一。 */
export function isInkTextSize(raw: unknown): raw is InkTextSize {
  return typeof raw === 'number' && (INK_TEXT_SIZES as readonly number[]).includes(raw);
}

/**
 * 一段文字的**估算像素宽度**（不含字号）。
 *
 * 🔴 为什么是**估算**而不是量出来：判据层**不许碰 DOM**（零 import、`node --test` 直接跑），
 *    而量文字要 `measureText`。⇒ 按字符宽度估：CJK / 全角 ≈ 1 em，其余 ≈ 0.55 em。
 * ⚠️ 代价如实记：**命中框是近似的**（渲染出来的是真字，二者会有几个像素的出入）。
 *    但两个渲染器与命中测试**用的是同一个估算** ⇒ 三者一致，不会出现「看得见点不中」
 *    这种最糟的情况（学生在别处点一下反而选中了它）。
 */
export function estimateTextWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // CJK 统一表意文字 / 全角标点 / 假名 / 谚文 ⇒ 全宽；其余按 0.55 估。
    const wide = (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 1 : 0.55;
  }
  return width;
}

/**
 * 一段文字在 `box` 里的**像素外接框** `[x, y, w, h]`（左上角 + 宽高）。
 * 三个消费者共用它：命中测试、学生画布、教师端 SVG。
 */
export function textBoxOf(text: InkText, box: InkCanvas): [number, number, number, number] {
  const sizePx = text.size * Math.min(box.w, box.h);
  const x = text.at[0] * box.w;
  const y = text.at[1] * box.h;
  // ⚠️ 行高 1.3：与渲染那边（canvas 的 `textBaseline` / SVG 的 `dominant-baseline`）对齐的近似值。
  return [x, y, estimateTextWidth(text.text) * sizePx, sizePx * 1.3];
}

/** 点得中这段文字吗（在它的估算框里，含宽容度）。⚠️ 与 `hitTestStroke` 同一条口径：宽容度是**像素**。 */
export function hitTestText(point: InkPoint, text: InkText, box: InkCanvas, tolPx: number): boolean {
  const [x, y, w, h] = textBoxOf(text, box);
  const [px, py] = toPixel(point, box);
  const tol = Number.isFinite(tolPx) && tolPx > 0 ? tolPx : 0;
  return px >= x - tol && px <= x + w + tol && py >= y - tol && py <= y + h + tol;
}

/** 平移一段文字。**按估算框夹取到 0..1**（与 `moveStroke` 同一条纪律：逐点夹会把它挤扁）。 */
export function moveText(text: InkText, dx: number, dy: number): InkText {
  const [x, y, w, h] = textBoxOf(text, { w: 1, h: 1 });
  const moveX = clampDelta(dx, -x, 1 - x - w);
  const moveY = clampDelta(dy, -y, 1 - y - h);
  if (moveX === 0 && moveY === 0) return text;
  return { ...text, at: [round6(text.at[0] + moveX), round6(text.at[1] + moveY)] };
}

/** 这一档粗细对应哪一档字号（教师：「字号跟着粗细档」）。越界的档取中间。 */
export function textSizeForWidth(width: number): InkTextSize {
  const index = (INK_WIDTH_OPTIONS as readonly number[]).indexOf(width);
  return INK_TEXT_SIZES[index < 0 ? 1 : index];
}

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
export interface InkValue { format: InkFormat; canvas: InkCanvas; strokes: InkStroke[]; /** ★ 第二轮：文字（可选 ⇒ 老数据零改动）。 */ texts?: InkText[] }

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
  if (node.type === 'drawing') return node.inputMode !== 'photo';
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
 * 只有两种文案：**绘图题**与**手写题**（同为手写的填空题与问答题共用一句）。
 * 提示只说明直接操作与自动保存，不重复讲解工具栏，避免在画布与工具之间制造视觉隔断。
 */
export function inkHint(node: { type: string; inputMode?: unknown }): string {
  if (node.type === 'drawing') return '直接在画布上作图，作答会自动保存为草稿。';
  return '直接在方框里书写，作答会自动保存为草稿。';
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
 * 撤销最后一笔（**按笔画撤销**，裁定 4）。⊘ 2026-09-24（终审 M1）：这里原写「裁定 3」—— 那是
 * 「手写 / 绘图**不判分**」那一条（本文件的 `inkFormatOf` / 服务端的 `JUDGES.drawing` 是它）；
 * 「按笔画撤销 + 上限 400 笔 / 2000 点」是**裁定 4**（`clearStrokes` 的注释、`appendStroke`
 * 的理由、规格 §12 的 M4b 表都按 4 写）—— 同一文件内两处指向不同裁定号是自相矛盾。
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
/**
 * ⚠️ 2026-09-30：形参里那个 `box` **删掉了** —— 它从来没被用到（把手是归一化坐标，
 * 是调用方拿 `toPixel` 换算的），而留着一个用不到的形参只会让下一个人以为这里要做换算。
 */
export function strokeHandles(stroke: InkStroke): InkPoint[] {
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
  const handles = strokeHandles(stroke);
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
/**
 * ★ 2026-09-28：把一幅笔迹**抽稀**到指定体积以内 —— 只给「正在输入」那条实时通道用。
 *
 * 🔴 **为什么必须是抽稀，而不是「太大就不发」**：实测一幅认真的手写图约 **335 KB**
 *（30 笔 × 300 点），而那条通道是**节流 300ms** 的 —— 原样发就是每秒一兆字节。
 * 而看板那一格里的画只有 **200 来像素宽**，原始密度在那里本来就看不出来。
 *
 * 🔴 **它产出的值只喂预览，不是存档**，所以「抽稀后的形状略有不同」是可接受的：
 *   · 落库那条路（`worksheet-answer-updated`）发的是**原值**（超限才不发）；
 *   · 这一条只喂看板那一格，**没有第二个消费方**。
 * ⚠️ 所以**不要**拿它的结果去写库或存 localStorage —— 那会把学生的画**永久降质**。
 *
 * 判据是「抽掉**偶数位**的点」（保首尾）：均匀抽稀比「每 N 个取一个」简单，
 * 而且首尾一定在（少了首尾，一笔的形状会明显变形）。
 */
export function downsampleInkValue(value: unknown, budgetChars: number): unknown {
  const ink = readInkValue(value);
  // 不是笔迹（文本 / 选择 / 结构化值都远小于预算）⇒ **原样返回**。
  if (!ink) return value;
  if (JSON.stringify(value).length <= budgetChars) return value;

  // 逐轮加倍抽稀，直到装得下。⚠️ **有上界**（8 轮 = 抽到 256 分之一）：
  // 无上界的循环遇上「算不准的体积」会一直转，而这一头是学生的浏览器。
  let strokes = ink.strokes;
  for (let round = 0; round < 8; round += 1) {
    // ★ 2026-09-30：**图形一个点都不抽**。
    // 🔴 手写的点是**采样**（抽掉一半形状基本不变），而图形的点是**定义几何**：
    //    角有 3 个点（顶点 + 两条边），抽掉中间那个 ⇒ **角变成一条直线**；
    //    矩形只有 2 个点，抽掉一个 ⇒ 只剩一个点，画出来是一片空白
    //    （而空白与「他没画」在屏幕上一模一样）。
    //    ⚠️ `keepEveryOther` 自身的「≤2 不抽」守卫对**角**不成立（它是 3 个点）。
    strokes = strokes.map((stroke) => (
      isInkShapeKind(stroke.shape)
        ? stroke
        : { ...stroke, points: keepEveryOther(stroke.points, round + 1) }
    ));
    // ★ 2026-09-30 第二轮：**文字原样带着**（抽稀只抽笔画 —— 文字没有「采样点」可抽）。
    //    ⚠️ 少了这一句，预览那一份会**整段丢掉文字**（而学生屏幕上还在）——
    //    正是「预览里看不到、学生那里有」那类静默分叉。
    const candidate = { format: ink.format, canvas: ink.canvas, strokes, ...(ink.texts ? { texts: ink.texts } : {}) };
    if (JSON.stringify(candidate).length <= budgetChars) return candidate;
  }
  // 抽到顶还装不下（几千笔的怪物）⇒ 返回抽到顶的那一份，**不再继续抽**
  //（再抽下去那一笔就只剩两个点了，画出来是一条直线，比不画更误导）。
  return { format: ink.format, canvas: ink.canvas, strokes, ...(ink.texts ? { texts: ink.texts } : {}) };
}

/**
 * 抽掉第 `2^n` 位上的点，保留首尾。
 *
 * ⚠️ 结果至少保留**两个点**（首尾）：少于两个点连不成线，`strokePath` 会画出空白 ——
 * 而空白与「他没画」长得一样。
 */
function keepEveryOther(points: readonly InkPoint[], round: number): InkPoint[] {
  const step = 2 ** round;
  if (points.length <= 2) return [...points];
  const kept: InkPoint[] = [];
  for (let index = 0; index < points.length; index += step) kept.push(points[index]);
  const last = points[points.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

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
  // ★ 2026-09-30 第二轮：文字。⚠️ **可选** —— 老值没有 `texts`，读出来也不带这个键
  //    （`undefined` 而不是 `[]`：那让「老值原样返回」这件事在 `deepEqual` 上也成立）。
  const texts: InkText[] = [];
  if (Array.isArray(row.texts)) {
    row.texts.forEach((item) => {
      const text = readText(item);
      if (text) texts.push(text);
    });
  }
  const value: InkValue = { format: row.format, canvas: readCanvas(row.canvas), strokes };
  if (texts.length > 0) value.texts = texts;
  return value;
}

/** 读一段文字（★ 第二轮）。坏形状**整段丢掉** —— 与「坏点丢整笔」同一条纪律。 */
function readText(raw: unknown): InkText | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.text !== 'string' || row.text === '') return null;
  const at = readPoint(row.at);
  if (!at) return null;
  const color = row.color;
  const size = row.size;
  // ⚠️ `size` 认不出就**回落默认档**（与 `color` / `width` 同一条：样式坏掉不丢几何）；
  //    但 `at` 坏掉就**没有位置**，那段文字只能整段丢掉。
  return {
    text: row.text,
    at,
    color: typeof color === 'string' && isInkColor(color) ? color : INK_STROKE_COLOR,
    size: isInkTextSize(size) ? size : INK_DEFAULT_TEXT_SIZE,
  };
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
): InkStroke {
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
