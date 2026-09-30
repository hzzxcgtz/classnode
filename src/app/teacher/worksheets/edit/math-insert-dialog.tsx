'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { mathMarkup, splitMath } from '@/lib/worksheet-math';
import { MathSpan } from '@/lib/worksheet-math-view';
import { MATH_SYMBOL_GROUPS } from './math-symbols';

/**
 * 公式弹窗（★ 2026-09-30）。
 *
 * 教师那两句话是这一整块的由来：
 *   · 第二轮：「建议可以使用**弹窗**来编辑公式，好了以后**也不要直接点『插入』**，
 *     而且提供『复制』按钮，这样用户就可以**在任何地方粘贴**公式了。」
 *   · 第三轮：「还是放回到编辑框的工具栏里边吧…**其他功能不变**。」
 *
 * ── 🔴 入口搬过两回家，**收尾动作一次都没动** ──────────────────────────────
 *   第一轮：题干工具栏 + 「插入到光标处」。
 *   第二轮：右下角悬浮 + 「复制」← **收尾在这里定了型**。
 *   第三轮：**回到题干工具栏**（Σ + 「数学公式」四个字），复制那套原封不动。
 *
 * 为什么收尾必须是「复制」而不是「插入到光标处」：公式要用在**七个**地方 ——
 * 题干、选项、连线的左右两栏、归类的条目与分区、排序的条目、表格格子、参考答案。
 * 那些输入框**各有各的外壳，没有一个共同的地方**可以挂按钮；而「插入到光标处」只有
 * 题干那一个框有光标可插。⇒ 与其挂七个入口，不如把出口统一成剪贴板：**复制 → 到哪都粘**。
 * ⚠️ 所以入口回退到工具栏**不等于**这个决定被推翻了 —— 教师第三轮明确说「其他功能不变」。
 *
 * ── 三条纪律 ─────────────────────────────────────────────────────────────
 *  1. **复制的那一串由 `mathMarkup` 给**（`@/lib/worksheet-math` 里 `splitMath` 的写那一半，
 *     有用例、有与服务端的逐字对拍）。在这一层自己拼 `'$' + tex + '$'` 就是第二份真源。
 *  2. **复制完立刻关掉弹窗**。不关的话这一层盖着整页，教师**点不到**下面那个要粘贴的
 *     输入框 —— 而这一整套流程的全部价值就是「复制完去任何地方粘」。
 *  3. **类名一律 `worksheet-editor-` 前缀**：本页有一条网（`editor-classes.test.ts`）守
 *     「编辑页用到的每一个 `worksheet-editor-*` 类都必须在 `globals.css` 里有定义」——
 *     换个前缀就等于把这一族类挪出网外，而症状是**屏幕上只是「长得不对」**，
 *     构建与 `tsc` 全都不报错。
 *
 * ⚠️ **本机验不了观感与交互**（没有 jsdom、没有浏览器）：弹窗好不好看、点符号时光标
 *    跟不跟得上、窄屏下会不会溢出 —— 只能真机走查。`math-entry.test.ts` 只回答
 *    「零件在不在、谁接谁」。
 */

