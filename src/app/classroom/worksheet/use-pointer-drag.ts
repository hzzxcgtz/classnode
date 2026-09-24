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
 *
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

export interface PointerDragOptions {
  /** 点了一下（没移动）时调它。id 由组件解释（连线的左项 / 归类的条目 /…）。 */
  onTap: (id: string) => void;
  /** 落位（移动过且手指底下是一个落点）时调它。**整个手势只调一次**。 */
  onDrop: (sourceId: string, targetId: string) => void;
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

/** 手指底下有没有落点。找不到就 `null`（松手时按「没落位」处置）。 */
function findDropTarget(clientX: number, clientY: number): string | null {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return null;
  const under = document.elementFromPoint(clientX, clientY);
  if (!under || typeof under.closest !== 'function') return null;
  // ⚠️ `closest` 而不是「直接看 under」：手指底下的几乎总是条目里的一个 `<span>`。
  // 用 `closest` 才能找到真正带 `data-drop-id` 的那一层。
  const holder = under.closest(`[${DROP_TARGET_ATTR}]`);
  if (!holder || typeof holder.getAttribute !== 'function') return null;
  return holder.getAttribute(DROP_TARGET_ATTR);
}

export function usePointerDrag({ onTap, onDrop, disabled = false }: PointerDragOptions): PointerDrag {
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
    const under = findDropTarget(event.clientX, event.clientY);
    // 手指下的落点就是自己 ⇒ 当成「还没到任何落点」（自己高亮自己没有意义）。
    const next = under && under !== gesture.id ? under : null;
    if (hoverRef.current !== next) {
      hoverRef.current = next;
      setHoverTargetId(next);
    }
    event.stopPropagation();
  }, []);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const { id, moved } = gesture;
    const target = hoverRef.current;
    event.stopPropagation();
    // 先收尾再落位：`onDrop` 里会 setState（写 draft），而收尾也要 setState ——
    // 顺序反过来的话，落位那一次渲染里元素还带着「正在拖」的类名（闪一帧）。
    endGesture();
    // ⚠️ 移动过但**没有落点**（拖到空白处松手）⇒ 什么都不做：既不落位，也不当成点选。
    if (moved && target) onDrop(id, target);
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
