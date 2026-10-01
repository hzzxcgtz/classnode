/**
 * 修正分析型智能体常见的 Markdown 小瑕疵，只用于教师端展示。
 *
 * 原始 narrative 仍按平台返回值保存：这里不改库，也不影响再次导出或审计。
 * 部分模型会输出 `**标签： **正文`（结束标记前多一个空格），CommonMark 不会
 * 把它识别为加粗；连续空白行则会让块级内容显得过度松散。
 */
export function normalizeWorksheetAnalysisMarkdown(source: string): string {
  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\*\*([^*\n]*?\S)[ \t]+\*\*/g, '**$1** ')
    // `**主要表现：**正文` 在 CommonMark 中可能因中文标点边界无法闭合，继而与
    // 后面的加粗片段错误配对。只修正以冒号结尾的字段标签，避免改动普通强调内容。
    .replace(/\*\*([^*\n]+?[：:])\*\*(?=\S)/g, '**$1** ')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim();
}
