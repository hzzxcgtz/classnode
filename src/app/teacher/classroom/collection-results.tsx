'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { IconChartBar, IconDeviceDesktop, IconMessages, IconSparkles } from '@tabler/icons-react';
import type { WorksheetQuestionNode } from '@/lib/types';
import { aiEvaluationEnabled, hasEvaluation } from '@/lib/worksheet-evaluation';
import { readAnswerSets } from '@/lib/worksheet-answer-view';
import { fillSettingsFor } from '@/lib/worksheet-fill-modes';
import { readPromptRuns } from '@/lib/worksheet-prompt-marks';
import { draftFromValue, isMultipleChoice } from '@/lib/worksheet-questions';
import type { WorksheetAnalysisState } from './analysis-panel';
import { AnswerViewBody } from './answer-view';
import { ClassroomImagePreviewContext } from './answer-photo';
import type { Bar, QuestionDistribution, QuestionStats, StatsRow } from './worksheet-question-stats';
import { OpinionCloud } from './opinion-cloud';
import styles from './collection-results.module.css';
import boardStyles from './question-stats-overlay.module.css';

export function isCollectionQuestion(node: WorksheetQuestionNode): boolean {
  if (node.type === 'fill-blank' || node.type === 'choice-blank') {
    const slots = fillSettingsFor(node, readPromptRuns(node.data.promptRuns, node.prompt));
    const answers = readAnswerSets(node.data.answers);
    if (slots.some(slot => slot.evaluationVersion === 1 || slot.gradingMode !== undefined)) {
      return slots.every((slot, index) => {
        if (slot.evaluationVersion === 1) return slot.evaluationMode === 'collect';
        if (node.autoGrade === false || slot.gradingMode === 'none') return true;
        return slot.mode !== 'audio' ? !answers[index]?.length : slot.gradingMode !== 'ai';
      });
    }
  }
  if (hasEvaluation(node.data)) return node.data.evaluationMode === 'collect';
  if (aiEvaluationEnabled(node)) return false;
  return node.autoGrade === false || node.type === 'short-answer' || node.type === 'open-ended' || node.type === 'drawing';
}

type View = 'distribution' | 'cloud' | 'answers';
const VIEW_LABELS: Record<View, string> = { distribution: '作答分布', cloud: '观点云', answers: '原答' };

function Bars({ bars, total, unit }: { bars: Array<Bar & { steps?: string[] }>; total: number; unit: string }) {
  return <ul className={styles.bars}>{bars.map(({ label, count, steps }, index) => {
    const rate = total ? Math.round(count / total * 100) : 0;
    return <li key={index}>
      <span className={styles.barLabel}>{steps ? `排序组合 ${index + 1}` : label}</span>
      <div className={styles.barValue}><span>{count} {unit}</span><strong>{rate}%</strong></div>
      {steps && <ol className={styles.orderSteps}>
        {steps.map((step, position) => <li key={position}>
          <span aria-hidden="true">{position + 1}</span>{step}
        </li>)}
      </ol>}
      <div className={styles.track} aria-hidden="true"><div style={{ width: `${rate}%` }} /></div>
    </li>;
  })}</ul>;
}

