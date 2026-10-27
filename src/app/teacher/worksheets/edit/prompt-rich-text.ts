import { locateInLengths } from '@/lib/text-offsets';
import { TABLE_MARK_TEXT } from '@/lib/worksheet-table';
import { blankRuns, isBlankRun, promptRunStyle, type PromptRun } from '@/lib/worksheet-prompt-marks';

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
/** 给一个 span 上「这一段该长什么样」的样式与文字（★ 2026-09-28：标记那三处也要用）。 */
function applyRunStyle(span: HTMLSpanElement, style: Record<string, unknown>, content: string): void {
  Object.keys(style).forEach((key) => {
    span.style.setProperty(cssPropertyName(key), String(style[key]));
  });
  span.textContent = content;
}

const CARET_SENTINEL = '\u200b';
function caretStop(block = false): HTMLElement {
  const stop = document.createElement('span');
  stop.dataset.caretStop = 'true';
  if (block) stop.dataset.caretBlock = 'true';
  stop.className = 'worksheet-editor-caret-stop';
  stop.textContent = CARET_SENTINEL;
  return stop;
}
function modelTextPart(node: Node, raw: string): string {
  return node.parentElement?.closest('[data-caret-stop]') ? raw.replace(/\u200b/g, '') : raw;
}

export function renderRunsInto(el: HTMLElement, text: string, runs: PromptRun[]): void {
  el.replaceChildren();
  runs.forEach((run) => {
    const style = promptRunStyle(run);
    if (isBlankRun(run)) {
      // 横线是不可拆开的结构化填空；保留底层文本长度以兼容历史题面和字符偏移。
      const span = document.createElement('span');
      applyRunStyle(span, style, text.slice(run.start, run.end));
      span.className = 'worksheet-editor-inline-blank';
      span.contentEditable = 'false';
      span.draggable = true;
      span.title = '点击选中；拖动调整位置；Alt + 左右方向键移动';
      span.setAttribute('data-blank-id', run.blank);
      span.setAttribute('data-blank-number', String(blankRuns(runs).findIndex(item => item.blank === run.blank) + 1));
      span.setAttribute('role', 'button');
      span.setAttribute('tabindex', '0');
      span.setAttribute('aria-label', `设置第 ${blankRuns(runs).findIndex(item => item.blank === run.blank) + 1} 个文字填空`);
      el.append(caretStop(), span, caretStop());
      return;
    }
    const whole = text.slice(run.start, run.end);
    const markAt = whole.indexOf(TABLE_MARK_TEXT);
    if (markAt < 0) {
      const span = document.createElement('span');
      applyRunStyle(span, style, whole);
      el.appendChild(span);
      return;
    }
    // 表格标记保留历史协议，显示成简洁入口，实际表格紧邻题面编辑。
    const head = whole.slice(0, markAt);
    const tail = whole.slice(markAt + TABLE_MARK_TEXT.length);
    if (head) {
      const headSpan = document.createElement('span');
      applyRunStyle(headSpan, style, head);
      el.appendChild(headSpan);
    }
    const chip = document.createElement('span');
    applyRunStyle(chip, style, TABLE_MARK_TEXT);
    chip.className = 'worksheet-editor-table-mark';
    chip.contentEditable = 'false';
    chip.setAttribute('data-label', '表格 · 点击编辑');
    chip.setAttribute('data-table-mark', '1');
    el.append(caretStop(true), chip, caretStop(true));
    if (tail) {
      const tailSpan = document.createElement('span');
      applyRunStyle(tailSpan, style, tail);
      el.appendChild(tailSpan);
    }
  });
  // pre-wrap 的末尾换行本身没有可见行盒；补一个不入库的文字落点，让光标立即进入新行。
  if (text.endsWith('\n')) {
    const tail = caretStop(); tail.dataset.caretTail = 'true'; el.appendChild(tail);
  }
}

/** 表格是独立编辑岛：它在题面字符坐标中只占一个历史位置标记。 */
export function promptModelText(node: Node): string {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).hasAttribute('data-table-mark')) return TABLE_MARK_TEXT;
  if (node.nodeType === Node.TEXT_NODE) return modelTextPart(node, node.textContent || '');
  return Array.from(node.childNodes).map(promptModelText).join('');
}

export function promptNodeOffset(el: HTMLElement, node: Node): number {
  return charsBefore(el, node, 0);
}

export function promptOffsetAtPoint(el: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const point = doc.caretPositionFromPoint?.(x, y);
  const range = point ? null : doc.caretRangeFromPoint?.(x, y);
  const node = point?.offsetNode ?? range?.startContainer;
  const offset = point?.offset ?? range?.startOffset;
  if (!node || offset === undefined || !el.contains(node)) return null;
  const at = charsBefore(el, node, offset);
  return at < 0 ? null : at;
}

