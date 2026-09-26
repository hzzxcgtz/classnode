'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/**
 * 触屏拖拽的 **pointer 那一层**（规格 §12 裁定 1 的后半句：「真拖拽增强」）。
 *
 * ── 这一层是**叠上去**的，不是必须的 ────────────────────────────────────────
 * 三个「条目型」题型的交互都能用「点条目 → 点目标」走完（`lib/worksheet-drag.ts` 的
 * `tapSource` / `setPair` / `setPlacement`，那半边**有自动化用例**）。本文件挂了、
 * 手势被系统抢走了、老 Safari 不认 pointer 事件 —— 学生照样做得完题。
 * 所以这里出任何问题都**不许**影响点选：两个通道各走各的事件，只在「落位」那一步
 * 汇到同一个回调上。
 *
 * ── 四件必须做对的事（每一条都对应下面一段代码）────────────────────────────
 *   ① `setPointerCapture` —— 手指移出元素之后 `pointermove` / `pointerup` 仍然送给它。
 *      不做的话「拖到一半滑出条目」就再也收不到 `pointerup`，元素**永久卡在拖动态**。
 *   ② `touch-action: none`（**静态** CSS 那一份才是真正的开关，见 `.dragSource` 的注释）。
 *      不设的话 iOS 把这一手势判成**滚动**：页面滚了，元素不跟手，且在滚动的瞬间收到
 *      `pointercancel`（拖拽当场作废）。
 *   ③ `pointerup` 与 `pointercancel` **都要清状态**。只处理前者 ⇒ 一次被系统中断的手势
 *      （来电、多任务手势、滚动接管）会把元素永久留在拖动态 —— 屏幕上看着它一直亮着。
 *   ④ 拖动过程中**不写 draft**：只在**落位那一下**调一次 `onDrop`。每一帧都写会打爆
 *      `use-worksheet-answers.ts` 的防抖队列（每一帧一条 PUT）。
 * ⚠️ M4b/C1：**同一份清单的第二个副本**在 `ink-canvas.tsx`（手写画布）的文件头 —— 裁定 5 的「复用纪律、**不共用实现**」⇒ 两处各有自己的 pointer 代码、会各自漂移：**改一处必须改另一处**。
 * ── 点选与拖拽为什么不会互相打架 ──────────────────────────────────────────
 * 点选走 `onClick`（原生事件，键盘 Enter 也能触发），拖拽走 pointer 事件。两者的分界是
 * **这一次手势有没有移动超过 `DRAG_THRESHOLD_PX`**：移动过 ⇒ 那一次 `click` 被吞掉
 * （否则「把 A 拖到 Z 上」会**同时**触发 Z 的点选落位，把上一次选中的那个条目放进 Z）。
 * 阈值而不是「有没有 pointermove」：手指按下时几乎总会带一两个像素的抖动，
 * 拿它当判据等于每一次点选都会被当成拖拽。
 *
 * ⚠️ **本文件在本机没有任何自动化能替它作证**（本仓没有 jsdom、没有 testing-library，
 * 触摸与滚动冲突只能真机验）。它**不得**在报告里被标绿，只能记「未验证」。
 */

/** 落点元素的属性名。组件只写它一个属性，找落点的事全在本文件里。 */
export const DROP_TARGET_ATTR = 'data-drop-id';

/** 超过这么多像素才算「拖」，否则算「点」。8 是老 iPad 上手指抖动与真拖动之间的经验值。 */
const DRAG_THRESHOLD_PX = 8;

/**
 * ★ 2026-09-26：拖动中每一帧交给调用方的那一个点（跟手的线 / 跟手的条目要用它）。
 *
 * ⚠️ **必须带上 `id`**：第一次回调是在「越过阈值的那一次 `pointermove`」里发出的，
 * 那一刻 `draggingId` 这个 state **还没进本次渲染的闭包**（本组件重新渲染要等这一次
 * 事件处理函数返回）。调用方想知道「拖的是谁」只能读这里。
 */
export interface DragPoint {
  /** 正在被拖的条目 id。 */
  id: string;
  /** 指针的客户端坐标（`pointermove` 原样 —— 与 `getBoundingClientRect` 同一坐标系）。 */
  x: number;
  y: number;
  /** 相对**手势起点**（`pointerdown` 那一刻）的位移。跟手的条目要的是 `dy` / `dx`。 */
  dx: number;
  dy: number;
}