export function CollectionResults({ node, stats, rows, unit, analysisState, onOpenStudent, renderMatrix }: {
  node: WorksheetQuestionNode;
  stats: QuestionStats;
  rows: ReadonlyArray<StatsRow | undefined>;
  unit: string;
  analysisState: WorksheetAnalysisState;
  onOpenStudent?: (id: string) => void;
  renderMatrix: (data: Extract<QuestionDistribution, { kind: 'match' | 'categorize' }>) => ReactNode;
}) {
  const submitted = useMemo(() => rows.filter((row): row is StatsRow => row?.status === 'submitted'), [rows]);
  const hasText = useMemo(() => submitted.some(row => {
    const draft = draftFromValue(node, row.value);
    return draft.kind === 'text' ? Boolean(draft.text.trim())
      : draft.kind === 'fill' && draft.texts.some(text => text.trim());
  }), [node, submitted]);
  const hasClassAnalysis = Boolean(analysisState.payload?.narrative);
  const phrases = hasClassAnalysis ? analysisState.payload?.feedback?.wordCloud : undefined;
  const sharedPhrases = useMemo(() => (phrases ?? [])
    .filter(({ studentIds }) => studentIds.length >= 2)
    .slice(0, 10), [phrases]);
  const distribution = stats.distribution;
  const views: View[] = [];
  if (distribution && !['text', 'ink'].includes(distribution.kind)) views.push('distribution');
  if (distribution?.kind === 'text' || hasText || phrases?.length) views.push('cloud');
  if (distribution?.kind !== 'text') views.push('answers');
  const [selected, setSelected] = useState<View | null>(null);
  const [projecting, setProjecting] = useState(false);
  const [fontScale, setFontScale] = useState(100);
  const [showCounts, setShowCounts] = useState(true);
  const [layoutSeed, setLayoutSeed] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const launchButton = useRef<HTMLButtonElement>(null);
  const view = selected && views.includes(selected) ? selected : views[0];
  const answerNode = useMemo(() => ({
    ...node,
    data: { ...node.data, correctKeys: [], answers: [], correctOrder: [], pairs: [], placement: {} },
  }), [node]);

  function renderContent(presentation: boolean) {
    const projectionButton = <button ref={presentation ? undefined : launchButton} type="button"
      className={`btn btn-secondary ${styles.projectionButton}`} onClick={() => {
        if (presentation) dialog.current?.close();
        else { dialog.current?.showModal(); setProjecting(true); }
      }}><IconDeviceDesktop size={16} aria-hidden="true" />{presentation ? '退出投屏' : '投屏展示'}</button>;

    return <>
      {!presentation && <header className={boardStyles.analysisResultHeader} data-tone="feedback">
        <div className={boardStyles.analysisIdentity}>
          <h3 className={boardStyles.analysisResultTitle}>
            <IconChartBar size={22} aria-hidden="true" />课堂反馈看板
          </h3>
          <span className={styles.submission}>已提交 <strong>{stats.submitted} / {stats.total}</strong> {unit}</span>
        </div>
        {view !== 'cloud' && projectionButton}
      </header>}
      {presentation && view !== 'cloud' && <div className={styles.projectionActions}>{projectionButton}</div>}
      <div className={presentation ? undefined : styles.boardContent} data-view={view}>
        {views.length > 1 && <div role="group" aria-label="结果展示方式" className={styles.views}>
          {views.map(key => <button type="button" key={key} aria-pressed={view === key} onClick={() => setSelected(key)}
            className={`btn ${view === key ? 'btn-primary' : 'btn-secondary'}`}>{VIEW_LABELS[key]}</button>)}
        </div>}
        {view !== 'cloud' && !submitted.length && <p>等待学生提交后即可查看结果。</p>}
        {view === 'distribution' && submitted.length > 0 && <>
          <div className={styles.distributionHeading}>
            <h4>{distribution?.kind === 'order' ? '最常见的排序组合' : '作答分布'}</h4>
            <p>按已提交的 {stats.submitted} {unit}计算比例{isMultipleChoice(node) ? '，多选题各项独立统计' : ''}</p>
          </div>
          {distribution?.kind === 'options' && <Bars bars={distribution.bars} total={stats.submitted} unit={unit} />}
          {distribution?.kind === 'order' && <Bars bars={distribution.topOrders} total={stats.submitted} unit={unit} />}
          {distribution?.kind === 'blanks' && distribution.blanks.map(blank => <section key={blank.label}>
            <h4>{blank.label}</h4>
            {blank.bars.length ? <Bars bars={blank.bars} total={stats.submitted} unit={unit} /> : <p>暂无文字或选词可统计。</p>}
          </section>)}
          {(distribution?.kind === 'match' || distribution?.kind === 'categorize') && renderMatrix(distribution)}
        </>}
        {view === 'cloud' && <>
          <div className={styles.cloudHeader}>
            <div>
              <h4 className={styles.cloudTitle}><IconMessages size={22} aria-hidden="true" />观点云</h4>
              {!presentation && sharedPhrases.length > 0 && <p className={styles.cloudNote}>AI 归纳相近作答</p>}
            </div>
            <div className={styles.cloudControls} role="group" aria-label="观点云展示操作">
              {sharedPhrases.length > 0 && <>
                <div className={styles.fontControls} role="group" aria-label="观点字号">
                  <button type="button" className="btn btn-secondary" aria-label="缩小观点字号" disabled={fontScale <= 70}
                    onClick={() => setFontScale(value => Math.max(70, value - 10))}>A−</button>
                  <output aria-label="当前字号比例">{fontScale}%</output>
                  <button type="button" className="btn btn-secondary" aria-label="放大观点字号" disabled={fontScale >= 150}
                    onClick={() => setFontScale(value => Math.min(150, value + 10))}>A+</button>
                </div>
                <button type="button" className="btn btn-secondary" aria-pressed={showCounts}
                  onClick={() => setShowCounts(value => !value)}>显示份数</button>
                <button type="button" className="btn btn-secondary"
                  onClick={() => setLayoutSeed(value => value + 1)}>重新排布</button>
              </>}
              {projectionButton}
            </div>
          </div>
          {sharedPhrases.length ? <>
            {analysisState.payload?.stale && <p className={styles.cloudNote}>当前显示上次分析的观点云。重新生成班级分析后可更新。</p>}
            <OpinionCloud phrases={sharedPhrases} presentation={presentation} fontScale={fontScale}
              showCounts={showCounts} layoutSeed={layoutSeed} />
          </> : <div className={styles.cloudNotice} role="status">
            <IconSparkles size={19} aria-hidden="true" />
            <span>{analysisState.loading ? '正在读取观点云…'
              : analysisState.busy ? '正在整理全班的共同观点，请稍等…'
              : !hasClassAnalysis
                ? submitted.length
                  ? presentation ? '完成全班分析后，就能在这里看到同学们的共同观点。'
                    : '在下方生成全班分析后，就能在这里看到同学们的共同观点。'
                  : '等同学们提交作答后，生成全班分析即可查看观点云。'
                : phrases ? '这次分析还没有发现至少两份作答共有的观点。'
                : '这份分析暂无观点云，更新全班分析后即可重新整理。'}</span>
          </div>}
        </>}
        {view === 'answers' && submitted.length > 0 && <div className={styles.cards}>
          {submitted.map((row, index) => <article key={row.participantId}>
            <h4>{presentation ? `作答 ${index + 1}` : row.participantName}</h4>
            <AnswerViewBody node={answerNode} value={row.value} transcription={false} neutral />
            {!presentation && onOpenStudent && <button type="button" className="btn btn-secondary"
              onClick={() => onOpenStudent(row.participantId)}>查看作答详情</button>}
          </article>)}
        </div>}
      </div>
    </>;
  }

  return <section className={styles.board}>
    {!projecting && renderContent(false)}
    <dialog ref={dialog} className={styles.projection} aria-label="信息收集结果投屏" onKeyDown={event => {
        if (event.key === 'Escape') event.stopPropagation();
      }} onClose={() => {
        setProjecting(false);
        requestAnimationFrame(() => launchButton.current?.focus());
      }}>
      {projecting && <ClassroomImagePreviewContext.Provider value={null}>{renderContent(true)}</ClassroomImagePreviewContext.Provider>}
    </dialog>
  </section>;
}