/**
 * 把一段文字放进剪贴板；成功回 `true`。
 *
 * 🔴 **为什么留着 `execCommand` 那条退路**：`navigator.clipboard` 只在**安全上下文**
 *    （https / localhost）里存在。教师完全可能从局域网地址（`http://192.168.x.x:4000`）
 *    打开编辑页 —— 那时它整个是 `undefined`，只写这一条会当场抛异常，而**这个功能的
 *    全部价值就是那一次复制**。
 * ⚠️ 失败要**说出来**：返回 `false`，由弹窗显示一句「请手动复制」。
 *    静默失败的话教师以为复制好了，粘出来是空的 —— 而屏幕上一切正常。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面那条退路（非安全上下文里 `writeText` 也可能直接 reject）。
  }
  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.top = '-1000px';
    document.body.appendChild(scratch);
    scratch.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(scratch);
    return copied;
  } catch {
    return false;
  }
}

// ⊘ 2026-09-30（教师第三轮）：「还是放回到编辑框的工具栏里边吧，否则觉得怪怪的。」
//   ⇒ 本文件原来导出的 `MathFormulaButton`（编辑页右下角那个悬浮圆钮 + 它的开合状态）
//     **整个拆掉了**。入口搬回 `prompt-editor.tsx` 的工具栏（Σ + 「数学公式」四个字）。
//   🔴 **弹窗本身一个字没动** —— 第三轮教师说的是「其他功能不变」：收尾仍然是
//     「复制 → 到任何输入框里粘贴」，所以给选项/答案/表格加公式那条路照旧走得通。

/** 公式弹窗。**由题干工具栏那个 Σ 开出来**（`prompt-editor.tsx`）。 */
export function MathInsertDialog({ onClose, onCopied }: {
  onClose: () => void;
  onCopied: (message: string) => void;
}) {
  const [tex, setTex] = useState('');
  const [error, setError] = useState('');
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  /** 插完一个符号之后光标该落在哪（见 `insertSymbol`）。 */
  const pendingCaret = useRef<number | null>(null);

  /**
   * 光标落点。**必须等这一帧画完再设**：`insertSymbol` 只改了 state，
   * textarea 的值要等 React 重画之后才是新的 —— 当场 `setSelectionRange` 会被
   * 旧值夹回去（`min(位置, 旧长度)`），表现为「点符号时光标乱跳」。
   */
  useEffect(() => {
    const el = sourceRef.current;
    if (el === null || pendingCaret.current === null) return;
    const at = Math.min(pendingCaret.current, el.value.length);
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(at, at);
  });

  /** Esc 关掉（与颜色下拉、预览弹窗同一条习惯）。 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const markup = mathMarkup(tex);
  /**
   * 预览要画的那一段 tex。
   *
   * 🔴 教师从别处粘进来的源码常**自带定界符**（`$x^2$`）。拿它直接喂 KaTeX 会画出一个
   *    红色错误标记，而「复制」给出的那一串其实**是对的** ⇒ 两边打脸，教师不知道该信哪个。
   *    ⇒ 先问一句 `splitMath`：「整串就是一段公式吗？」是就按**里面那段**画。
   */
  const pieces = splitMath(tex.trim());
  const previewTex = pieces.length === 1 && pieces[0].kind === 'math' ? pieces[0].tex : tex;

  /**
   * 点一个符号 = 插到**源码框的光标处**（不是傻傻追加到末尾）——
   * 教师是在改一个已经写了一半的式子（`x^2` 后面接着加 `+1`）。
   * ⚠️ 按钮用 `onMouseDown` + `preventDefault`：点按钮会把焦点从源码框拿走，
   *    而 `selectionStart` 是**焦点在框里**时才有意义的那一份。
   * ⚠️ 基数取 **DOM 里那一份**（`el.value`），不取闭包里的 `tex`：这个函数必须是稳定的
   *    （见下面那个 `useMemo`），读闭包就会读到上一次渲染的旧值。受控 textarea 里
   *    两者本来就是一个东西，但这么写让它**不可能**因为少更新一次而错位。
   * ⚠️ 光标也在**这里**读，不放进 `setTex` 的 updater 里 —— updater 必须是纯函数，
   *    StrictMode 下 React 会跑它两遍，而读 `selectionStart` 与写 ref 都不纯。
   */
  const insertSymbol = useCallback((snippet: string) => {
    const el = sourceRef.current;
    const base = el ? el.value : '';
    const start = el?.selectionStart ?? base.length;
    const end = el?.selectionEnd ?? start;
    pendingCaret.current = start + snippet.length;
    setTex(base.slice(0, start) + snippet + base.slice(end));
  }, []);

  /**
   * 那几排符号按钮 —— **只画一次**。
   *
   * 🔴 每一格都是一次 KaTeX 渲染（38 格）。不 memo 的话，教师每敲一个字符都会把这
   *    38 次渲染跟着重做一遍（`setTex` ⇒ 整个弹窗重渲）⇒ 打字发涩，而屏幕上看不出
   *    哪里不对。它们是**常量数据**画的，本来就没有重画的理由。
   */
  const symbolGroups = useMemo(() => MATH_SYMBOL_GROUPS.map((group) => (
    <section className="worksheet-editor-math-group" key={group.label}>
      <span className="worksheet-editor-math-group-label">{group.label}</span>
      <div className="worksheet-editor-math-group-row">
        {group.symbols.map((symbol) => (
          <button
            key={symbol.tex}
            type="button"
            className="worksheet-editor-math-symbol"
            title={symbol.title}
            aria-label={symbol.title}
            onMouseDown={(event) => { event.preventDefault(); insertSymbol(symbol.tex); }}
          >
            <MathSpan tex={symbol.tex} />
          </button>
        ))}
      </div>
    </section>
  )), [insertSymbol]);

  const copy = async () => {
    if (markup === '') return;
    if (!await copyText(markup)) {
      setError('复制没有成功 —— 请手动选中源码框里的内容复制。');
      return;
    }
    onCopied(`公式已复制：${markup}　到目标输入框里粘贴即可`);
    // 🔴 复制完就关：不关的话这一层盖着整页，教师**点不到**要粘贴的那个输入框。
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="worksheet-editor-math-modal teacher-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worksheet-math-title"
        // ⚠️ 不让这一下冒到遮罩上：点弹窗**里面**不该关掉它（教师正在写公式）。
        onClick={(event) => event.stopPropagation()}
      >
        <header className="worksheet-editor-math-head">
          <div>
            <h2 id="worksheet-math-title">插入公式</h2>
            <p>写好后点「复制」，再到任何输入框里粘贴（题干、选项、答案、表格都行）。</p>
          </div>
          {/* 设计规范：关闭按钮始终位于右上角。 */}
          <button type="button" className="worksheet-editor-math-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>

        <div className="worksheet-editor-math-body">
          <label className="worksheet-editor-math-field">
            {/* 设计规范：标签始终位于输入框上方，不能只用 placeholder 代替。 */}
            <span>公式源码</span>
            <textarea
              ref={sourceRef}
              className="worksheet-editor-math-source"
              value={tex}
              autoFocus
              rows={2}
              placeholder="输入 LaTeX，例如 x^2 + \frac{1}{2}"
              onChange={(event) => setTex(event.target.value)}
            />
          </label>

          <div className="worksheet-editor-math-effect">
            <span className="worksheet-editor-math-effect-label">效果</span>
            <div className="worksheet-editor-math-effect-view">
              {tex.trim()
                ? <MathSpan tex={previewTex} />
                : <span className="worksheet-editor-math-hint">上面输入公式，这里看效果</span>}
            </div>
          </div>

          <div className="worksheet-editor-math-symbols">{symbolGroups}</div>
        </div>

        <footer className="worksheet-editor-math-foot">
          {error !== '' && <p className="worksheet-editor-math-error" role="alert">{error}</p>}
          {/* ⚠️ 用 `onMouseDown` + `preventDefault` 与符号按钮同一条理由：这一下可能
              把焦点从源码框拿走，而教师多半是在「点关闭之前还想再插一个符号」。 */}
          <button
            type="button"
            className="btn btn-secondary"
            onMouseDown={(event) => { event.preventDefault(); onClose(); }}
          >
            关闭
          </button>
          <button
            type="button"
            className="btn btn-primary"
            // 空源码时不能复制：`mathMarkup('')` 是空串，粘出去是空的（而教师会以为复制好了）。
            disabled={markup === ''}
            onMouseDown={(event) => { event.preventDefault(); void copy(); }}
          >
            复制
          </button>
        </footer>
      </div>
    </div>
  );
}
