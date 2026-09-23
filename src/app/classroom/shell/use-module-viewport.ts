import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export interface UseModuleViewportOptions {
  /** 本模块此刻是不是「前台且已滑到位」—— 锁与测量都只在这个状态下生效。 */
  active: boolean;
  /** 模块最外层容器：可用高度写在这个元素上的 CSS 变量里。 */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * 承载可用高度的 CSS 变量名。**两个模块必须传同一个名字**（`--module-viewport-height`），
   * 这不是省事而是刻意的：同一时刻只有一个模块 `active`（外壳的 `activate` =
   * `phase.front === key && phase.settled`，而 `front` 只有一个值），共用意味着切换时
   * 不会出现「新面板的变量还没被设过」的那一帧 —— Safari 15 不认识 `100dvh`，兜底会
   * 退化成 `auto`，那一帧的高度就是错的。
   */
  cssVar: string;
}

/**
 * iPadOS 15 的 `100vh` **不随键盘变化**，而键盘弹出后 Safari 还会平移
 * `visualViewport` —— 这段处理把「键盘之后还剩多少可用高度」写进一个 CSS 变量，
 * 供模块面板把它当视口预算用。
 *
 * ⚠️ 这是一段**踩过坑**的代码，每条注释都是一次事故换来的。改动前请先读完整段。
 * 学伴面板与学习单面板共用它（§3-AB）—— 两个模块各写一套必然分叉：其中一个修了
 * bug 另一个没修。
 */
export function useModuleViewport({
  active,
  containerRef,
  cssVar,
}: UseModuleViewportOptions): void {
  // iPadOS 15 的 100vh 会包含 Safari 工具栏占用的区域。键盘弹出后
  // Safari 还会平移 visualViewport：保持页面起点不动，只把偏移量计入
  // 可用高度，避免在触摸滚动期间反复移动整个页面造成抖动。
  //
  // 面板常驻后「挂载」不再等于「可见」，这道锁改挂 active。
  // scrollLockRef 同时承担两件事：**证明锁是我们自己上的**，以及**记住加锁前的值**。
  // 它是幂等性的全部依据：
  //   · 只有「当前未持有锁」时才快照 —— cleanup 一定会先还原并把它置空，因此下一次
  //     激活读到的必然是加锁前的真实值，**永不可能是我们自己写进去的 'hidden'**；
  //   · 只有持有者才还原，且还原后立刻让出持有权。
  // React 保证同一 effect 的 cleanup 一定先于下一次 setup 运行，所以「重新激活」与
  // 「上一次的还原」不会交错：反复切走切回 N 次后，DOM 状态始终等于「最后一次 active
  // 的稳态」（隐藏 → 原值，可见 → 'hidden'），既不会把 'hidden' 越叠越深，也不会漏还原。
  // （真正会踩雷的是「只把 if (!active) return 塞进函数体、依赖仍留 []」：那样这道锁
  //   只在挂载时上一次，切走后无人释放 —— 面板又不再卸载 —— <body> 会在整堂课上永远
  //   停在 overflow:hidden。也就是说缺陷不在「往依赖里加 active」，而在**取锁与放锁
  //   必须成对挂在同一个状态上**；这条 ref 语义正是把这件事写死。）
  const scrollLockRef = useRef<{ body: string; html: string } | null>(null);
  useEffect(() => {
    const shell = containerRef.current;
    if (!active || !shell) return;
    const viewport = window.visualViewport;
    if (scrollLockRef.current === null) {
      scrollLockRef.current = {
        body: document.body.style.overflow,
        html: document.documentElement.style.overflow,
      };
    }
    let frame: number | null = null;
    let settleTimer: number | null = null;

    const updateViewportHeight = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visualHeight = viewport?.height || window.innerHeight;
        const visualOffsetTop = viewport?.offsetTop || 0;
        const height = Math.round(visualHeight + visualOffsetTop);
        shell.style.setProperty(cssVar, `${height}px`);
        frame = null;
      });
    };

    // Older WebKit may report offsetTop=0 in the first keyboard resize event
    // and correct it shortly afterwards. Re-measure once after the animation
    // settles instead of following every visualViewport scroll event.
    const updateAndSettle = () => {
      updateViewportHeight();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(updateViewportHeight, 120);
    };

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    updateAndSettle();
    window.addEventListener('resize', updateAndSettle);
    window.addEventListener('orientationchange', updateAndSettle);
    document.addEventListener('focusin', updateAndSettle);
    document.addEventListener('focusout', updateAndSettle);
    viewport?.addEventListener('resize', updateAndSettle);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      window.removeEventListener('resize', updateAndSettle);
      window.removeEventListener('orientationchange', updateAndSettle);
      document.removeEventListener('focusin', updateAndSettle);
      document.removeEventListener('focusout', updateAndSettle);
      viewport?.removeEventListener('resize', updateAndSettle);
      // 刻意**不**移除写进 shell 的那个 CSS 变量（`cssVar`）：面板不再卸载，把最后一次量到的高度留着，
      // 切回本模块时的第一帧就是正确高度（否则那一帧会落到 100dvh 兜底上，而 Safari 15
      // 不认识 dvh 会把整条声明丢弃 → 该帧高度退化为 auto）。下一次激活会立刻重新量。
      const saved = scrollLockRef.current;
      if (saved !== null) {
        document.body.style.overflow = saved.body;
        document.documentElement.style.overflow = saved.html;
        scrollLockRef.current = null;
      }
    };
    // 依赖只有 `active`，与搬家前逐字一致（不可顺手加依赖）：`containerRef` 是调用方的
    // `useRef` 对象、`cssVar` 在两端都是字符串字面量，两者身份恒定；把它们塞进依赖只会在
    // 名称变化时多跑一次「先放锁、再上锁」的滚动闪烁，而这条 effect 原本只认 `active`。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
