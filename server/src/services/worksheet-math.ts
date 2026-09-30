/**
 * `src/lib/worksheet-math.ts` 的**服务端孪生**（★ 2026-09-30）。
 *
 * 🔴 两个包 import 不过来（服务端读不到 `src/`）⇒ 这是**有意**的第二份，不是疏忽。
 *    仓里的先例：`worksheet-ink.ts` ↔ `ink-path.ts`、`FILL_BLANK_TEXT` ↔ `BLANK_MARK_TEXT`。
 * 🔴 **两份必须逐字一致**（文件头之后的每一个字节），由 `src/lib/worksheet-math-parity.test.ts`
 *    对拍钉住 —— 那条用例住在前端，因为只有前端的 runner 能同时看见 `src/` 与 `server/`。
 * ⚠️ **本文件不许有任何 import**：对拍用例靠 Node 的类型擦除直接加载它。
 * ⚠️ 改这一份就得改那一份 —— 对拍用例会当场变红，那正是它存在的意义。
 *
 * ⚠️ 下一行起与前端那份**逐字相同**（连注释一起），别单独改这边。
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