export interface PointerDragOptions {
  /** 点了一下（没移动）时调它。id 由组件解释（连线的左项 / 归类的条目 /…）。 */
  onTap: (id: string) => void;
  /**
   * 落位：**移动过之后松手**时调它（移动没过阈值的那一下走 `onTap`）。**整个手势只调一次**。
   *
   * ★ 2026-09-26：`targetId` 可以是 **`null`**（拖到空白处松手）。
   * 在此之前「底下没有落点」是**根本不会调** `onDrop` 的，而那条规则对排序题是错的：
   * 它的落点由**让位算出来的槽位**决定（`order-body.tsx`），与手指底下有没有元素无关 ——
   * 而让位之后被拖那一项的**原槽位是空的**，手指底下常常什么都没有。
   * 照旧规则，症状是「拖到列表末尾松手，什么都不发生」。
   * ⇒ 现在由**每个题型自己**决定 `null` 是什么意思（连线/归类是「什么都不做」，
   * 排序是「照落位算出来的那一格落下」）。
   */
  onDrop: (sourceId: string, targetId: string | null) => void;
  /**
   * ★ 2026-09-26：拖动中**每一帧**（只在越过 `DRAG_THRESHOLD_PX` 之后，与拖动态同时开始）。
   *
   * 🔴 **不要在里面 `setState`。** 每帧一次 setState 会让整个作答面板每帧重渲一次 ——
   * 老 iPad 上直接掉帧，而这正是本仓「每帧的重算要限量」那条约束要防的东西。
   * 跟手的线 / 跟手的条目一律**直接写 DOM**（SVG 的 `x2 y2`、元素的内联 `transform`）。
   *
   * ⚠️ **第一次回调那一刻，DOM 还是拖动前的布局**（React 还没重渲，拖动态的类名也还没上）——
   * 要量尺寸就趁这一刻量，而且**只量这一次**：每帧读一堆 `getBoundingClientRect`
   * 会强制同步布局，那比 setState 更慢。
   */
  onDragMove?: (point: DragPoint) => void;
  /** 只读态（教师端预览）/ 已锁定的题：所有手势都不生效，但**不隐藏**任何东西。 */
  disabled?: boolean;
}

/** 挂在元素上的那一组事件。`sourceProps` 与 `targetProps` 给的是同一个形状。 */
export interface PointerDragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
}

export interface PointerDrag {
  /** 正在被拖的条目 id（组件用它画「拖动态」）。 */
  draggingId: string | null;
  /** 此刻手指底下的落点 id（组件用它高亮落点）。 */
  hoverTargetId: string | null;
  /** 拖拽源：可拖 + 可点。 */
  sourceProps: (id: string) => PointerDragHandlers;
  /** 落点：只能被拖过来 + 可点（**不能**作为拖拽源 —— 否则落点自己也能被拖起来）。 */
  targetProps: (id: string) => PointerDragHandlers & { 'data-drop-id': string };
}

/** 一次手势的全部状态。放在 ref 里，因为它在 `pointermove` 之间必须保持。 */
interface Gesture {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  el: HTMLElement | null;
}

/**
 * 手指底下有没有落点。找不到就 `null`（松手时按「没落位」处置）。
 *
 * ★ 2026-09-26：改成从**整摞**里挑第一个不是自己的，而不是「只看最上面那一个」。
 *
 * ── 为什么（这一条在改的时候是**纯重构**，到排序题跟手之后才变成承重的）────────
 * 排序题拖起来的那一项现在**跟手**（`order-body.tsx` 每帧写它的 `transform`），
 * 于是它**就压在手指底下**。而它自己也是一个落点（`data-drop-id` = 它自己的 id）——
 * 「只看最上面那一个」拿到的永远是它自己，`hoverTargetId` 恒为 `null`，
 * `pointerup` 时 `onDrop` **一次都调不到**：拖得动、放不下。
 * ⇒ 必须跳过自己，看见它下面那一条。
 *
 * ⚠️ `elementsFromPoint`（复数）在 Safari 11.1+ 有，老 iPad 的 15 上有；
 * 没有就退回单数的 `elementFromPoint`（那时行为与改之前**逐字相同** ——
 * 「最上面那一个恰好是自己」⇒ 返回 null，只是不再往下找）。
 * ⚠️ 「跳过自己」与旧版那句 `under !== gesture.id ? under : null` 是**同一条判据**，
 * 只是现在会继续往下找，而不是就此放弃。
 * ⚠️ 归类题的条目池 / 框、连线题的右项都不受影响：那三处的拖拽源**不是**落点，
 * 所以最上面那个带 `data-drop-id` 的祖先历来就是答案（旧版已经在靠 `closest` 往上找）。
 */
