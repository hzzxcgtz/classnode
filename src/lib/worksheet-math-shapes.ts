/**
 * 数学作图的**图形构造**（★ 2026-10-06，教师：「1-5 先补，还要有自由线条」）。
 *
 * 🔴 这个文件是**纯函数**（不 import React / jsxgraph）：画板只负责手势与渲染，
 *    「两个点怎么变成一个长方形」「三个点怎么变成角平分线」这类几何全在这里，
 *    因此能被 `node --test` 直接验（本仓没有前端测试框架）。
 *
 * 数据形状（存进 `drawing.data.elements`）**只有六种**，全部是普通坐标数组：
 *   point / segment·line·arrow / circle / polyline（闭合与否） / angle / label
 * ⇒ 教师预览、快照、AI 那三处各写一个 switch 就够，不需要理解图形语义。
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
  | { kind: 'parallelMark'; a: Pt; b: Pt };

/** 工具名（先声明成联合类型，表里才能给每个成员一个可选的 `drag`）。 */
export type MathTool =
  | 'point' | 'segment' | 'arrow' | 'circle' | 'free'
  | 'triangle' | 'rectangle' | 'parallelogram' | 'trapezoid'
  | 'angleArc' | 'rightAngle' | 'equalMark' | 'parallelMark'
  | 'label' | 'select';

/** 工具条上的**分组**（★ 2026-10-06 教师：「整个工具栏 UI 重新设计一下，归类要科学」）。 */
export const MATH_TOOL_GROUPS = [
  { value: 'basic', label: '基础' },
  { value: 'polygon', label: '多边形' },
  { value: 'mark', label: '标注' },
  { value: 'other', label: '其他' },
] as const;

export type MathToolGroup = (typeof MATH_TOOL_GROUPS)[number]['value'];

/**
 * 工具表。`clicks` = 完成一个图形要点击的次数；`drag: true` = **按住拖动**就能画
 * （两点即可确定的图形，见 `toolHintOf` 里那段 2026-10-06 的教师批注）。
 *
 * ⊘ 2026-10-06 第二版（教师划掉了五个）：「直线 / 正方形 / 中点 / 垂直平分线 / 角平分线」
 *   **不要了** —— 小学初中作图题基本用不上，留着只会让学生在工具条上多做一次选择。
 *   ⚠️ 连带删掉的还有它们的几何实现（`squareOf` / `midpointOf` /
 *   `perpendicularBisectorOf` / `bisectorEndOf`）—— **不许留没有入口的死代码**
 *   （本仓的规矩：死代码会被人当成「还有人用」而不敢动）。
 *
 * ⊘ ★ 2026-10-07（教师）又划掉了三个：「平行线 / 垂线 / 角」。理由与上一版不同，
 *   是**底图**这条主线带来的：
 *   · 平行线/垂线的参照线只在自己画的线里找（`math-drawing.tsx` 的 `runtime.current`），
 *     而**底图上的边不是画板对象** ⇒ 学生站在老师给的几何图前面点它，**什么都不发生**，
 *     屏幕上也不解释（本仓最怕的静默 no-op）；
 *   · 「角」画的是**两条臂 + 一段弧**，而底图上那两条边已经在图里，再描一遍是多余的。
 *   ⚠️ `lineThrough` 跟着删了（连同它那两个只服务它的帮手）。
 *   ⚠️ 连带的一个结论值得记下来：删完之后这一档**只剩「选择」一个工具依赖"画板里已有什么"**，
 *     其余工具全是"点 N 个位置"⇒ 底图上与空白画布上行为完全一致，
 *     不需要任何"按有没有底图"的分叉。
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
  { value: 'point', label: '点', clicks: 1, group: 'basic' },
  { value: 'segment', label: '线段', clicks: 2, drag: true, group: 'basic' },
  { value: 'arrow', label: '射线', clicks: 2, drag: true, group: 'basic' },
  { value: 'circle', label: '圆', clicks: 2, drag: true, group: 'basic' },
  { value: 'triangle', label: '三角形', clicks: 3, group: 'polygon' },
  { value: 'rectangle', label: '长方形', clicks: 2, drag: true, group: 'polygon' },
  { value: 'parallelogram', label: '平行四边形', clicks: 3, group: 'polygon' },
  { value: 'trapezoid', label: '梯形', clicks: 4, group: 'polygon' },
  /*
   * ★ 2026-10-07（教师）：「这是几何题的行话」—— 直角□ / 等号 / 平行∥ / 角弧。
   *
   * 🔴 四个都是「**点 N 个位置**」，一个都不依赖"画板里已有的对象"。
   *   理由：底图上的边**不是画板对象** —— 把「等号」做成"点一下那条线段"会犯跟
   *   平行线/垂线一模一样的毛病（点了静默无反应），而这两个记号正是教师明确要的。
   *
   * 🔴 两个三击记号的点击顺序**必须一样**：`[一条边上, 顶点, 另一条边上]`（顶点在第二下），
   *   与现有「角」同形（`buildEntry` 的 `case 'angle'` 就是 `[ats[0], ats[1], ats[2]]`）。
   *   两种顺序共存的话，学生点错的表现是"记号长到了错的地方"，不报错。
   *   ⚠️ 数据形状里字段的**书写顺序**与点击顺序是两件事，别混。
   */
  { value: 'angleArc', label: '角弧', clicks: 3, group: 'mark' },
  { value: 'rightAngle', label: '直角', clicks: 3, group: 'mark' },
  { value: 'equalMark', label: '等号', clicks: 2, group: 'mark' },
  { value: 'parallelMark', label: '平行', clicks: 2, group: 'mark' },
  { value: 'free', label: '自由线条', clicks: 0, group: 'other' },
  { value: 'label', label: '文字', clicks: 1, group: 'other' },
];

