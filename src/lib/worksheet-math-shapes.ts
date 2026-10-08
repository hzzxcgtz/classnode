/**
 * 数学作图的**图形构造**与精简工具表。
 *
 * 🔴 这个文件是**纯函数**（不 import React / jsxgraph）：画板只负责手势与渲染，
 *    「两个点怎么变成一个长方形」「三个点怎么变成角平分线」这类几何全在这里，
 *    因此能被 `node --test` 直接验（本仓没有前端测试框架）。
 *
 * 数据形状（存进 `drawing.data.elements`）全部由普通坐标数组组成；除基础形状与历史标注外，
 * 坐标系和数轴也作为单个成组对象保存，便于选择、删除、撤销和教师端预览保持一致。
 */

export type Pt = [number, number];

export type MathEntry =
  | { kind: 'point'; p: Pt }
  | { kind: 'segment' | 'line' | 'arrow'; a: Pt; b: Pt }
  | { kind: 'circle'; center: Pt; edge: Pt }
  | { kind: 'polyline'; points: Pt[]; closed?: true }
  /**
   * ⊘ **历史形状**（★ 2026-10-07 砍掉了「角」这个工具）：它画的是**两条臂 + 一段弧**。
   *   老作答里还有 ⇒ 必须一直读得回来、画得出来。**不许删这一支。**
   *   新的角标注走 `angleArc`（只画弧，不画臂）。
   */
  | { kind: 'angle'; vertex: Pt; a: Pt; b: Pt }
  | { kind: 'label'; at: Pt; text: string }
  /** ★ 2026-10-07 四个几何记号（教师的「几何题的行话」）。 */
  | { kind: 'angleArc'; vertex: Pt; a: Pt; b: Pt; text?: string }
  | { kind: 'rightAngle'; vertex: Pt; a: Pt; b: Pt }
  | { kind: 'equalMark'; a: Pt; b: Pt }
  | { kind: 'parallelMark'; a: Pt; b: Pt }
  /** 教师和学生都可添加的成组坐标工具；作为一个对象参与选择、删除与撤销。 */
  | { kind: 'coordinateSystem'; a: Pt; b: Pt }
  | { kind: 'numberLine'; a: Pt; b: Pt };

/** 工具名（历史数据类型比这里多；这里仅列当前工具栏允许新建的内容）。 */
export type MathTool =
  | 'segment' | 'arrow' | 'circle' | 'free'
  | 'triangle' | 'rectangle' | 'parallelogram' | 'trapezoid'
  | 'coordinateSystem' | 'numberLine'
  | 'label' | 'select';

/** 工具条上的**分组**（★ 2026-10-06 教师：「整个工具栏 UI 重新设计一下，归类要科学」）。 */
export const MATH_TOOL_GROUPS = [
  { value: 'basic', label: '基础' },
  { value: 'polygon', label: '多边形' },
  { value: 'coordinate', label: '坐标' },
  { value: 'other', label: '其他' },
] as const;

export type MathToolGroup = (typeof MATH_TOOL_GROUPS)[number]['value'];

/**
 * 工具表。`drag: true` 表示按住拖动即可成形。
 * 当前工具栏不再提供独立点和四种几何标注；基础线条使用有限线段，射线改成箭头；
 * 三种多边形也统一拖出包围框生成。历史作答仍由 `MathEntry` 与两个渲染端完整兼容。
 */
