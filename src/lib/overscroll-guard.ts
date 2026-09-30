/**
 * 浮层里的**滚轮守卫** —— 滚到头之后不要把外面的页面一起滚（★ 2026-09-29，教师）。
 *
 * ── 🔴 为什么 CSS 不够（这是一个**实测**出来的结论，别再退回纯 CSS）─────────────
 * 第一版用的是 `overscroll-behavior: contain`（那是最正统的写法，本仓学生端也早就在用）。
 * 教师实测反馈：「**如果抽屉里本身没有垂直滚动条，它就会滚动抽屉外的页面**」。
 *
 * 原因是那个属性只在**真的发生了 overscroll** 时才起作用 —— 容器没有可滚余量时
 *（`scrollHeight === clientHeight`），浏览器不认为这是一次 overscroll，于是照旧往上传。
 * 而抽屉/弹窗**大多数时候内容都装得下**（截图那个抽屉里就两条消息）⇒ 最常遇到的那一半
 * 恰好是 CSS 治不了的那一半。
 * ⇒ 换成守卫：**从事件目标往上，看有没有哪一层还吃得下这个方向；一个都没有就
 * `preventDefault()`**。它不依赖任何 CSS 支持，也不依赖「有可滚余量」这个前提。
 *
 * ── 分工（两件东西都在，各治一半）──────────────────────────────────────────
 *   · CSS `overscroll-behavior: contain`（`globals.css` 里那段说明）—— 声明式，
 *     容器**有**可滚余量时在**边界**那一下生效，`JS` 没跑起来也还在；
 *   · 本文件 —— 容器**没有**可滚余量时的那一半，以及滚轮落在浮层**非滚动区**
 *     （标题栏、内边距）时的兜底。
 *   ⚠️ 两者都不许删：删了 CSS，边界那一下要靠 JS 兜（能用，但白丢一层）；
 *      删了 JS，教师报的那个形态当场回来。
 *
 * ── 判据的**纯**那一半在这一层 ──────────────────────────────────────────────
 * `consumesWheel` / `chainConsumesWheel` 不碰 DOM、不碰 React，`node --test` 直接跑
 *（先例：`worksheet-prompt-marks.ts`）。DOM 那一层只负责把每一层的**数字**量出来。
 *
 * ⚠️ 本文件在 `scripts/check-classroom-browser-compat.mjs` 的扫描根（`src/lib`）内：
 * 不得出现 `Object.hasOwn` / `structuredClone` / `findLast` / `.at(` / `:has(` /
 * `@container` / `content-visibility` / `color-mix(`，也不得出现正则 lookbehind。
 */

/**
 * 哪些元素算**浮层根**（守卫据此判断「这次滚轮在不在浮层里」）。
 *
 * 🔴 它是一份**选择器清单**，而不是在 38 处逐个标 `data-` 属性：`.modal-overlay` 一个类
 * 就有 28 个使用点，逐处加属性就是 28 个会各自漂移的地方。
 * ⚠️ 代价是「清单里的类被改名」会**静默**失效（守卫不再命中，屏幕上只是「老毛病回来了」）。
 * ⇒ `overscroll-guard.test.ts` 有一条用例去 `globals.css` 里核**每一个类都还在**。
 *
 * ⚠️ `data-overscroll-guard` 那一支是给**没有稳定类名**的根用的：CSS Modules 的类名会被
 * 哈希掉（`.drawer` / `.overlay`），内联样式的浮层则压根没有类。
 */
export const FLOAT_ROOT_SELECTOR = [
  '[data-overscroll-guard]',
  '.modal-overlay',
  '.modal-content',
  '.teacher-confirm-dialog',
  '.fullscreen-overlay',
  '.webapp-preview-dialog',
  '.worksheet-editor-dialog',
  '.worksheet-editor-preview-modal',
].join(', ');

