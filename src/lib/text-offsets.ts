/**
 * 「绝对字符偏移 ⇄ 第几段第几个字符」—— 纯算术，**零 import**。
 *
 * ★ 2026-09-26。它存在的理由很具体：交付当天教师报「设完格式选区就没了，
 * 没法对同一段文字连续设两样格式」，而根因就是**两个坐标系混在一起**
 *（起点用「段内偏移」、终点用「从头数的偏移」）。详见 `text-offsets.test.ts` 的文件头。
 *
 * 🔴 所以这里只留**一个**方向：绝对偏移进来，(段, 段内偏移) 出去。
 * 起点与终点都走它 —— **同一个实现调用两次**，混坐标系这件事在结构上就做不到。
 * ⚠️ 别再写第二个「从起点往后数」的函数：那正是这个 bug 的形状。
 *
 * ⚠️ 本文件在 `scripts/check-classroom-browser-compat.mjs` 的扫描根（`src/lib`）内：
 * 不得出现 `Object.hasOwn` / `structuredClone` / `findLast` / `.at(` / `:has(` /
 * `@container` / `content-visibility` / `color-mix(`。
 */

export interface LocatedOffset {
  /** 第几段（下标）。 */
  index: number;
  /** 段内偏移（0..该段长度）。 */
  offset: number;
}

/**
 * 把绝对字符偏移映射到「第几段、段内偏移」。
 *
 * `lengths` 是各段的字符数（元素里那些文本节点的 `textContent.length`，按文档顺序）。
 *
 * 边界口径（每一条都被 `text-offsets.test.ts` 钉着）：
 *   · 一个字符都没有（`lengths` 为空）⇒ `null`（没有位置可言，调用方自己决定怎么办）；
 *   · 落在某段**末尾**（`offset === 该段长度`）⇒ 算作**这一段**的末端 ——
 *     它与「下一段的第 0 个字符」是同一个位置，取前者是为了让「起点与终点」两侧
 *     用同一条规则（否则一个取前一个取后，比较时又要多一条特例）；
 *   · 越界 / 负数 / 小数 / `NaN` ⇒ **夹紧**（到末尾 / 到开头 / 向下取整 / 到开头），
 *     不抛：这些值是从 DOM 选区算出来的，一次手抖就能拿到。
 */
export function locateInLengths(lengths: number[], offset: number): LocatedOffset | null {
  if (!Array.isArray(lengths) || lengths.length === 0) return null;
  let total = 0;
  for (let i = 0; i < lengths.length; i += 1) total += lengths[i];
  const at = typeof offset === 'number' && Number.isFinite(offset)
    ? Math.max(0, Math.min(Math.floor(offset), total))
    : 0;
  let remaining = at;
  for (let i = 0; i < lengths.length; i += 1) {
    if (remaining <= lengths[i]) return { index: i, offset: remaining };
    remaining -= lengths[i];
  }
  // 上面的循环对任何 `at <= total` 都会返回；这一行只是让类型完整（且真到了这里
  // 说明 `lengths` 里有负数或非整数 —— 那是调用方的问题，静默退到末尾更安全）。
  return { index: lengths.length - 1, offset: lengths[lengths.length - 1] };
}
