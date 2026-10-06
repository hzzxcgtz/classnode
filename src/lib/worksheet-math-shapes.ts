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
  | { kind: 'angle'; vertex: Pt; a: Pt; b: Pt }
  | { kind: 'label'; at: Pt; text: string };

/** 工具名（先声明成联合类型，表里才能给每个成员一个可选的 `drag`）。 */
export type MathTool =
  | 'point' | 'segment' | 'arrow' | 'circle' | 'free'
  | 'triangle' | 'rectangle' | 'parallelogram' | 'trapezoid'
  | 'angle' | 'parallel' | 'perpendicular'
  | 'label' | 'select';

/** 工具条上的**分组**（★ 2026-10-06 教师：「整个工具栏 UI 重新设计一下，归类要科学」）。 */
export const MATH_TOOL_GROUPS = [
  { value: 'basic', label: '基础' },
  { value: 'polygon', label: '多边形' },
  { value: 'angle', label: '角与线' },
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
 */
export const MATH_TOOLS: ReadonlyArray<{
  value: MathTool;
  label: string;
  clicks: number;
  drag?: true;
  group: MathToolGroup;
}> = [
  { value: 'point', label: '点', clicks: 1, group: 'basic' },
  { value: 'segment', label: '线段', clicks: 2, drag: true, group: 'basic' },
  { value: 'arrow', label: '射线', clicks: 2, drag: true, group: 'basic' },
  { value: 'circle', label: '圆', clicks: 2, drag: true, group: 'basic' },
  { value: 'triangle', label: '三角形', clicks: 3, group: 'polygon' },
  { value: 'rectangle', label: '长方形', clicks: 2, drag: true, group: 'polygon' },
  { value: 'parallelogram', label: '平行四边形', clicks: 3, group: 'polygon' },
  { value: 'trapezoid', label: '梯形', clicks: 4, group: 'polygon' },
  { value: 'angle', label: '角', clicks: 3, group: 'angle' },
  { value: 'parallel', label: '平行线', clicks: 1, group: 'angle' },
  { value: 'perpendicular', label: '垂线', clicks: 1, group: 'angle' },
  { value: 'free', label: '自由线条', clicks: 0, group: 'other' },
  { value: 'label', label: '文字', clicks: 1, group: 'other' },
  { value: 'select', label: '选择', clicks: 1, group: 'other' },
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
  angle: 'M5 19 L19 19 M5 19 L15.5 5.5 M9 19 A4.5 4.5 0 0 0 12.4 14.4',
  parallel: 'M6 4.5 L10 19.5 M14 4.5 L18 19.5',
  perpendicular: 'M4 19 h16 M12 19 V4.5',
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
  if (tool === 'parallel') return '先画一条线段或直线，再点一个位置作它的平行线';
  if (tool === 'perpendicular') return '先画一条线段或直线，再点一个位置作它的垂线';
  if (tool === 'label') return '先在右边写好文字，再点画板放置';
  if (tool === 'select') return '点一下图形选中它，再点右边的「删除选中」；点空白处取消';
  if (tool === 'trapezoid') return '依次点击四个顶点（上底、下底各自平行）';
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

/** 从 a 指向 b 的单位向量（两点重合时回 [1,0]，避免 NaN 把整张图画崩）。 */
function directionOf(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return len === 0 ? [1, 0] : [dx / len, dy / len];
}

/** 以 `at` 为中心、沿 `dir` 方向、长度 `length` 的线段两个端点。 */
function segmentAlong(at: Pt, dir: Pt, length: number): [Pt, Pt] {
  return [
    [round(at[0] - dir[0] * length / 2), round(at[1] - dir[1] * length / 2)],
    [round(at[0] + dir[0] * length / 2), round(at[1] + dir[1] * length / 2)],
  ];
}

/**
 * 过 `through` 作 `ref`（一条已有线段/射线）的平行线或垂线。
 * `ref` 是 `[p, q]` 两个点；两点重合时回 `null`（说不清方向，宁可不画）。
 */
export function lineThrough(through: Pt, ref: [Pt, Pt], mode: 'parallel' | 'perpendicular', length = 12): [Pt, Pt] | null {
  const [p, q] = ref;
  if (p[0] === q[0] && p[1] === q[1]) return null;
  const [ux, uy] = directionOf(p, q);
  const dir: Pt = mode === 'parallel' ? [ux, uy] : [-uy, ux];
  return segmentAlong(through, dir, length);
}