/** 一层元素的滚动状态（从 DOM 量出来的那四个数）。 */
export interface ScrollMetrics {
  /** `getComputedStyle(el).overflowY` 的原样值（`auto` / `scroll` / `hidden` / `visible`…）。 */
  overflowY: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * 这一层**吃得下**这个方向的滚动吗。
 *
 * 三条缺一不可：
 *   ① 它得是个**滚动容器**（`overflow-y` 是 `auto` / `scroll` / `overlay`）。
 *      ⚠️ `hidden` **不算**：它裁掉内容，但用户滚不动它。
 *   ② 它**确实有可滚的余量**（`scrollHeight > clientHeight`）。
 *   ③ 那个余量**还在 `deltaY` 那一侧**（往下滚时下面还有、往上滚时上面还有）。
 *
 * 🔴 ② 就是教师报的那个 bug 的正面：没有余量 ⇒ 吃不掉 ⇒ 守卫拦住 ⇒ 页面不动。
 *    少了它，CSS 那一版的毛病会一模一样地回来。
 * 🔴 ③ 是「滚到底了不要再往外传」那一条。少了它，滚到边界就会往上传。
 */
export function consumesWheel(metrics: ScrollMetrics, deltaY: number): boolean {
  if (!/(auto|scroll|overlay)/.test(metrics.overflowY)) return false;
  const max = metrics.scrollHeight - metrics.clientHeight;
  if (max <= 0) return false;
  return deltaY < 0 ? metrics.scrollTop > 0 : metrics.scrollTop < max;
}

/**
 * 这一串祖先里，有没有谁吃得下。
 * @param chain 从**事件目标**往上、到浮层根为止（含两端）—— 顺序必须是「离目标最近的在前」，
 *   因为「有没有人吃得下」只关心存在性，而**判据本身**与顺序无关；顺序在用途上只影响可读性。
 *
 * ⚠️ `deltaY === 0`（只有横向滚动）一律算「吃得下」⇒ **不拦**：拦下来只会让浮层里的
 * 横向滚动（宽表格、代码块）连带页面的横向滚动一起失效，而纵向那件事与它无关。
 */
export function chainConsumesWheel(chain: readonly ScrollMetrics[], deltaY: number): boolean {
  if (deltaY === 0) return true;
  return chain.some((layer) => consumesWheel(layer, deltaY));
}

/** 量一层元素的滚动状态。 */
function metricsOf(el: Element): ScrollMetrics {
  const style = getComputedStyle(el);
  return {
    overflowY: style.overflowY,
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  };
}

/**
 * 装上那个**全局唯一**的滚轮守卫。返回卸载函数。
 *
 * ⚠️ 用**一个** document 级监听而不是每处浮层各挂一个：浮层有二十多个，而这件事的判据
 * 完全相同；每处一份就是二十多个会各自漂移的地方（本仓最防的那一类）。
 * ⚠️ 事件目标是 `Element` 之外的东西（文本节点在真实浏览器里会归一成元素，但别赌）⇒ 直接放手。
 * 🔴 `passive: false` **是必需的**：`wheel` 在 document 上默认按 passive 处理，
 * 那时 `preventDefault()` 会被静默忽略（控制台只给一句警告），看起来就像「守卫没生效」。
 */
export function installOverscrollGuard(doc: Document): () => void {
  const onWheel = (event: WheelEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // 不在任何浮层里 ⇒ 一个字都不管（页面正常滚动的路一点没碰）。
    const root = target.closest(FLOAT_ROOT_SELECTOR);
    if (!root) return;
    const chain: ScrollMetrics[] = [];
    for (let node: Element | null = target; node; node = node.parentElement) {
      chain.push(metricsOf(node));
      if (node === root) break;
    }
    if (!chainConsumesWheel(chain, event.deltaY)) event.preventDefault();
  };
  doc.addEventListener('wheel', onWheel, { passive: false });
  return () => doc.removeEventListener('wheel', onWheel);
}
