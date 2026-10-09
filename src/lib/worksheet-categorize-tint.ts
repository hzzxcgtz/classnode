/**
 * 「分类达人」条目块的**底纹色** —— 纯函数，不 import React / DOM / CSS。
 *
 * ★ 2026-10-08（教师）：「这些文字块可以设计得好看一些，比如不带边框、带底纹色的文字，
 *   放到不同容器后会有相应的变化。」（教师选定：**跟着容器染不同的色**。）
 *
 * ── 为什么色值在 TS 里、而不是写成 CSS 类 ──────────────────────────────────
 * 框的数量与顺序**由题目数据决定**（`zones` 是数组，可能 2 个也可能 6 个），
 * 写不出固定数量的类名。所以按**序号**取一档色，经内联 CSS 变量 `--categorize-tint`
 * 下到条目块上；CSS 那边只有一句 `background: var(--categorize-tint)`。
 *
 * ── 色值怎么来的 ────────────────────────────────────────────────────────────
 * 取自与仪表盘同一套**协调过的**色相（蓝 / 赭 / 绿 / 紫 / 绯 / 天蓝），但都压到
 * 「浅底 + 深字」那一档：条目块里是**正文**，底色只是识别用，不能抢字。
 * ⚠️ 池子（待归类）刻意是**中性灰** —— 它的语义是"还没归类"，不该是第 7 种颜色；
 *   而且它与任一框色放在一起都要能看出区别（灰没有色相，天然满足）。
 *
 * 🔴 这里**不能**用 `color-mix()` 之类从主色算淡色：学生端兼容门禁
 *   （`scripts/check-classroom-browser-compat.mjs`）禁用 `color-mix(`，
 *   老 iPad 的 Safari 15 也不支持。所以逐档写死。
 */

/** 六个框的底纹色，按框的序号循环取用。 */
export const CATEGORIZE_ZONE_TINTS: readonly string[] = [
  '#dce9f7', // 蓝
  '#f7e9cf', // 赭
  '#d9f0e3', // 绿
  '#e8e1f8', // 紫
  '#f8dfe6', // 绯
  '#d8ecf7', // 天蓝
];

/** 「待归类」池子里的底纹色 —— 中性，表示"还没有归属"。 */
export const CATEGORIZE_POOL_TINT = '#eceff3';

/**
 * 第 `index` 个框的底纹色（**按序号循环**，超出六档就绕回来）。
 *
 * ⚠️ 负数与非整数一律按第一档处理 —— 框的序号来自数组下标，正常不会是这些；
 *   真出现了也不该让整块作答区因为一个坏色值而渲染不出来。
 */
export function zoneTint(index: number): string {
  if (!Number.isInteger(index) || index < 0) return CATEGORIZE_ZONE_TINTS[0];
  return CATEGORIZE_ZONE_TINTS[index % CATEGORIZE_ZONE_TINTS.length];
}