export const MATH_TOOLS: ReadonlyArray<{
  value: MathTool;
  label: string;
  clicks: number;
  drag?: true;
  group: MathToolGroup;
}> = [
  // ★ 2026-10-07：「选择」挪到**第一个** —— 它是每一个工具的出口（画错了要能选、能删），
  //   排在最后一行要翻整个工具条才找得到。
  { value: 'select', label: '选择', clicks: 1, group: 'basic' },
  { value: 'segment', label: '线段', clicks: 2, drag: true, group: 'basic' },
  { value: 'arrow', label: '箭头', clicks: 2, drag: true, group: 'basic' },
  { value: 'circle', label: '圆', clicks: 2, drag: true, group: 'basic' },
  { value: 'triangle', label: '三角形', clicks: 2, drag: true, group: 'polygon' },
  { value: 'rectangle', label: '长方形', clicks: 2, drag: true, group: 'polygon' },
  { value: 'parallelogram', label: '平行四边形', clicks: 2, drag: true, group: 'polygon' },
  { value: 'trapezoid', label: '梯形', clicks: 2, drag: true, group: 'polygon' },
  { value: 'coordinateSystem', label: '添加直角坐标系', clicks: 2, drag: true, group: 'coordinate' },
  { value: 'numberLine', label: '添加数轴', clicks: 2, drag: true, group: 'coordinate' },
  { value: 'free', label: '铅笔', clicks: 0, group: 'other' },
  { value: 'label', label: '文字', clicks: 1, group: 'other' },
];

/** 工具条上要显示的分组（只保留真有工具的那些组，顺序跟着 `MATH_TOOL_GROUPS`）。 */
export function toolsInGroup(group: MathToolGroup): typeof MATH_TOOLS {
  return MATH_TOOLS.filter((tool) => tool.group === group);
}

/** 每个工具在工具条上要说的简短操作提示。 */
export function toolHintOf(tool: MathTool): string {
  if (tool === 'free') return '按住拖动，像铅笔一样画线';
  if (tool === 'coordinateSystem') return '按住拖动，确定直角坐标系的大小';
  if (tool === 'numberLine') return '按住横向拖动，确定数轴的位置和长度';
  if (MATH_TOOLS.find((item) => item.value === tool)?.drag) return '按住拖动即可画出这个图形';
  if (tool === 'label') return '点击画布，然后直接输入文字';
  if (tool === 'select') return '点一下图形选中它，再点右边的「删除选中」；点空白处取消';
  return '';
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function rectangleOf(a: Pt, b: Pt): Pt[] {
  return [
    [round(a[0]), round(a[1])],
    [round(b[0]), round(a[1])],
    [round(b[0]), round(b[1])],
    [round(a[0]), round(b[1])],
  ];
}

/** 拖出的包围框内生成平行四边形；方向反拖也保持相同形状。 */
export function parallelogramOf(a: Pt, b: Pt): Pt[] {
  const left = Math.min(a[0], b[0]);
  const right = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const bottom = Math.min(a[1], b[1]);
  const skew = (right - left) * 0.22;
  return [
    [round(left + skew), round(top)],
    [round(right), round(top)],
    [round(right - skew), round(bottom)],
    [round(left), round(bottom)],
  ];
}

/** 拖出的包围框内生成上窄下宽的等腰梯形。 */
export function trapezoidOf(a: Pt, b: Pt): Pt[] {
  const left = Math.min(a[0], b[0]);
  const right = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const bottom = Math.min(a[1], b[1]);
  const inset = (right - left) * 0.2;
  return [
    [round(left + inset), round(top)],
    [round(right - inset), round(top)],
    [round(right), round(bottom)],
    [round(left), round(bottom)],
  ];
}

/** 拖出的包围框内生成等腰三角形。 */
export function triangleOf(a: Pt, b: Pt): Pt[] {
  const left = Math.min(a[0], b[0]);
  const right = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const bottom = Math.min(a[1], b[1]);
  return [
    [round((left + right) / 2), round(top)],
    [round(right), round(bottom)],
    [round(left), round(bottom)],
  ];
}

/**
 * 拖动闭合多边形顶点时的几何吸附。
 *
 * - 任意多边形：移动点两侧的相邻边接近垂直时，吸到以两个相邻顶点为直径的圆上
 *   （圆周角定理保证夹角严格为 90°）；
 * - 四边形：移动点的一条邻边接近与对边平行时，投影到那条平行约束线上；
 * - 多个约束同时接近时，只采用离当前指针最近的候选，避免顶点突然跳远。
 *
 * `tolerance` 使用用户坐标；调用端按当前缩放把固定像素换算过来，因此放大、缩小后手感一致。
 */
export function snapPolygonVertex(points: Pt[], movedIndex: number, candidate: Pt, tolerance: number): Pt {
  if (points.length < 3 || movedIndex < 0 || movedIndex >= points.length || !(tolerance > 0)) return candidate;
  const prev = points[(movedIndex - 1 + points.length) % points.length];
  const next = points[(movedIndex + 1) % points.length];
  const candidates: Pt[] = [];

  const addProjectionToLine = (origin: Pt, direction: Pt) => {
    const length2 = direction[0] ** 2 + direction[1] ** 2;
    if (length2 < 1e-9) return;
    const scale = ((candidate[0] - origin[0]) * direction[0]
      + (candidate[1] - origin[1]) * direction[1]) / length2;
    candidates.push([origin[0] + direction[0] * scale, origin[1] + direction[1] * scale]);
  };

  // 相邻两边垂直 ⇔ 移动点落在「prev-next 为直径」的圆上。
  const center: Pt = [(prev[0] + next[0]) / 2, (prev[1] + next[1]) / 2];
  const radius = Math.hypot(next[0] - prev[0], next[1] - prev[1]) / 2;
  const fromCenter: Pt = [candidate[0] - center[0], candidate[1] - center[1]];
  const centerDistance = Math.hypot(fromCenter[0], fromCenter[1]);
  if (radius > 1e-6 && centerDistance > 1e-6) {
    candidates.push([
      center[0] + (fromCenter[0] / centerDistance) * radius,
      center[1] + (fromCenter[1] / centerDistance) * radius,
    ]);
  }

  if (points.length === 4) {
    const opposite = points[(movedIndex + 2) % 4];
    // prev→移动点 ∥ next→opposite
    addProjectionToLine(prev, [opposite[0] - next[0], opposite[1] - next[1]]);
    // 移动点→next ∥ opposite→prev
    addProjectionToLine(next, [prev[0] - opposite[0], prev[1] - opposite[1]]);
    // 两组对边同时平行时的唯一交点（完整平行四边形）。
    candidates.push([prev[0] + opposite[0] - next[0], prev[1] + opposite[1] - next[1]]);
  }

  let closest = candidate;
  let closestDistance = tolerance;
  for (const point of candidates) {
    const distance = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]);
    if (distance <= closestDistance) {
      closest = point;
      closestDistance = distance;
    }
  }
  return closest === candidate ? candidate : [round(closest[0]), round(closest[1])];
}

