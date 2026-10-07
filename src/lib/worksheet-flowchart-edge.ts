/**
 * 流程图**边**的几何 —— 现在只做一件事：**「折线太短就画成直线」**（★ 2026-10-07 教师）。
 *
 * 教师原话：「在移动某个图形时，**连接线接近直线时需要吸附成直线**，否则可能会出现一个
 * **非常小的拐角**，很难看」——「相当于是一个**微调**」。
 *
 * 🔴 那个「很小的拐角」是 `smoothstep` 的固有表现：它算出来的是「出一横一进」这种折线，
 *    而当两端 **x 差一点点**时，**中间那段横线只有几个像素**，看起来像打了个结。
 *    短到一定程度干脆画成一条直线，视觉上就干净了。
 *
 * ✅ 只在**两端句柄同向**（`bottom→top` 或 `right→left` 这类）时才判断 ——
 *    拐弯的边（比如从底边出、进左边）「直线化」只会更怪，那种边一律交给库。
 * ✅ 有**绕行点**（学生拖过控制柄）时一律交给库 —— 学生亲手调的走向不该被自动变直抹掉。
 * ✅ 路径是**每次渲染重算**的 ⇒ 拖动图形时它自动在「折线」与「直线」之间切换，
 *    这正是教师说的「微调」，不需要任何额外的时机钩子。
 *
 * ⚠️ 这个模块**不 import `@xyflow/react`**：库那份 import 了 React，纯 Node 下加载不了
 *    （本仓没有 jsdom，判据是纯函数级的）。真实的路径函数由调用方**注入**（见 `SmoothStepFn`）。
 */

/**
 * 「短到看不见」的阈值（流坐标）。
 *
 * 12px 大致是「一眼看得出是个拐弯」的下限：比它更短的横线（或竖线）在屏幕上就是个疙瘩。
 * ⚠️ 别拿它当 `ALIGN_TOLERANCE`（24，那个管的是「一键整理时的对齐」）—— 两件事的取舍不同：
 *    整理时宁可少吸，这里则是「短到看不清就不画」。
 */
export const FLOW_STRAIGHT_SNAP = 12;

/** 算路径需要的那几个数（与库的 `getSmoothStepPath` 入参**同形**，只是不依赖它）。 */
export interface FlowEdgeGeometryParams {
  sourceX: number;
  sourceY: number;
  sourcePosition: string;
  targetX: number;
  targetY: number;
  targetPosition: string;
  /** 绕行点（控制柄拖出来的）。**给了就一切照库**，不做任何直线化。 */
  centerX?: number;
  centerY?: number;
  offset?: number;
  borderRadius?: number;
}

/** 注入的库函数 —— 真的用 `getSmoothStepPath`，判据里用假的。 */
export type SmoothStepFn = (params: FlowEdgeGeometryParams) => [string, number, number];

/** 两端句柄是不是**同一条轴**上对着的（`bottom→top` / `top→bottom` / `right→left` / `left→right`）。 */
function isStraightPair(sourcePosition: string, targetPosition: string): 'v' | 'h' | null {
  const pair = `${sourcePosition}->${targetPosition}`;
  if (pair === 'bottom->top' || pair === 'top->bottom') return 'v';
  if (pair === 'right->left' || pair === 'left->right') return 'h';
  return null;
}

/**
 * 算一条边的路径：**几乎是直线（而且两端同向）就真的画成直线**，其余一律交给注入的库函数。
 * 返回值与 `getSmoothStepPath` 同形：`[path, labelX, labelY]`。
 */
export function flowEdgeGeometry(
  params: FlowEdgeGeometryParams,
  smoothStep: SmoothStepFn,
): [string, number, number] {
  const hasCenter = Number.isFinite(params.centerX) && Number.isFinite(params.centerY);
  if (!hasCenter) {
    const axis = isStraightPair(params.sourcePosition, params.targetPosition);
    if (axis !== null) {
      const delta = axis === 'v'
        ? Math.abs(params.targetX - params.sourceX)
        : Math.abs(params.targetY - params.sourceY);
      if (delta < FLOW_STRAIGHT_SNAP) {
        const midX = (params.sourceX + params.targetX) / 2;
        const midY = (params.sourceY + params.targetY) / 2;
        return [`M ${params.sourceX} ${params.sourceY} L ${params.targetX} ${params.targetY}`, midX, midY];
      }
    }
  }
  return smoothStep(params);
}