/** 从 `root` 走到 (`node`, `offset`) 为止一共走过多少个**字符**。 */
function charsBefore(root: HTMLElement, node: Node, offset: number): number {
  let total = 0;
  let hit = false;
  const walk = (current: Node): void => {
    if (hit) return;
    if (current.nodeType === Node.ELEMENT_NODE && (current as HTMLElement).hasAttribute('data-table-mark')) {
      if (current === node || current.contains(node)) { hit = true; total += offset > 0 ? TABLE_MARK_TEXT.length : 0; }
      else total += TABLE_MARK_TEXT.length;
      return;
    }
    if (current === node) {
      hit = true;
      if (current.nodeType === Node.TEXT_NODE) {
        total += modelTextPart(current, (current.textContent || '').slice(0, offset)).length;
      } else {
        // `offset` 是**子节点下标**：它前面那几个子节点的文本全算。
        for (let i = 0; i < offset && i < current.childNodes.length; i += 1) {
          total += promptModelText(current.childNodes[i]).length;
        }
      }
      return;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      total += promptModelText(current).length;
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
 * 🔴 **起点与终点走的是同一个函数**（`locateInLengths`）—— 这一条是硬要求，不是风格。
 * 2026-09-26 交付当天教师报「设完格式选区就没了」，根因就是这里：起点算的是
 *「落在第几个文本节点里的第几个字符」，而终点那条路**从元素开头重新数**，
 * 两者混起来 ⇒ 终点被算到起点**前面** ⇒ `Range.setEnd` 把整个 Range **折成一个点**
 * ⇒ 选区消失、工具栏全灭 ⇒ 下一个格式按钮点了没反应。
 * 而那只在「起点正好落在**第一个**文本节点里」时碰巧是对的 —— 所以第一样格式没事、
 * 第二样就丢（第一样之前题干只有一整段）。纯算术那一半现在有用例（`text-offsets.test.ts`）。
 *
 * ⚠️ 越界一律夹紧（重建之后文本会变短：⌘Z 之后光标不能落在文本外面）。
 */
export function placeSelection(el: HTMLElement, from: number, to: number): void {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  // 空白落点具备真实文本节点，浏览器能显示光标；它的哨兵不计入模型坐标。
  if (from === to) {
    for (const stop of Array.from(el.querySelectorAll<HTMLElement>('[data-caret-stop]'))) {
      const at = charsBefore(el, stop, 0);
      const text = stop.firstChild;
      if (at !== from || !text || text.nodeType !== Node.TEXT_NODE) continue;
      range.setStart(text, (text.textContent || '').startsWith(CARET_SENTINEL) ? 1 : 0);
      range.collapse(true); selection.removeAllRanges(); selection.addRange(range); return;
    }
  }

  // 各文本节点的长度，按文档顺序 —— 与 `locateInLengths` 的 `lengths` 同一份口径。
  const texts: Node[] = [];
  const collect = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).hasAttribute('data-table-mark')) { texts.push(node); return; }
    for (let i = 0; i < node.childNodes.length; i += 1) collect(node.childNodes[i]);
  };
  for (let i = 0; i < el.childNodes.length; i += 1) collect(el.childNodes[i]);

  const lengths = texts.map(text => promptModelText(text).length);
  const start = locateInLengths(lengths, from);
  const end = locateInLengths(lengths, to);
  if (!start || !end) {
    // 空题干：没有字符可落，把光标放进框里（否则这个框点不进去）。
    range.selectNodeContents(el);
    range.collapse(false);
  } else {
    const endpoint = (text: Node, offset: number): [Node, number] => {
      const atom = text.nodeType === Node.ELEMENT_NODE && (text as HTMLElement).hasAttribute('data-table-mark') ? text as HTMLElement : text.parentElement?.closest('[contenteditable="false"]');
      if (atom?.parentNode) {
        const index = Array.prototype.indexOf.call(atom.parentNode.childNodes, atom);
        return [atom.parentNode, index + (offset > 0 ? 1 : 0)];
      }
      if (text.nodeType === Node.TEXT_NODE && text.parentElement?.closest('[data-caret-stop]')) {
        const raw = text.textContent || ''; let logical = 0; let physical = 0;
        while (physical < raw.length && (logical < offset || raw[physical] === CARET_SENTINEL)) { if (raw[physical] !== CARET_SENTINEL) logical++; physical++; }
        return [text, physical];
      }
      return [text, offset];
    };
    const startPoint = endpoint(texts[start.index], start.offset);
    range.setStart(...startPoint);
    // ⚠️ 终点**必须**用同一个函数算（见上面那段）。这里再补一道防线：真出现反序
    // 就折到起点，而不是让 `setEnd` 静默把整个选区折没。
    const startAt = { index: start.index, offset: start.offset };
    const before = end.index < startAt.index
      || (end.index === startAt.index && end.offset < startAt.offset);
    if (before) {
      range.collapse(true);
    } else {
      range.setEnd(...endpoint(texts[end.index], end.offset));
    }
  }
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

/** 点击或上下移动落在对象旁的父节点时，改落真实文本节点，避免光标撑成整行高度。 */
export function normalizePromptCaret(el: HTMLElement): void {
  const selection=window.getSelection();
  if (document.activeElement !== el || !selection?.isCollapsed || !selection.anchorNode || !el.contains(selection.anchorNode)) return;
  const anchor=selection.anchorNode;
  const atom=anchor.parentElement?.closest('[data-blank-id], [data-table-mark]');
  if (anchor.nodeType === Node.TEXT_NODE && !atom) return;
  const at=caretOffset(el);
  if(at===null) return;
  if(atom?.hasAttribute('data-blank-id')) {
    const start=promptNodeOffset(el,atom), end=start+promptModelText(atom).length;
    placeSelection(el,at-start < end-at ? start : end,at-start < end-at ? start : end);
  } else placeSelection(el,at,at);
}