/** 绕中心旋转一组顶点；画板与以后可能加入的预览端共用同一份纯几何。 */
export function rotatePolygonPoints(origins: Pt[], center: Pt, startPointer: Pt, currentPointer: Pt): Pt[] {
  const start = Math.atan2(startPointer[1] - center[1], startPointer[0] - center[0]);
  const current = Math.atan2(currentPointer[1] - center[1], currentPointer[0] - center[0]);
  const delta = current - start;
  const cosine = Math.cos(delta);
  const sine = Math.sin(delta);
  return origins.map(([x, y]) => {
    const dx = x - center[0];
    const dy = y - center[1];
    return [center[0] + dx * cosine - dy * sine, center[1] + dx * sine + dy * cosine];
  });
}

/*
 * ⊘ ★ 2026-10-07：这里原来有 `directionOf` / `segmentAlong` / `lineThrough` 三个函数，
 *   服务的是「平行线」「垂线」两个工具。两个工具砍掉之后它们**一个调用点都没有了**
 *   ⇒ 一并删除（本仓的规矩：死代码会被人当成「还有人用」而不敢动）。
 *
 * ⚠️ 那两个工具被砍的理由值得留在这里，因为将来一定会有人想加回来：
 *   它们的参照线只在自己画的线里找（`math-drawing.tsx` 的 `runtime.current`），
 *   而**底图上的边不是画板对象** ⇒ 学生站在老师给的几何图前面点它们，
 *   什么都不会发生，屏幕上也不解释。真要加回来，先解决"参照得到底图上的边"这件事。
 */


