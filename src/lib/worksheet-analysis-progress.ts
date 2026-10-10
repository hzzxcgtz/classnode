export type WorksheetAnalysisProgressStage = 'preparing' | 'sending' | 'analyzing' | 'finalizing';

/** Long-running tasks retain a separate notice; button labels only show real elapsed time. */
export const ANALYSIS_STUCK_AFTER_SECONDS = 200;

export function worksheetAnalysisProgressLabel(stage: WorksheetAnalysisProgressStage, elapsedSeconds: number): string {
  if (stage === 'preparing') return '整理数据…';
  if (stage === 'sending') return '正在发送…';
  if (stage === 'analyzing') {
    const seconds = Math.max(0, Math.floor(elapsedSeconds));
    if (seconds >= ANALYSIS_STUCK_AFTER_SECONDS) {
      /* ⚠️ 这里**不说死一个分钟数**：服务端那条上限以后可能会调（教师问过「有些任务很难估时间」），
         写死数字就会变成一句会过期的假话。 */
      return `AI 分析中 ${seconds}s · 比平时久，可能平台或网络卡住了 —— 可以继续等，也可以先关掉（它会接着跑，完成时会提示）`;
    }
    return `AI 分析中 ${seconds}s`;
  }
  return '保存结果…';
}
