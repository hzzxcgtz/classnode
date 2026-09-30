/**
 * 题面里的数学公式：把一段文本切成「文字段 / 公式段」。
 *
 * 🔴 **零 import 是纪律**（不是巧合）：前端与它的服务端孪生都要能被 `node --test`
 * 直接加载（Node 的类型擦除不解析运行时 import），而两者之间有一条逐字对拍用例。
 *
 * 🔴 **不许 lookbehind**：本文件在 `scripts/check-classroom-browser-compat.mjs` 的
 * 扫描根（`src/lib`）内。「前面那个字符是什么」一律手写（`text[i - 1]`），不用正则后看。
 *
 * ── 规则（四条，顺序就是优先级）────────────────────────────────────────────
 *   1. `$$…$$` 优先，同一行内、内容非空 ⇒ 公式（剥掉双层）
 *   2. `$…$`：开 `$` 后不接空白、不接 `$`；闭 `$` 前不接空白、后不接数字或 `$`
 *   3. 不跨行
 *   4. **认不出来 ⇒ 原样当普通文本**（安全阀）
 *
 * 第 4 条是这一层的**全部价值**：教师打「这本书 $5，另一本 $8」时两个 `$` 都不成对，
 * 一个字都不渲染、原样显示。反过来（吞掉中间那段当公式）是本仓最防的那类缺陷
 * ——屏幕上画的和存下的不是一个东西，且两边都不报错。
 *
 * ⚠️ **不做转义**（`\$` 没有特殊含义）：规则越少越难出错，而教师的真实输入里
 * 公式外面不会出现 `\$`（公式**内部**的 `\$` 是 LaTeX 的事，KaTeX 自己管）。
 */
export interface MathTex { kind: 'math'; tex: string }
export interface MathPlain { kind: 'text'; text: string }
export type MathPiece = MathTex | MathPlain;

/** 开定界符的两条：后面得有东西、不是空白、不是 `$`。 */
function canOpen(text: string, at: number): boolean {
  const next = text[at + 1];
  if (next === undefined) return false;
  if (next === '$') return false;
  return !/\s/.test(next);
}

/** 从 `from` 起找闭定界符；`-1` = 这一行里没有合格的闭合。 */
function findClose(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    // 规则 3：公式不跨行。
    if (ch === '\n') return -1;
    if (ch !== '$') continue;
    // 规则 2 的后半：闭 `$` 前不接空白。
    const prev = text[i - 1];
    if (prev === undefined || /\s/.test(prev)) continue;
    // 规则 2 的后半：闭 `$` 后不接**数字或字母**（挡掉「另一本$8」与「共计$y元」这类
    // 金额写法），也不接另一个 `$`。
    // ★ 2026-09-30：**字母那一条是交付当天复审补上的** —— 只挡数字时，
    //   `花费$x元，共计$y元` 会把中间那段吞成一个公式，而 KaTeX 对这段只发一个
    //   `unicodeTextInMathMode` **警告**、照画 ⇒ 屏幕上画出来的与存下的不是一个东西。
    const after = text[i + 1];
    if (after !== undefined && /[0-9a-zA-Z$]/.test(after)) continue;
    return i;
  }
  return -1;
}

/** 切分。**永远不丢字符**：把各段接回去等于原文（有一条用例钉这一点）。 */
export function splitMath(text: string): MathPiece[] {
  if (typeof text !== 'string' || text === '') return [];
  const pieces: MathPiece[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) { pieces.push({ kind: 'text', text: buffer }); buffer = ''; }
  };
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '$') { buffer += text[i]; i += 1; continue; }
    // 规则 1：`$$…$$` 先试。
    if (text[i + 1] === '$') {
      const end = text.indexOf('$$', i + 2);
      if (end > i + 2 && text.slice(i + 2, end).indexOf('\n') < 0) {
        flush();
        pieces.push({ kind: 'math', tex: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
      // 认不出（`$$` 没成对 / 空内容 / 跨行）⇒ 这个 `$` 当普通字符，下一个照样试。
      buffer += '$'; i += 1; continue;
    }
    if (!canOpen(text, i)) { buffer += '$'; i += 1; continue; }
    const end = findClose(text, i + 1);
    if (end < 0) { buffer += '$'; i += 1; continue; }
    flush();
    pieces.push({ kind: 'math', tex: text.slice(i + 1, end) });
    i = end + 1;
  }
  flush();
  return pieces;
}

/**
 * 部件 → **剥掉定界符**的纯文本。
 *
 * 🔴 判分那一侧（裁定 ④：学生端不解析公式）要的就是它：教师答案写 `$x=5$`，
 *    学生打 `x=5` 判对。⚠️ 显示那一侧**不许**用它 —— 那边要渲染公式。
 */
export function mathText(pieces: MathPiece[]): string {
  return pieces.map((piece) => (piece.kind === 'math' ? piece.tex : piece.text)).join('');
}

/**
 * 源码 → **剪贴板上那一串**（公式弹窗的「复制」放出去的就是它）。
 *
 * 🔴 它是 `splitMath` 的**写那一半**：读那一半决定「什么算公式」，写这一半决定
 *    「放出去的那串一定会被认成公式」。两边住在同一个文件里，就是为了不给它们分叉的
 *    机会 —— 教师复制出去要粘在题干、选项、参考答案、表格格子里，认不出来时
 *    **两边都不报错**，只是那一段变成一段死源码，要等学生端才发现。
 *
 * 三条判断，每条都对着 `splitMath` 的规则：
 *   · 前后空白剥掉 —— 从别处粘进来的源码常带一个尾巴空格；
 *   · 源码里的换行**折成空格** —— 规则 3 说公式不跨行，留着换行的那一串
 *     **永远不会**被认成公式，而屏幕上看不出区别；
 *   · **本来就是一段公式的（``$…$`` / ``$$…$$``）原样返回，不再包一层** ——
 *     `$x^2$` 再包一层成 `$$x^2$$` 是规则 1 的另一档，含义变了而屏幕上看不出来。
 * ⚠️ 空 / 只有空白 ⇒ **空串**（不是 `$$`：那是一个空公式，渲染出来是个错误标记）。
 */
export function mathMarkup(source: string): string {
  const text = source.replace(/\r\n?/g, '\n').replace(/\n/g, ' ').trim();
  if (text === '') return '';
  const pieces = splitMath(text);
  if (pieces.length === 1 && pieces[0].kind === 'math') return text;
  return '$' + text + '$';
}
