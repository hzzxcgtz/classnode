import { locateInLengths } from '@/lib/text-offsets';
import { isBlankRun, promptRunStyle, type PromptRun } from '@/lib/worksheet-prompt-marks';

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
    if (isBlankRun(run)) {
      // 填空占位符是题干中的一个「原子对象」，不是一串可以把光标插进去的普通文字。
      // contenteditable=false 先阻止浏览器在内部落光标；删除键的跨浏览器一致性由
      // PromptEditor 的 keydown 接管。
      span.contentEditable = 'false';
      span.className = 'worksheet-editor-inline-blank';
      span.dataset.worksheetBlank = run.blank;
    }
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

/** 一个题干子节点覆盖的字符区间。点击原子填空占位符时用它选中整段。 */
export function nodeTextRange(root: HTMLElement, node: Node): { from: number; to: number } | null {
  if (!root.contains(node)) return null;
  const from = charsBefore(root, node, 0);
  if (from < 0) return null;
  return { from, to: from + (node.textContent || '').length };
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

  // 各文本节点的长度，按文档顺序 —— 与 `locateInLengths` 的 `lengths` 同一份口径。
  const texts: Text[] = [];
  const collect = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) { texts.push(node as Text); return; }
    for (let i = 0; i < node.childNodes.length; i += 1) collect(node.childNodes[i]);
  };
  for (let i = 0; i < el.childNodes.length; i += 1) collect(el.childNodes[i]);

  const lengths = texts.map(text => (text.textContent || '').length);
  const start = locateInLengths(lengths, from);
  const end = locateInLengths(lengths, to);
  if (!start || !end) {
    // 空题干：没有字符可落，把光标放进框里（否则这个框点不进去）。
    range.selectNodeContents(el);
    range.collapse(false);
  } else {
    range.setStart(texts[start.index], start.offset);
    // ⚠️ 终点**必须**用同一个函数算（见上面那段）。这里再补一道防线：真出现反序
    // 就折到起点，而不是让 `setEnd` 静默把整个选区折没。
    const startAt = { index: start.index, offset: start.offset };
    const before = end.index < startAt.index
      || (end.index === startAt.index && end.offset < startAt.offset);
    if (before) {
      range.collapse(true);
    } else {
      range.setEnd(texts[end.index], end.offset);
    }
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * 把光标放到一个原子子节点的前面或后面。
 * 不能用字符偏移落点，因为边界偏移会按既有规则归到前一段文本节点末尾；若前一段正好是
 * `contenteditable=false` 的填空域，Safari/Chromium 都可能把光标留在原处。
 */
export function placeCaretBesideNode(root: HTMLElement, node: Node, after: boolean): void {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (!selection || node.parentNode !== root) return;
  const index = Array.prototype.indexOf.call(root.childNodes, node) as number;
  if (index < 0) return;
  const range = document.createRange();
  range.setStart(root, index + (after ? 1 : 0));
  range.collapse(true);
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