/*
 * ★ 2026-10-07（教师）：四个**几何记号** —— 「这是几何题的行话」。
 *
 * 🔴 四个都做成「**点 N 个位置**」，一个都不依赖"画板里已有的对象"。
 *   理由：底图上的边**不是画板对象** —— 把「等号」做成"点一下那条线段"会犯跟
 *   平行线/垂线一模一样的毛病（点了静默无反应），而这两个记号正是教师明确要的。
 *   ⇒ 改完之后这一档**所有工具都不再依赖"画板里已有什么"**（唯一例外是「选择」），
 *     底图上与空白画布上行为完全一致，不需要任何"按有没有底图"的分叉。
 *
 * 🔴 尺寸全部用**用户坐标**（不是屏幕像素）：这样画板与教师预览
 *   （各自投影一次）算出来的是同一个记号 —— 两套尺寸迟早对不上，
 *   而表现只是「教师看到的记号比学生画的小一点」，没人会为此报 bug。
 */

/** 记号的最小跨度：两点靠得比它更近就说不清方向 ⇒ 不成形。
 *  ⚠️ 与拖动类那条 `Math.hypot(...) < 0.3` 是**同一把尺子**（`math-drawing.tsx` 的 onDragUp）。 */
export const MARK_MIN_SPAN = 0.3;
/** 等号短斜线的全长（垂直于那条边）。 */
export const MARK_TICK_LEN = 0.9;
/** 平行记号那根带箭头短线的全长（沿那条边）。 */
export const MARK_ARROW_LEN = 1.4;
/** 直角小方块的边长（沿两条边各量这么长）。 */
export const MARK_SQUARE_SIDE = 0.8;
/** 多边形自动吸成直角后显示的提示方框，比手动画的历史直角标注更小。 */
export const AUTO_RIGHT_ANGLE_SIDE = 0.45;
/** 角弧的半径。 */
export const MARK_ARC_RADIUS = 0.9;
/** 角弧默认采样多少段（8 段足够看出是弧，又不至于让作答数据变大）。 */
export const MARK_ARC_SEGMENTS = 8;

/**
 * 两点连线的**单位**方向。
 *
 * 🔴 退化的根因只有这一个，就在这里挡掉 ⇒ 上面五个函数不必各写一遍阈值
 *   （五份阈值迟早对不上，而"这一处挡住了那一处没挡"的表现是画布上出现 NaN）。
 */
function unitOf(a: Pt, b: Pt): Pt | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!(len >= MARK_MIN_SPAN)) return null;   // ⚠️ 写成 `!(len >= …)` 是为了把 NaN 一起挡掉
  return [dx / len, dy / len];
}

/** 等号：那条边的**中点**上一道**垂直于边**的短斜线 ⇒ 它的两个端点。 */
export function equalMarkOf(a: Pt, b: Pt): [Pt, Pt] | null {
  const u = unitOf(a, b);
  if (!u) return null;
  const mid: Pt = [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)];
  const n: Pt = [-u[1], u[0]];                       // 边的法向
  const half = MARK_TICK_LEN / 2;
  return [
    [round(mid[0] - n[0] * half), round(mid[1] - n[1] * half)],
    [round(mid[0] + n[0] * half), round(mid[1] + n[1] * half)],
  ];
}

/** 平行记号：那条边的**中点**上、**沿着边**的一根短线（两端各一个箭头）⇒ 它的两个端点。 */
export function parallelMarkOf(a: Pt, b: Pt): [Pt, Pt] | null {
  const u = unitOf(a, b);
  if (!u) return null;
  const mid: Pt = [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)];
  const half = MARK_ARROW_LEN / 2;
  return [
    [round(mid[0] - u[0] * half), round(mid[1] - u[1] * half)],
    [round(mid[0] + u[0] * half), round(mid[1] + u[1] * half)],
  ];
}

