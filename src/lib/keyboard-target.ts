/**
 * 画布快捷键的**共用判据** —— 纯函数，不 import React / DOM。
 *
 * ── 为什么单独成一个文件 ────────────────────────────────────────────────────
 *
 * 「这一次按键该不该交给浏览器原生处理」这件事，在仓里原先有**两份内联拷贝**
 * （`math-drawing.tsx` 与 `flowchart-drawing.tsx` 各写一遍 `target.tagName === 'INPUT' || …`）。
 * 两份的后果不是"多打几个字"，而是**改一处漏一处**：漏掉的那块画布会在学生刚打的字里
 * 抢走 `Cmd+Z`，而它**不报错**，只在真机上表现为"在一个输入框里撤销不了"。
 *
 * 抽出来之后它是**可测的那一半**：`keyboard-target.test.ts` 直接喂形状（不需要 jsdom，
 * 本仓没有），四类目标逐个断言。画布那边只留一行接线。
 *
 * ⚠️ 判据用**鸭子类型**（读 `tagName` / `isContentEditable`），不用 `instanceof HTMLElement`
 * —— 后者在纯 Node 下加载不了，这个文件就不再可测了。
 */

/** 事件里与快捷键判定有关的三个字段（`KeyboardEvent` 的形状子集）。 */
export interface ShortcutEventLike {
  metaKey: boolean;
  ctrlKey: boolean;
  key: string;
}

/** 元素里与判定有关的两个字段（`HTMLElement` 的形状子集）。 */
export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/**
 * 焦点是否落在一个**正在输入**的地方 —— 是的话，快捷键一律让位给浏览器。
 *
 * 🔴 这一条是**为「撤销打字」而设的**，不是为了"礼貌"。抢走它的后果是：学生在题干输入框
 * 或就地标注框里打了字、想按 `Cmd+Z` 退掉最后一个字符，结果退掉的是**画布上的一个图形**，
 * 而他刚打的字一个字都没少。流程图那条踩过这一次（见 `flowchart-drawing.tsx` 的注释）。
 *
 * ⚠️ 判定只认这三类：`INPUT` / `TEXTAREA` / `isContentEditable`。**不**把 `<select>`、
 * `<button>` 算进来 —— 它们不承载"打字"，也从来不是撤销的目标。
 */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as TargetLike;
  if (element.isContentEditable === true) return true;
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

/**
 * 这一次按键是不是「撤销」组合键（`Cmd+Z` / `Ctrl+Z`）。
 *
 * ⚠️ **不区分 Shift**：数学作图**没有重做**，所以 `Shift+Cmd+Z` 也一律当作撤销。
 * 刻意如此 —— 让一个"没有这个功能"的按键什么都不做，学生只会以为快捷键坏了。
 * （流程图有重做，它自己那条判断里把 Shift 分了出去，不走这个函数。）
 */
export function isUndoShortcut(event: ShortcutEventLike): boolean {
  if (!event.metaKey && !event.ctrlKey) return false;
  return event.key.toLowerCase() === 'z';
}
