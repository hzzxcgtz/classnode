export type WorksheetAnalysisProgressStage = 'preparing' | 'sending' | 'analyzing' | 'finalizing';

/** 分析按钮的动态文案。两处按钮共用，避免一个写“发送中”、另一个还写“生成中”。 */
export function worksheetAnalysisProgressLabel(stage: WorksheetAnalysisProgressStage, elapsedSeconds: number): string {
  if (stage === 'preparing') return '整理数据…';
  if (stage === 'sending') return '正在发送…';
  if (stage === 'analyzing') return `AI 分析中 ${Math.max(0, Math.floor(elapsedSeconds))}s`;
  return '保存结果…';
}