/** 直角小方块：从顶点沿两条边各走 `MARK_SQUARE_SIDE` ⇒ 角内那三个拐点（开口折线）。 */
export function rightAngleOf(vertex: Pt, a: Pt, b: Pt): Pt[] | null {
  const u1 = unitOf(vertex, a);
  const u2 = unitOf(vertex, b);
  if (!u1 || !u2) return null;
  const s = MARK_SQUARE_SIDE;
  return [
    [round(vertex[0] + u1[0] * s), round(vertex[1] + u1[1] * s)],
    [round(vertex[0] + (u1[0] + u2[0]) * s), round(vertex[1] + (u1[1] + u2[1]) * s)],
    [round(vertex[0] + u2[0] * s), round(vertex[1] + u2[1] * s)],
  ];
}

/** 相邻边确实垂直时才返回一个小直角方框；否则不显示任何提示。 */
export function rightAngleCornerOf(vertex: Pt, a: Pt, b: Pt): Pt[] | null {
  const u1 = unitOf(vertex, a);
  const u2 = unitOf(vertex, b);
  if (!u1 || !u2 || Math.abs(u1[0] * u2[0] + u1[1] * u2[1]) > 0.02) return null;
  const s = AUTO_RIGHT_ANGLE_SIDE;
  return [
    [round(vertex[0] + u1[0] * s), round(vertex[1] + u1[1] * s)],
    [round(vertex[0] + (u1[0] + u2[0]) * s), round(vertex[1] + (u1[1] + u2[1]) * s)],
    [round(vertex[0] + u2[0] * s), round(vertex[1] + u2[1] * s)],
  ];
}

/**
 * 角弧那条**折线**（画板与教师预览**共用**它 —— 两个渲染端各推一套算法迟早分叉）。
 *
 * 🔴 走的是**小弧**：`delta` 归一化到 `(-π, π]`。学生点 a / b 的先后不影响结果
 *   （两个方向得到的是同一段弧，只是遍历方向相反），这一点必须成立 ——
 *   否则"先点哪条边"会决定画出 90° 还是 270°，而屏幕上只是"看起来不太对"。
 */
export function arcPathOf(vertex: Pt, a: Pt, b: Pt, segments = MARK_ARC_SEGMENTS): Pt[] | null {
  const u1 = unitOf(vertex, a);
  const u2 = unitOf(vertex, b);
  if (!u1 || !u2) return null;
  const start = Math.atan2(u1[1], u1[0]);
  let delta = Math.atan2(u2[1], u2[0]) - start;
  // 归一化到 (-π, π]（用 `while` 而不是 `%`：`%` 对负数的结果在各语言里不一样）。
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  const points: Pt[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = start + (delta * i) / segments;
    points.push([
      round(vertex[0] + Math.cos(angle) * MARK_ARC_RADIUS),
      round(vertex[1] + Math.sin(angle) * MARK_ARC_RADIUS),
    ]);
  }
  return points;
}

/**
 * 角弧上那个数字（度数）写在哪：顶点沿**角平分线**方向 `MARK_ARC_RADIUS * 1.8` 处。
 *
 * 🔴 两条边**反向**（学生把它点成了一根平角）时单位向量之和是零向量 ⇒ 回 `null`，
 *   调用方**不写**那个数字。⚠️ 不许"回落到顶点" —— 那会把数字糊在顶点上，
 *   看起来像画错了，而学生只会以为是自己点歪了。
 */
export function arcLabelAt(vertex: Pt, a: Pt, b: Pt): Pt | null {
  const u1 = unitOf(vertex, a);
  const u2 = unitOf(vertex, b);
  if (!u1 || !u2) return null;
  const bx = u1[0] + u2[0];
  const by = u1[1] + u2[1];
  const len = Math.hypot(bx, by);
  if (!(len >= 1e-6)) return null;
  const d = MARK_ARC_RADIUS * 1.8;
  return [round(vertex[0] + (bx / len) * d), round(vertex[1] + (by / len) * d)];
}

/*
 * ★ 2026-10-07（教师）：教师上传的几何题原图当**底图** —— 摆位。
 */

