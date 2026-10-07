/**
 * 流程图**节点形状**的几何 —— 现在只有一件事：**「左上那一点」在哪儿**。
 *
 * ★ 2026-10-07（教师，四张图）：四种图形的删除按钮都要压在**箭头所指的位置**上。
 *   而在那之前，四个图形用的都是同一个「外接框的左上角」——
 *
 *   🔴 那个角**只有矩形落在轮廓上**：
 *      · 菱形那个角在图形**外面一大截**（它最左上的一点其实是**左顶点**）；
 *      · 平行四边形的上边被 `skew(-10deg)` 推到右边去了（框角悬空）；
 *      · 胶囊的框角落在圆弧外面（轮廓在那儿是弯的）。
 *      ⇒ 教师的原话是「切记**要压在图形的线条上**」（2026-10-06 就说过一次），
 *        这一版把「左上」按**每种形状自己的轮廓**取。
 *
 * ⚠️ 纯函数、不 import 任何东西：`worksheet-flowchart-node.test.ts` 里逐形状验
 *    「这个点**确实在轮廓上**」（不是验几个坐标数字 —— 数字会变，轮廓不会）。
 */

/** 一个盒子（左上角 + 尺寸）—— 与 `worksheet-flowchart-edge.ts` 里那份同形。 */
export interface FlowNodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 平行四边形那个斜角的**度数**（样式表里的 `skew(-10deg)`）。
 * ⚠️ 与 CSS **对拍**：`flowchart-node-corner.test.ts` 把两边现读现比 —— 改了一边另一边当场红。
 *    这个数决定「左上顶点往右偏多少」（`高度/2 × tan`）。
 */
export const FLOW_IO_SKEW_DEG = 10;

/**
 * 胶囊（开始/结束）左半圆上取哪一点：**45°**。
 * 它是「离外接框左上角最近的、又确实落在圆弧上」的那一点（`1 - cos45° ≈ 0.293` 个半径）。
 */
const FLOW_TERMINATOR_CORNER = 1 - Math.SQRT1_2;

/**
 * 节点**左上那一点**（流坐标）—— 删除按钮压在这儿（教师 2026-10-07 的四张图）。
 *
 * | 形状 | 取哪儿 | 为什么 |
 * |---|---|---|
 * | 矩形 | 外接框的左上角 | 它本来就在轮廓上 |
 * | 菱形 | **左顶点** | 框角在图形外面一大截；菱形最靠左上的轮廓点就是左顶点 |
 * | 平行四边形 | **左上顶点** | 上边被 skew 推到右边去了（偏 `高度/2 × tan10°`） |
 * | 胶囊 | 左半圆上的 **45°** 点 | 框角落在圆弧外；45° 那点离框角最近又贴着线 |
 *
 * ⚠️ 认不出来的 kind（含 `junction` 那颗小圆点）一律退回**框角** —— 与老行为一致，
 *    也正好是那个小方块的角。
 */
export function flowNodeCornerPoint(box: FlowNodeBox, kind: string): { x: number; y: number } {
  if (kind === 'decision') return { x: box.x, y: box.y + box.height / 2 };
  if (kind === 'io') {
    const shift = (box.height / 2) * Math.tan((FLOW_IO_SKEW_DEG * Math.PI) / 180);
    return { x: box.x + shift, y: box.y };
  }
  if (kind === 'terminator') {
    /* 胶囊的半径：`border-radius: 999px` ⇒ 短边的一半（宽比高长时就是半个高）。 */
    const radius = Math.min(box.height, box.width) / 2;
    const diagonal = radius * FLOW_TERMINATOR_CORNER;
    return { x: box.x + diagonal, y: box.y + diagonal };
  }
  return { x: box.x, y: box.y };
}
