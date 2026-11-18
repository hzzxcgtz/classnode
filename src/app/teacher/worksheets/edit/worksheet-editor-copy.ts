/** Shared editor wording; purpose labels describe behavior, not the input format. */
export const EDITOR_PURPOSE_HELP = {
  answer: '设置标准答案，提交后自动判分。教师仍可发起全班整体分析。',
  collect: '只收集作答，不判对错、不计分，不生成个人 AI 评价。教师仍可发起全班整体分析。',
} as const;
export const EDITOR_AUTO_REVIEW_HELP = '提交后自动生成个人 AI 评价，失败后可重试。';
export const EDITOR_CLOUD_HELP = '提炼有作答依据的观点，合并相近表达，保留不同立场及单人观点。观点云按提及人数展示前 10 条，其余可在全部观点中查看。';
export const EDITOR_CLOUD_PLACEHOLDER = '说明希望关注的内容，例如值得借鉴的做法、主要困惑或改进建议。';