/**
 * 画板的**单位框**（`[左, 上, 右, 下]`）。
 *
 * 🔴 **不许改这个数**：教师端预览的投影是照它**硬编码**的
 *   （`drawing-document-preview.tsx` 的 `((x + 10) / 20) * width`），
 *   而存档里所有坐标都是按这个框存的 ⇒ 改框等于把所有历史作答挪个位置。
 */
export const MATH_BOX: readonly [number, number, number, number] = [-10, 8, 10, -8];

/**
 * 把内容包围框扩展成与真实画布完全相同的宽高比，并保留固定像素安全边距。
 * 先做这一步再交给 JSXGraph，避免它依据“上一次缩放”的 unitX/unitY 二次推导而裁掉边缘。
 */
export function fitMathBoundingBox(
  points: Pt[],
  viewportWidth: number,
  viewportHeight: number,
  paddingPx = 48,
): [number, number, number, number] {
  if (points.length === 0) return [...MATH_BOX];
  const width = Math.max(80, viewportWidth);
  const height = Math.max(80, viewportHeight);
  const inset = Math.min(paddingPx, width * 0.2, height * 0.2);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const contentWidth = Math.max(0.5, maxX - minX);
  const contentHeight = Math.max(0.5, maxY - minY);
  const unitsPerPixel = Math.max(
    contentWidth / Math.max(1, width - inset * 2),
    contentHeight / Math.max(1, height - inset * 2),
  );
  const viewWidth = unitsPerPixel * width;
  const viewHeight = unitsPerPixel * height;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return [
    centerX - viewWidth / 2,
    centerY + viewHeight / 2,
    centerX + viewWidth / 2,
    centerY - viewHeight / 2,
  ];
}

/**
 * 底图放进画板时的 **[锚点, 尺寸]** —— jsxgraph 的 `create('image', …)` 要的就是这个形状。
 *
 * 🔴 **不是两个角！** 我第一版按「左下角 + 右上角」写，那是**错的**：
 *   `createImage` 把 `parents[1]` 当**左下角锚点**、`parents[2]` 当 **[宽, 高]**
 *   （`src/base/image.js` 的类文档逐字：「user coordinates of the **lower left corner**」+
 *   「`size` defines the image's **width and height** in user coordinates」；
 *   构造里 `this.W = createFunction(size[0])`、`this.H = createFunction(size[1])`）。
 *   传两个角进去 ⇒ 宽高会变成"右上角那两个数" ⇒ 图缩成一半、挤在左下角，
 *   **而屏幕上只是"图小了、偏了"，不报错**。
 *   ⚠️ 这条错最初还被我当成"已核事实"写进了 spec —— 教训是：**"核过"要核到构造函数的赋值那一行**。
 *
 * 🔴 `contain` + 居中：等比缩放到**装得进** `MATH_BOX`，两侧（或上下）留白。
 *   **不许拉伸** —— 现在走 CSS 的 `background-size: 100% 100%`，教师传的原图比例一变就变形，
 *   而变形在几何题上是**有含义的错误**（直角看起来不是直角）。
 *   ⚠️ 代价：原图与 5:4 差得远时留白。留白是可见、可理解的（"老师给的图比画布窄"）。
 *
 * `aspect` = 图片的 宽/高。量不出来（`NaN` / `0` / 负数）⇒ 回落成画板框自己的比例
 *   —— ⚠️ **不许**算出 NaN 再交给画板（那会让整张图画没，且不报错）。
 */
export function backgroundPlacement(aspect: number): { anchor: Pt; size: Pt } {
  const [left, top, right, bottom] = MATH_BOX;
  const boxW = right - left;
  const boxH = top - bottom;
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : boxW / boxH;
  let w = boxW;
  let h = w / ratio;
  if (h > boxH) { h = boxH; w = h * ratio; }
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  return {
    // 左下角（jsxgraph 的锚点就是这一个点）
    anchor: [round(cx - w / 2), round(cy - h / 2)],
    // [宽, 高]（用户坐标）—— **不是**右上角
    size: [round(w), round(h)],
  };
}