function findDropTarget(
  clientX: number,
  clientY: number,
  draggingId: string,
  draggingElement: HTMLElement | null,
): string | null {
  if (typeof document === 'undefined') return null;
  // 跟手的源元素会盖在落点之上。Safari 的 `elementFromPoint` 回退路径只能拿到最上层
  // 那一个，因此查询这一瞬间让源元素“穿透”；同步恢复后它仍保持 pointer capture，
  // 后续 move/up 不会丢。Chrome 的 `elementsFromPoint` 也走同一逻辑，避免两条路径漂移。
  const previousPointerEvents = draggingElement?.style.pointerEvents ?? '';
  if (draggingElement) draggingElement.style.pointerEvents = 'none';
  try {
    const stack: Element[] = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : (typeof document.elementFromPoint === 'function'
        ? [document.elementFromPoint(clientX, clientY)].filter((el): el is Element => el !== null)
        : []);
    for (const el of stack) {
      if (!el || typeof el.closest !== 'function') continue;
      // ⚠️ `closest` 而不是「直接看 el」：手指底下的几乎总是条目里的一个 `<span>`。
      // 用 `closest` 才能找到真正带 `data-drop-id` 的那一层。
      const holder = el.closest(`[${DROP_TARGET_ATTR}]`);
      if (!holder || typeof holder.getAttribute !== 'function') continue;
      const id = holder.getAttribute(DROP_TARGET_ATTR);
      // 自己不是自己的落点（自己高亮自己没有意义）。
      if (id === draggingId) continue;
      return id;
    }
    return null;
  } finally {
    if (draggingElement) draggingElement.style.pointerEvents = previousPointerEvents;
  }
}

