import { ImportedXmlComponent, type TextRun } from 'docx';
import katex from 'katex';
import { mml2omml } from 'mathml2omml';
import type { PaperInline } from './worksheet-paper.js';

/**
 * LaTeX → **Word 原生公式**（OMML）（★ 2026-09-30，教师裁定 ②）。
 *
 * 链路：`katex({output:'mathml'})` → MathML → `mathml2omml` → OMML →
 *       docx 的 `ImportedXmlComponent`（塞进 `Paragraph` 的 children）。
 *
 * 🔴 **本机验过的**（2026-09-30 探针）：生成的 `word/document.xml` 里确实出现
 *    `<m:oMath>` / 分数 `<m:f>` / 上标 `<m:sSup>` / 根号 `<m:rad>`，
 *    以及 `xmlns:m="…/officeDocument/2006/math"`。
 * ⚠️ **本机没有 Word** —— 只能证明 XML 合法（`<m:oMath>` 在、命名空间在、字符转义了），
 *    **不能**证明打开后排版对、分数画得正。验收要教师开 Word 看。
 *
 * ⚠️ **两个必须的加工**，少一个就出问题：
 *   ① KaTeX 的 MathML 外面包着一层 `<span class="katex">` ⇒ 要剥掉，
 *      否则 `mathml2omml` 拿到的是 HTML；
 *   ② KaTeX 会塞一个 `<annotation encoding="application/x-tex">`（原式）⇒ **必须剥掉**，
 *      否则 `mathml2omml` 打一行 `Type not supported: annotation`。结果虽然仍对，
 *      但噪音会掩盖真正的问题（那条警告是本探针第一次跑出来的）。
 *
 * 🔴 **许可证**：`mathml2omml` 是 **LGPL-3.0-or-later**，会随 dmg/msi 分发给学校 ⇒
 *    要附它的 LICENSE 与源码指向。⚠️ 合规文本放哪儿（随包附 / 「关于」页给链接）
 *    **由教师定** —— 见 `specs/2026-09-30-题干-数学公式.md` 末尾第 5 条。
 */

/**
 * 一个公式 → docx 的**行内**节点；认不出的 LaTeX ⇒ `null`（由调用方如实降级成源码）。
 *
 * ⚠️ 这里用 `throwOnError: true`（与前端那侧相反）：前端画一个红色错误标记就够了，
 *    而**纸上不能印一个红标记** ⇒ 转换失败必须被我们知道，好降级成源码。
 */
export function mathRun(tex: string): ImportedXmlComponent | null {
  try {
    const html = katex.renderToString(tex, {
      output: 'mathml',
      throwOnError: true,
      displayMode: false,
    });
    const mathml = html
      .replace(/^<span[^>]*>/, '')
      .replace(/<\/span>$/, '')
      .replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/g, '');
    return ImportedXmlComponent.fromXmlString(escapeMathText(mml2omml(mathml)));
  } catch {
    return null;
  }
}

/**
 * 🔴 **绕开 `mathml2omml` 的一个真缺陷**（2026-09-30 由「公式里的 `<` `&` 要转义」
 * 那条用例抓出来的）：它把文本**原样塞进 `<m:t>`**，一个字符都不转义 ⇒
 *   · `$a<b$` ⇒ `<m:t xml:space="preserve">a<b</m:t>` —— **非法 XML**；
 *   · `$x \& y$` ⇒ `<m:t xml:space="preserve">&</m:t>` —— 同样非法。
 * 而 `ImportedXmlComponent.fromXmlString` 用的是真 XML 解析器 ⇒ 它**抛**⇒ 我们这里
 * catch 掉 ⇒ 降级成源码。**症状是「这个公式在纸上印成了源码」**，而不是它本可以造成的
 * 「Word 说文件已损坏」（那条路被这个 catch 挡住了，属于因祸得福）。
 *
 * ⚠️ 只动 `<m:t>`（`m:t` 是 OMML 里唯一的**文本**节点，内容里没有嵌套标签 ⇒ 正则是安全的）。
 * ⚠️ `&` 用**前瞻**排除已有的实体：万一哪天 `mathml2omml` 开始转义了，
 *    这条也不会把 `&amp;` 二次转义成 `&amp;amp;`。
 * ⚠️ `>` 也一并转义：XML 里裸 `>` 合法，但转了对谁都无害，而且省得以后再想一遍。
 */
function escapeMathText(omml: string): string {
  return omml.replace(
    /(<m:t\b[^>]*>)([\s\S]*?)(<\/m:t>)/g,
    (_all, open: string, text: string, close: string) => open
      + text
        .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      + close,
  );
}

/**
 * 一段行内内容 → docx 的 children（文字走 `TextRun`，公式走 OMML）。
 *
 * ⚠️ `runOf` 由**调用方**给：字号 / 颜色 / 字体是渲染层的事，转换层不该知道排版 ——
 *    这是「判据层 / 渲染层」那条分工线在这一处的延续。
 * 🔴 转换失败时印 **`$…$` 源码**（带着 `$`），让教师一眼看出「这里本该是个公式」，
 *    而**不是**印一个空白 —— 空白是「这里本来就没内容」的意思，两件事不能混。
 */
export function inlineChildren(
  parts: readonly PaperInline[],
  runOf: (text: string) => TextRun,
): (TextRun | ImportedXmlComponent)[] {
  const out: (TextRun | ImportedXmlComponent)[] = [];
  for (const part of parts) {
    if (part.kind === 'math') {
      const math = mathRun(part.tex);
      out.push(math ?? runOf(`$${part.tex}$`));
      continue;
    }
    out.push(runOf(part.text));
  }
  return out;
}
