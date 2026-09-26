import { promptRunStyle, type PromptRun } from '@/lib/worksheet-prompt-marks';

/**
 * 所见即所得题干编辑器的**那一层 DOM 原语**（★ 2026-09-26）。
 *
 * ── 为什么单独一个文件、而且这么小心 ────────────────────────────────────────
 * 🔴 **本仓没有 jsdom、没有浏览器、没有 testing-library** —— 这个文件里的每一个函数
 * 在本机**一行都跑不到**。它不是「顺手写写」的地方：光标算错一格，教师撤销之后
 * 接着打字就会打到别处去，而屏幕上没有任何东西提示他。
 * ⇒ 能算的判据一律不在这里（区间运算全在 `@/lib/worksheet-prompt-marks`，那半边有用例），
 * 这里只留**必须碰 DOM** 的那几下，并把每一下的理由写清楚。
 *
 * ── 三条贯穿全文件的约定 ────────────────────────────────────────────────────
 * 1. **字符偏移是唯一的坐标**（不是节点 + 偏移）。分段的 `start/end` 也是字符偏移，
 *    两边同一套坐标系才不会在 span 边界上错位。
 * 2. **只走文本节点累计**。`range.startOffset` 只在「startContainer 是文本节点」时
 *    才等于字符数；落在一个 `<span>` 上时它是**子节点下标**。两种都要算对。
 * 3. **不用 `innerHTML` 拼字符串**：题干是教师随便打的，一个 `<` 就能把 DOM 结构吃掉。
 *    一律 `createElement` + `textContent`。
 */

/** `WebkitTextEmphasis` → `-webkit-text-emphasis`（`setProperty` 要的是这种写法）。 */
function cssPropertyName(key: string): string {
  // ⚠️ 不用 lookbehind（学生端那条红线扫的是 `src/lib`，但这里同一套纪律更好记）。
  return key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

/**
 * 把分段画进那个可编辑元素（**先清空**）。
 *
 * ⚠️ 空题干时也要留一个空文本节点：Safari 里一个**完全没有子节点**的 contenteditable
 * 会塌成零高度、点不进去，而教师看到的是「这个框没了」。
 */
export function renderRunsInto(el: HTMLElement, text: string, runs: PromptRun[]): void {
  el.replaceChildren();
  runs.forEach((run) => {
    const span = document.createElement('span');
    const style = promptRunStyle(run);
    Object.keys(style).forEach((key) => {
      span.style.setProperty(cssPropertyName(key), String(style[key]));
    });
    span.textContent = text.slice(run.start, run.end);
    el.appendChild(span);
  });
  if (runs.length === 0) el.appendChild(document.createTextNode(''));
}

/** 从 `root` 走到 (`node`, `offset`) 为止一共走过多少个**字符**。 */
function charsBefore(root: HTMLElement, node: Node, offset: number): number {
  let total = 0;
  let hit = false;
  const walk = (current: Node): void => {
    if (hit) return;
    if (current === node) {
      hit = true;
      if (current.nodeType === Node.TEXT_NODE) {
        total += offset;
      } else {
        // `offset` 是**子节点下标**：它前面那几个子节点的文本全算。
        for (let i = 0; i < offset && i < current.childNodes.length; i += 1) {
          total += (current.childNodes[i].textContent || '').length;
        }
      }
      return;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      total += (current.textContent || '').length;
      return;
    }
    for (let i = 0; i < current.childNodes.length; i += 1) walk(current.childNodes[i]);
  };
  walk(root);
  // 走不到那个节点（选区不在这个框里）⇒ 返回 `-1`，由调用方判成「不算数」。
  return hit ? total : -1;
}

/** 光标在可编辑区里的**字符偏移**。焦点不在框里 / 取不到选区 ⇒ `null`。 */
export function caretOffset(el: HTMLElement): number | null {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const offset = charsBefore(el, range.startContainer, range.startOffset);
  return offset < 0 ? null : offset;
}

/**
 * 把 DOM 上第 `from`..`to` 个字符选起来（`from === to` 就是放一个光标）。
 *
 * 🔴 **一个函数管两件事**（置光标 / 恢复选区），因为它们是同一段「按字符偏移找位置」的
 * 逻辑 —— 分成两份就会各自漂移，而漂移的症状是「撤销之后接着打字打到别处去」。
 *
 * ⚠️ 越界一律夹紧（重建之后文本会变短：⌘Z 之后光标不能落在文本外面）。
 */
export function placeSelection(el: HTMLElement, from: number, to: number): void {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const total = (el.textContent || '').length;
  let remaining = Math.max(0, Math.min(from, total));
  let startPlaced = false;
  const walkStart = (current: Node): boolean => {
    if (current.nodeType === Node.TEXT_NODE) {
      const length = (current.textContent || '').length;
      if (remaining <= length) {
        range.setStart(current, remaining);
        startPlaced = true;
        return true;
      }
      remaining -= length;
      return false;
    }
    for (let i = 0; i < current.childNodes.length; i += 1) {
      if (walkStart(current.childNodes[i])) return true;
    }
    return false;
  };
  for (let i = 0; i < el.childNodes.length; i += 1) {
    if (walkStart(el.childNodes[i])) break;
  }
  if (!startPlaced) {
    // 一个文本节点都没有（空题干）⇒ 光标落在框里。
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  // 终点：从起点那个文本节点的**开头**算起，还要再走 `to - from` 个字符
  //（`remaining` 此刻正是起点在该节点内的偏移）。
  let endRemaining = Math.min(remaining + Math.max(0, to - from), total);
  let endPlaced = false;
  const walkEnd = (current: Node): boolean => {
    if (current.nodeType === Node.TEXT_NODE) {
      const length = (current.textContent || '').length;
      if (endRemaining <= length) {
        range.setEnd(current, endRemaining);
        endPlaced = true;
        return true;
      }
      endRemaining -= length;
      return false;
    }
    for (let i = 0; i < current.childNodes.length; i += 1) {
      if (walkEnd(current.childNodes[i])) return true;
    }
    return false;
  };
  for (let i = 0; i < el.childNodes.length; i += 1) {
    if (walkEnd(el.childNodes[i])) break;
  }
  if (!endPlaced) range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 只放一个光标（`placeSelection` 的简写）。 */
export function setCaretOffset(el: HTMLElement, offset: number): void {
  placeSelection(el, offset, offset);
}

/**
 * 选区在题干里的 `[from, to)` **字符偏移**。没有选中任何东西（或选区不在此框内）⇒ `null`。
 *
 * 🔴 返回 `null` 时调用方**什么都不做** —— 那是裁定 ②：「没选中就什么都不做」，
 * 这些按钮**永远只管选中的那一段**（没有第二种含义）。
 */
export function selectedRange(el: HTMLElement): { from: number; to: number } | null {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const from = charsBefore(el, range.startContainer, range.startOffset);
  const to = charsBefore(el, range.endContainer, range.endOffset);
  if (from < 0 || to < 0 || to <= from) return null;
  return { from, to };
}
