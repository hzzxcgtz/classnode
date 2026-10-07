export type WorksheetAnalysisProgressStage = 'preparing' | 'sending' | 'analyzing' | 'finalizing';

/**
 * ★ 2026-10-07（教师：「一次分析要三分钟」「我**分不清还在跑和坏了**」）——
 * 服务端那条通道自己的上限是 **180 秒**（`ANALYSIS_POLL_TIMEOUT_SECONDS`，Coze 轮询）。
 *
 * ⚠️ 这**不是一个放弃的阈值**，只是「该给教师一句实话」的时刻 ——（服务端那条轮询上限
 *   2026-10-07 已按教师要求放大到 1 小时，所以「比平时久」更只是提示，不是快到头了）——
 *   教师随后问过「如果我不设超时时间呢？有些任务真难估计」⇒ 任务是**允许跑更久**的，
 *   这里只是在超过服务端那条上限之后，把文案从「一般 1～3 分钟」换成「比平时久，可能卡住了」。
 *   等不等由教师定：关掉面板任务照跑（后台会接着跑，完成时弹提示）。
 */
export const ANALYSIS_STUCK_AFTER_SECONDS = 200;

/** 正常一次分析大概多久 —— 给教师一个**参照**，否则「42s」这行字本身说明不了任何事。 */
const ANALYSIS_TYPICAL_HINT = '一般 1～3 分钟';

/**
 * 分析按钮的动态文案。两处按钮共用，避免一个写“发送中”、另一个还写“生成中”。
 *
 * ⚠️ 分析那一档**必须给参照**：原来只有 `AI 分析中 42s`，教师没法判断 42 秒是正常还是卡住了，
 *    而这条链路真的会跑几分钟（4 张图上传 + 平台推理）。
 */
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
    return `AI 分析中 ${seconds}s · ${ANALYSIS_TYPICAL_HINT}`;
  }
  return '保存结果…';
}
