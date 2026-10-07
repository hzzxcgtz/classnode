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

/**
 * 「快接近竖直/水平」的**斜率上限**（正切）—— 约 8.5°。
 *
 * ★ 2026-10-07（教师，第二条要求）：「当变成一根直线以后，慢慢再拖动，**当快接近标准竖线或
 *   标准横线时，则自动矫正角度，将斜线变成真正的竖线和横线**」。
 *
 * 🔴 用**角度**而不是固定的像素数：同样偏 30px，在 300px 长的线上是 5.7°（该矫正），
 *    在 80px 长的线上是 20°（那是个真的斜线，不该硬掰）。固定阈值分不出这两种。
 * ⚠️ 矫正**只改线的画法**，一个节点都不动 —— 教师明确否掉了「把节点吸过去」那套
 *    （松手跳一下也是跳跃，他原话是「不行不行，这样还是会有跳跃」）。
 */
export const FLOW_SNAP_SLOPE = 0.15;

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
      const dx = params.targetX - params.sourceX;
      const dy = params.targetY - params.sourceY;
      /*
       * 「折线太短」与「斜得不多」其实是**同一件事的两个阶段**，取**更宽**的那个门槛：
       *   · `FLOW_STRAIGHT_SNAP`（12px）—— 折线的中间段短到看不见（2026-10-07 第一条要求）；
       *   · `|跨度| × FLOW_SNAP_SLOPE` —— 角度太正，画正了才好看（同一天的第二条要求）。
       * 短线时前者起作用（12px 已经是它长度的可观比例），长线时后者起作用（角度判据）。
       */
      const off = axis === 'v' ? dx : dy;
      const span = axis === 'v' ? dy : dx;
      const limit = Math.max(FLOW_STRAIGHT_SNAP, Math.abs(span) * FLOW_SNAP_SLOPE);
      if (Math.abs(off) <= limit) {
        /*
         * ★ 画**正**的：竖直的边走 source 的 x、水平的边走 source 的 y。
         *   端点因此落在 source 那条垂线（或水平线）上、横向偏 `|dx|` —— **节点一个都不动**。
         *   ⚠️ 别改成「连到 target 句柄」（那就是一条**歪**的直线，教师 2026-10-07 报的就是它）。
         */
        const endX = axis === 'v' ? params.sourceX : params.targetX;
        const endY = axis === 'v' ? params.targetY : params.sourceY;
        return [
          `M ${params.sourceX} ${params.sourceY} L ${endX} ${endY}`,
          (params.sourceX + endX) / 2,
          (params.sourceY + endY) / 2,
        ];
      }
    }
  }
  return smoothStep(params);
}
