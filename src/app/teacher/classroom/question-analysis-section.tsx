'use client';

import { useEffect, useRef } from 'react';
import { AnalysisActions, AnalysisBanners, AnalysisBody, type WorksheetAnalysisState } from './analysis-panel';
import styles from './question-stats-overlay.module.css';

/** 阅读时自动展示已存结果；只有明确点击分析操作才会调用外部 AI。 */
export function QuestionAnalysisSection({ classroomId, worksheetId, questionId, initiallyExpanded, analyzed, analyzedAt, state, onOpenStudent }: {
  classroomId: string; worksheetId: string; questionId: string;
  /** 从侧栏“查看分析”进入时，定位到本区域。 */
  initiallyExpanded: boolean; analyzed: boolean; analyzedAt: string | null; state: WorksheetAnalysisState;
  onOpenStudent?: (participantId: string) => void;
}) {
  const region = useRef<HTMLElement>(null);
  const located = useRef(false);
  const ready = state.payload ? Boolean(state.payload.narrative) : analyzed;
  const time = state.payload ? state.payload.analyzedAt : analyzedAt;
  const timestamp = time && Number.isFinite(Date.parse(time))
    ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : null;
  const durationMs = state.payload?.analysisDurationMs;
  const seconds = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
    ? Math.max(1, Math.round(durationMs / 1000)) : null;
  const duration = seconds === null ? '耗时未记录' : seconds < 60
    ? `耗时 ${seconds} 秒` : `耗时 ${Math.floor(seconds / 60)} 分${seconds % 60 ? ` ${seconds % 60} 秒` : ''}`;
  const status = state.busy ? 'AI 分析中（后台继续）' : ready
    ? `${timestamp ? `上次分析：${timestamp}` : '分析时间未记录'} · ${duration}` : '尚未进行 AI 分析';

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
      <AnalysisBody onOpenStudent={onOpenStudent} compact state={state} classroomId={classroomId} worksheetId={worksheetId} questionId={questionId} />
    </div>
  </section>;
}
