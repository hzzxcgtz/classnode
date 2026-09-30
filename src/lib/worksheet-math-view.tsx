'use client';

import katex from 'katex';

/**
 * 一个公式的渲染（★ 2026-09-30）。
 *
 * 🔴 全仓**唯一**一处调 KaTeX 渲染题面公式的地方 —— 学生端、教师端、编辑页预览全走它。
 *    `worksheet-prompt-text.test.ts` 有一条断言钉着这一点：`PromptText` 里**不许**
 *    再出现一处 `katex.renderToString`（两份渲染就是本仓最防的那种分叉）。
 * ⚠️ KaTeX 的 CSS 已在 `src/app/layout.tsx:3` 全局加载，**这里不要再引**（引两次会让
 *    CSS 进两份 chunk）。
 * ⚠️ `throwOnError: false` ⇒ 语法错时 KaTeX **自己画一个红色的错误标记**（含原式），
 *    这是我们要的：教师当场看见哪里错了，而不是一片空白。
 * ⚠️ **必须 `dangerouslySetInnerHTML`**：KaTeX 输出的是 HTML 串（`rehype-katex` 也是这么
 *    干的）。安全性没问题 —— KaTeX 默认 `trust: false`，`\href` / `\htmlClass` 这类
 *    可注入的命令被禁用，输出由它自己转义。
 */
export function MathSpan({ tex }: { tex: string }) {
  const html = katex.renderToString(tex, {
    throwOnError: false,
    displayMode: false,
    // 与 `rehype-katex` 的默认一致：HTML + MathML 双份（后者给读屏）。
    output: 'htmlAndMathml',
  });
  return (
    <span
      className="worksheet-math"
      // KaTeX 输出的根节点自带 `katex` 类；外面这层只是为了**行内基线**能单独调
      //（公式与填空输入框同行时的对齐只能真机看，见 specs 的验收清单）。
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