export function usePointerDrag({ onTap, onDrop, onDragMove, disabled = false }: PointerDragOptions): PointerDrag {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  /** 落点的 ref 镜像：`pointerup` 那一刻必须读到**当下**的值（state 是异步的）。 */
  const hoverRef = useRef<string | null>(null);
  /**
   * 这一次手势**移动过**吗。它同时是「吞掉紧跟其后的那次 click」的判据 ——
   * 见文件头「点选与拖拽为什么不会互相打架」。
   */
  const movedRef = useRef(false);

  /** 收尾：清掉一切手势状态（`pointerup` / `pointercancel` / 卸载都走它）。 */
  const endGesture = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    hoverRef.current = null;
    setDraggingId(null);
    setHoverTargetId(null);
    if (!gesture || !gesture.el) return;
    // 把行内的 `touch-action` 还回去（空串 = 回到 CSS 类那一份）。
    gesture.el.style.touchAction = '';
    try {
      gesture.el.releasePointerCapture(gesture.pointerId);
    } catch {
      // 元素已经被卸载 / 指针已经没了。**必须吞掉**：这里抛出去会让后面几行不执行 ——
      // 而那正是「元素永久卡在拖动态」的来源。
    }
  }, []);

  // 卸载时收尾：拖到一半切走模块 / 面板被卸载（学生切 Tab、老师改了题重挂）时，
  // `pointerup` 永远等不到。⚠️ 这一条**不是**锦上添花：少它就会留下一个永远亮着的拖动态。
  useEffect(() => endGesture, [endGesture]);

  /**
   * 任何一次 `pointerdown`（在**任何**元素上）都把「上一次手势移动过」这个标记清掉。
   *
   * ⚠️ 为什么需要它（而不是只在源元素的 `onPointerDown` 里清）：落点元素上没有 pointer
   * 处理（它们只挂 `data-drop-id` 与点击），所以「拖完一次 → 点一下落点」这条路上，
   * 标记的清除会晚一步 —— 那一下点选会被当成刚才那次拖的余波**吞掉**（学生按了没反应，
   * 再按一次才好）。捕获阶段挂这一条，保证**每一次新手势都从干净的状态开始**。
   */
  useEffect(() => {
    const reset = () => { movedRef.current = false; };
    document.addEventListener('pointerdown', reset, true);
    return () => document.removeEventListener('pointerdown', reset, true);
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (disabled) return;
    // 只认主指针：第二根手指按下去不该打乱正在进行的这一手势。
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // 已经有一根手指在拖（多点触控：另一只手按到了别的条目上）⇒ 忽略这一次。
    if (gestureRef.current) return;
    movedRef.current = false;
    const el = event.currentTarget;
    gestureRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      el,
    };
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // 老 WebKit / 指针已经消失时会抛。没有捕获的代价只是「滑出元素后跟丢」，
      // 不该让这一次拖拽整个作废 —— 更不该让点选也一起失效。
    }
    // ⚠️ 这一行**不是** iOS 上的那个开关（`touch-action` 在手势开始的那一刻就定下来了，
    // 这里设已经晚了），真正的开关是 `.dragSource` 那条静态 CSS。留着它是因为
    // 「拖动态下不许滚动」这条语义在别处（桌面浏览器、第二次手势）也成立。
    el.style.touchAction = 'none';
    // ⚠️ 屏住事件冒泡：里层的条目与它所在的容器（归类题的条目池）都挂了手势，
    // 不挡住的话一次按下去会同时开两个手势。
    event.stopPropagation();
  }, [disabled]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.moved) {
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      gesture.moved = true;
      movedRef.current = true;
      // ★ 拖动态**此刻**才出现（不是按下的那一刻）：按下的那一刻还可能是点选，
      // 提前高亮会让学生以为「我一碰它就进入拖拽了」。
      setDraggingId(gesture.id);
    }
    const next = findDropTarget(event.clientX, event.clientY, gesture.id, gesture.el);
    if (hoverRef.current !== next) {
      hoverRef.current = next;
      setHoverTargetId(next);
    }
    // ★ 2026-09-26：跟手的线 / 跟手的条目在这一行。**它在 `setDraggingId` 之后、
    // 本次渲染之前** —— 那一刻的 DOM 还是拖动前的布局（见 `onDragMove` 的注释）。
    if (onDragMove) {
      onDragMove({
        id: gesture.id,
        x: event.clientX,
        y: event.clientY,
        dx: event.clientX - gesture.startX,
        dy: event.clientY - gesture.startY,
      });
    }
    event.stopPropagation();
  }, [onDragMove]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const { id, moved } = gesture;
    // pointermove 与 pointerup 之间仍可能跨过最后一个落点（尤其是鼠标快速甩入小填空槽）。
    // 松手坐标再命中一次，保证“看起来已经放在线上”的最后位置就是最终位置。
    const target = moved
      ? findDropTarget(event.clientX, event.clientY, id, gesture.el)
      : hoverRef.current;
    event.stopPropagation();
    // 先收尾再落位：`onDrop` 里会 setState（写 draft），而收尾也要 setState ——
    // 顺序反过来的话，落位那一次渲染里元素还带着「正在拖」的类名（闪一帧）。
    endGesture();
    // ⚠️ 移动过但**没有落点**（拖到空白处松手）也照调 —— `target` 是 `null`，
    // 怎么处置由题型自己决定（见 `onDrop` 的注释：排序题靠这一条才落得下去）。
    // ⚠️ 反过来，**没移动**过就绝不调：那一下是点选，走 `onTap`。
    if (moved) onDrop(id, target);
  }, [endGesture, onDrop]);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    // 🔴 **中断不落位、也不点选**，但**必须清状态**（文件头第 ③ 条）。
    endGesture();
  }, [endGesture]);

  const handleClick = useCallback((event: ReactMouseEvent<HTMLElement>, id: string) => {
    // ⚠️ 挡住冒泡：同一次点击会在里层条目与它的容器上各触发一次（归类题的条目池）。
    event.stopPropagation();
    if (disabled) return;
    if (movedRef.current) {
      // 刚才那一下是**拖拽**的收尾（浏览器在 pointerup 之后照样会派发一次 click）。
      // 吞掉它，并且把标记复位 —— 下一次点选必须是干净的。
      movedRef.current = false;
      return;
    }
    onTap(id);
  }, [disabled, onTap]);

  const sourceProps = useCallback((id: string): PointerDragHandlers => ({
    onPointerDown: (event) => handlePointerDown(event, id),
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onClick: (event) => handleClick(event, id),
  }), [handleClick, handlePointerCancel, handlePointerDown, handlePointerMove, handlePointerUp]);

  const targetProps = useCallback((id: string): PointerDragHandlers & { 'data-drop-id': string } => ({
    'data-drop-id': id,
    // 落点**不是**拖拽源：它的 pointerdown 什么都不做（但 `pointermove` / `pointerup`
    // 留着 —— 指针被捕获到源元素上时，事件不会派发到这里，留着它们只是省得
    // 「为什么这里没有」多一个要解释的分支）。
    onPointerDown: (event) => { event.stopPropagation(); },
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onClick: (event) => handleClick(event, id),
  }), [handleClick, handlePointerCancel, handlePointerMove, handlePointerUp]);

  return { draggingId, hoverTargetId, sourceProps, targetProps };
}