/**
 * 每个工具的**图标**（24×24 的 `d` 串，线性描边、`currentColor`）。
 *
 * 🔴 一个都不能少：有用例逐个点名（`MATH_TOOL_ICONS[tool]` 必须是非空字符串）——
 * 缺图标的按钮在屏幕上只是「少了一小块」，没人会报 bug。
 * ⚠️ 图标是**几何示意**，不是写实画：线段两端带点、射线带箭头、平行线两条斜线、
 *    垂线画成 T —— 目标是在一排 14 个按钮里一眼分得出来，而不是好看。
 */
export const MATH_TOOL_ICONS: Record<MathTool, string> = {
  point: 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 1 0 0-5.6',
  segment: 'M5 18 L19 6 M5 18 m-1.8 0 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0 M19 6 m-1.8 0 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0',
  arrow: 'M4 19 L18 6 M18 6 l-4.5 1 M18 6 l-1 4.5',
  circle: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 1 0 0-17 M12 11.4a0.6 0.6 0 1 0 0 1.2 0.6 0.6 0 1 0 0-1.2',
  triangle: 'M12 4 L20 19 L4 19 Z',
  rectangle: 'M4 6.5 h16 v11 H4 Z',
  parallelogram: 'M8 6.5 h12 l-4 11 H4 Z',
  trapezoid: 'M7 6.5 h10 l3 11 H4 Z',
  // ⚠️ 这两撇是原来 `parallel`（已被砍掉）的图标，字形 `M6 4.5 L10 19.5 M14 4.5 L18 19.5` ——
  //    它就是 `∥` 的字形，2026-10-07 原样挪给**新**的「平行记号」用。
  parallelMark: 'M6 4.5 L10 19.5 M14 4.5 L18 19.5',
  // 角弧：两条边只画一小截，重点是中间那段弧。
  angleArc: 'M5 19 L14.5 5 M5 19 L20 15.5 M9 17.4 A5 5 0 0 0 12.2 13.4',
  // 直角：一个角加里头的那个小方块。
  rightAngle: 'M6 5.5 V18 H19 M6 13.5 H10.5 V18',
  // 等号：一条边 + 横穿它的一道短斜线。
  equalMark: 'M4 15.5 L20 8.5 M10.2 7.9 L13.8 16.1',
  free: 'M3 16.5c2.5-7 4.5 3.5 7-2s4 3.5 7-2.5',
  label: 'M6 6 h12 M12 6 V19',
  select: 'M5.5 3.5 l13 7.5 -5.5 1 3.5 6.5 -2.8 1.3 -3.4-6.5 -4.8 3.4 Z',
};

/** 工具条上要显示的分组（只保留真有工具的那些组，顺序跟着 `MATH_TOOL_GROUPS`）。 */
export function toolsInGroup(group: MathToolGroup): typeof MATH_TOOLS {
  return MATH_TOOLS.filter((tool) => tool.group === group);
}

/** 每个工具在工具条上要说的那句话（含要点几下 / 要不要拖动）。 */
export function toolHintOf(tool: MathTool): string {
  if (tool === 'free') return '按住拖动即可自由画线';
  // ★ 2026-10-06（教师）：「能不能在画图时使用拖拽的方式，不要用不同位置点鼠标的方式」
  // ⇒ 两点就能定的图形（线段/直线/射线/圆/长方形/正方形）改成**按住拖动**，
  //    三点以上才能定的（三角形、梯形、角、平分线……）只能继续多点，这是几何本身决定的。
  if (MATH_TOOLS.find((item) => item.value === tool)?.drag) return '按住拖动即可画出这个图形';
  const clicks = MATH_TOOLS.find((item) => item.value === tool)?.clicks ?? 1;
  if (tool === 'point') return '点击画板添加点';
  if (tool === 'label') return '先在右边写好文字，再点画板放置';
  if (tool === 'select') return '点一下图形选中它，再点右边的「删除选中」；点空白处取消';
  if (tool === 'trapezoid') return '依次点击四个顶点（上底、下底各自平行）';
  /*
   * ★ 2026-10-07 四个记号。两个三击记号说的是**同一件事的顺序**（顶点在第二下）——
   * 照抄那半句，别各写各的：两种顺序共存的话学生一定会点错，
   * 而表现是"记号长到了错的地方"，不报错。
   */
  if (tool === 'angleArc') return '依次点：一条边上、顶点、另一条边上';
  if (tool === 'rightAngle') return '依次点：一条边上、顶点、另一条边上（标直角）';
  if (tool === 'equalMark') return '沿着那条边点两下，标上相等记号';
  if (tool === 'parallelMark') return '沿着那条边点两下，标上平行记号';
  return `依次点击 ${clicks} 个位置完成图形`;
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

export function parallelogramOf(a: Pt, b: Pt, c: Pt): Pt[] {
  return [
    [round(a[0]), round(a[1])],
    [round(b[0]), round(b[1])],
    [round(c[0]), round(c[1])],
    [round(a[0] + c[0] - b[0]), round(a[1] + c[1] - b[1])],
  ];
}

/** 梯形：四个顶点原样（学生自己点上底/下底，我们**不**替他"摆正" —— 那不叫梯形题了）。 */
export function trapezoidOf(points: Pt[]): Pt[] {
  return points.slice(0, 4).map(([x, y]) => [round(x), round(y)] as Pt);
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
