'use client';

import { useEffect, useRef } from 'react';
import { AnalysisActions, AnalysisBanners, AnalysisBody, useWorksheetAnalysis } from './analysis-panel';
import styles from './question-stats-overlay.module.css';

/** 阅读时自动展示已存结果；只有明确点击分析操作才会调用外部 AI。 */
export function QuestionAnalysisSection({ classroomId, worksheetId, questionId, mode, initiallyExpanded, analyzed, analyzedAt }: {
  classroomId: string; worksheetId: string; questionId: string; mode: string;
  /** 从侧栏“查看分析”进入时，定位到本区域。 */
  initiallyExpanded: boolean; analyzed: boolean; analyzedAt: string | null;
}) {
  const region = useRef<HTMLElement>(null);
  const located = useRef(false);
  const state = useWorksheetAnalysis(classroomId, worksheetId, questionId, mode);
  const ready = state.payload ? Boolean(state.payload.narrative) : analyzed;
  const time = state.payload ? state.payload.analyzedAt : analyzedAt;
  const timestamp = time && Number.isFinite(Date.parse(time))
    ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : null;
  const status = state.busy ? 'AI 分析中（后台继续）' : ready
    ? `已分析 · ${timestamp ? `最近分析：${timestamp}` : '分析时间未记录'}` : '尚未进行 AI 分析';

  useEffect(() => {
    if (!initiallyExpanded || state.loading || located.current) return;
    const frame = window.requestAnimationFrame(() => {
      region.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
      located.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initiallyExpanded, state.loading]);

  return <section ref={region} aria-label="本题 AI 分析">
    <div className={styles.inlineAnalysis}>
    <header className={styles.analysisResultHeader}>
      <span><strong className={styles.analysisHeading}>AI 分析</strong><span>{status}</span></span>
      <div className={styles.inlineAnalysisActions}><AnalysisActions state={state} compact /></div>
    </header>
      <AnalysisBanners state={state} />
      <AnalysisBody compact state={state} classroomId={classroomId} worksheetId={worksheetId} questionId={questionId} />
    </div>
  </section>;
}
