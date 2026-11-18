'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { IconChartBar, IconChevronDown, IconDeviceDesktop, IconMessages, IconSparkles } from '@tabler/icons-react';
import type { WorksheetQuestionNode } from '@/lib/types';
import type { RewardStyle } from '@/lib/worksheet-reward';
import { ratingConfig } from '@/lib/worksheet-rating';
import { aiEvaluationEnabled, hasEvaluation } from '@/lib/worksheet-evaluation';
import { readAnswerSets } from '@/lib/worksheet-answer-view';
import { fillSettingsFor } from '@/lib/worksheet-fill-modes';
import { readPromptRuns } from '@/lib/worksheet-prompt-marks';
import { isMultipleChoice } from '@/lib/worksheet-questions';
import type { WorksheetAnalysisState } from './analysis-panel';
import { AnswerViewBody } from './answer-view';
import { AnswerPhoto, ClassroomImagePreviewContext } from './answer-photo';
import { InkPreview } from './ink-preview';
import { canvasRegionStats, type Bar, type QuestionDistribution, type QuestionStats, type StatsRow } from './worksheet-question-stats';
import { rankedOpinions, OPINION_CLOUD_LIMIT } from '@/lib/opinion-views';
import { RatingDistributionTable } from './rating-distribution';
import { RatingTileResult } from './rating-tile-result';
import { OpinionCloud } from './opinion-cloud';
import styles from './collection-results.module.css';
import boardStyles from './question-stats-overlay.module.css';

export function isCollectionQuestion(node: WorksheetQuestionNode): boolean {
  if (node.type === 'image-canvas' || node.type === 'rating') return true;
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

type View = 'distribution' | 'cloud';
const VIEW_LABELS: Record<View, string> = { distribution: '作答分布', cloud: '观点云' };

export function isExpressionQuestion(node: WorksheetQuestionNode): boolean {
  return node.type === 'short-answer' || node.type === 'open-ended' || (node.type === 'rating' && ratingConfig(node.data).commentEnabled);
}

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

export function CollectionResults({ node, stats, rows, unit, rewardStyle, analysisState, renderMatrix, cloudOnly = false }: {
  node: WorksheetQuestionNode;
  rewardStyle?: RewardStyle;
  stats: QuestionStats;
  rows: ReadonlyArray<StatsRow | undefined>;
  unit: string;
  analysisState: WorksheetAnalysisState;
  onOpenStudent?: (id: string) => void;
  renderMatrix: (data: Extract<QuestionDistribution, { kind: 'match' | 'categorize' }>) => ReactNode;
  cloudOnly?: boolean;
}) {
  const submitted = useMemo(() => rows.filter((row): row is StatsRow => row?.status === 'submitted'), [rows]);
  const hasClassAnalysis = Boolean(analysisState.payload?.narrative);
  const phrases = hasClassAnalysis ? analysisState.payload?.feedback?.wordCloud : undefined;
  const reportRevision = hasClassAnalysis ? analysisState.payload?.analyzedAt ?? analysisState.payload?.narrative ?? null : null;
  const [cloudReport, setCloudReport] = useState(() => ({ revision: reportRevision, phrases }));
  if (cloudReport.revision !== reportRevision) {
    setCloudReport({ revision: reportRevision, phrases });
  }
  const reportPhrases = cloudReport.revision === reportRevision ? cloudReport.phrases : phrases;
  const allPhrases = useMemo(() => rankedOpinions(reportPhrases ?? []), [reportPhrases]);
  const sharedPhrases = allPhrases.slice(0, OPINION_CLOUD_LIMIT);
  const [opinionView, setOpinionView] = useState<'cloud' | 'list'>('cloud');
  const distribution = stats.distribution;
  const canvas = node.type === 'image-canvas';
  const regions = useMemo(() => canvasRegionStats(node, rows), [node, rows]);
  const views: View[] = [];
  if (canvas || (!cloudOnly && distribution && !['text', 'ink'].includes(distribution.kind))) views.push('distribution');
  if (isExpressionQuestion(node)) views.push('cloud');
  const [selectedPhrase, setSelectedPhrase] = useState<string | null>(null);
  const phraseEvidence = allPhrases.find(phrase => phrase.phrase === selectedPhrase);
  const examples = phraseEvidence ? submitted.filter(row => phraseEvidence.studentIds.includes(row.participantId)) : [];
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
      {!presentation && !cloudOnly && <header className={boardStyles.analysisResultHeader} data-tone="feedback">
        <div className={boardStyles.analysisIdentity}>
          <h3 className={boardStyles.analysisResultTitle}>
            <IconChartBar size={22} aria-hidden="true" />课堂反馈看板
          </h3>
          <span className={styles.submission}>已提交 <strong>{stats.submitted} / {stats.total}</strong> {unit}</span>
        </div>
      </header>}
      <div className={presentation ? styles.projectionContent : styles.boardContent} data-view={view}>
        {!presentation && views.length > 1 && <div role="group" aria-label="结果展示方式" className={`${styles.views} ${styles.resultViews}`}>
          {views.map(key => <button type="button" key={key} aria-pressed={view === key} onClick={() => setSelected(key)}
            className={`btn ${view === key ? 'btn-primary' : 'btn-secondary'}`}>{VIEW_LABELS[key]}</button>)}
        </div>}
        {view !== 'cloud' && !canvas && !submitted.length && <p>等待学生提交后即可查看结果。</p>}
        {canvas && <div className={styles.canvasRegions}>
          {regions.length === 0 && <p>这道图文题没有可统计的作答区。</p>}
          {regions.map((region, index) => <section key={region.id} className={styles.canvasRegion}>
            <header>
              <span className={styles.canvasRegionNumber}>{index + 1}</span>
              <div><h4>{region.title}</h4><small>{region.mode}</small></div>
            </header>
            <dl>
              <div><dt>已作答</dt><dd>{region.answered} {unit}</dd></div>
              <div><dt>已交但本区无作答</dt><dd>{region.missing} {unit}</dd></div>
            </dl>
            {region.distributions.map(({ title, bars, total }) => <div key={title} className={styles.canvasBreakdown}>
              <h5>{title}<small>{total} {unit}</small></h5>
              <Bars bars={bars} total={total} unit={unit} />
            </div>)}
            {region.samples.length > 0 && <div className={styles.canvasBreakdown}>
              <h5>作答缩略图<small>{region.samples.length} 份</small></h5>
              <div className={styles.canvasSamples}>
                {region.samples.map((sample, i) => <div key={i}>
                  {sample.kind === 'photo' ? <AnswerPhoto url={sample.url} /> : <InkPreview value={sample.ink} />}
                </div>)}
              </div>
            </div>}
          </section>)}
        </div>}
        {view === 'distribution' && !canvas && submitted.length > 0 && <>
          <div className={`${styles.distributionHeading} ${node.type === 'rating' ? styles.ratingDistributionHeading : ''}`}>
            {distribution?.kind === 'order' && <h4>最常见的排序组合</h4>}
            <p>{node.type === 'rating' ? '各维度按实际评价人数计算，未评价不计入平均值。' : <>按已提交的 {stats.submitted} {unit}计算比例{isMultipleChoice(node) ? '，多选题各项独立统计' : ''}</>}</p>
          </div>
          {distribution?.kind === 'rating' && <RatingDistributionTable rewardStyle={rewardStyle} data={distribution} max={ratingConfig(node.data).maxStars} unit={unit} />}
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
            <div className={styles.cloudIdentity}>
              {(presentation || cloudOnly || views.length <= 1) && <h4 className={styles.cloudTitle}><IconMessages size={22} aria-hidden="true" />观点云</h4>}
              {sharedPhrases.length > 0 && <div role="group" aria-label="观点展示方式" className={`purpose-segmented-control ${styles.opinionViews}`}>
                <button type="button" className={opinionView === 'cloud' ? 'is-selected' : ''} aria-pressed={opinionView === 'cloud'} onClick={() => setOpinionView('cloud')}>观点云 · 前{sharedPhrases.length}条</button>
                <button type="button" className={opinionView === 'list' ? 'is-selected' : ''} aria-pressed={opinionView === 'list'} onClick={() => setOpinionView('list')}>全部观点 · {allPhrases.length}条</button>
              </div>}
            </div>
            <div className={styles.cloudControls} role="group" aria-label="观点云展示操作">
              {sharedPhrases.length > 0 && opinionView === 'cloud' && <>
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
          {!presentation && sharedPhrases.length > 0 && <p className={`${styles.cloudNote} ${styles.cloudPolicy}`}>按提及人数排序，不评价观点好坏</p>}
          {sharedPhrases.length ? <>
            {analysisState.payload?.stale && <p className={styles.cloudNote}>当前显示上次分析的观点云。重新生成班级分析后可更新。</p>}
            {opinionView === 'list' ? <ol className={styles.opinionList}>
              {allPhrases.map(item => <li key={item.phrase}><button type="button" aria-pressed={selectedPhrase === item.phrase}
                onClick={() => setSelectedPhrase(selectedPhrase === item.phrase ? null : item.phrase)}>
                <span>{item.phrase}</span><strong>{item.studentIds.length} {unit}</strong>
              </button></li>)}
            </ol> : <OpinionCloud phrases={sharedPhrases} presentation={presentation} fontScale={fontScale}
              showCounts={showCounts} layoutSeed={layoutSeed}
              selectedPhrase={selectedPhrase}
              onSelectPhrase={setSelectedPhrase} />}
            {!presentation && <p className={styles.cloudNote}>点击一个观点，查看相关作答。</p>}
            {phraseEvidence && <details open key={phraseEvidence.phrase} className={styles.cloudEvidence}>
              <summary className={styles.cloudEvidenceHeading}>
                <strong>{phraseEvidence.phrase}</strong>
                <span className={styles.cloudEvidenceCount}>{phraseEvidence.studentIds.length} 份作答</span>
                <IconChevronDown size={18} aria-hidden="true" />
              </summary>
              {analysisState.payload?.stale
                ? <p>重新生成全班分析后，可查看与当前作答对应的内容。</p>
                : examples.length > 0 ? <>
                  {examples.length > 2 && <p className={styles.cloudScrollHint}>左右滑动查看</p>}
                  <div className={styles.cloudEvidenceTrack} tabIndex={0} role="region" aria-label="相关学生作答，可横向滚动">
                    {examples.map((row, index) => <article key={row.participantId} className={styles.cloudEvidenceCard}>
                      <header><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><h5>{row.participantName}</h5></header>
                      <div className={styles.cloudAnswer}>{node.type === 'rating'
                        ? <RatingTileResult node={node} value={row.value} rewardStyle={rewardStyle} />
                        : <AnswerViewBody node={answerNode} value={row.value} neutral />}</div>
                    </article>)}
                  </div>
                  {examples.length < phraseEvidence.studentIds.length && <p>当前可查看 {examples.length} 份作答。</p>}
                </> : <p>当前没有可查看的作答。</p>}
            </details>}
          </> : <div className={styles.cloudNotice} role="status">
            <IconSparkles size={19} aria-hidden="true" />
            <span>{analysisState.loading ? '正在读取观点云…'
              : analysisState.busy ? '正在整理全班的共同观点，请稍等…'
              : !hasClassAnalysis
                ? submitted.length
                  ? presentation ? '完成全班分析后，就能在这里看到同学们的共同观点。'
                    : '在下方生成全班分析后，就能在这里看到同学们的共同观点。'
                  : '等同学们提交作答后，生成全班分析即可查看观点云。'
                : reportPhrases ? '这次分析尚未提炼出有作答依据的观点。'
                : '这份分析暂无观点云，更新全班分析后即可重新整理。'}</span>
          </div>}
        </>}

      </div>
    </>;
  }

  return <section className={styles.board}>
    {!projecting && renderContent(false)}
    {view === 'cloud' && <dialog ref={dialog} className={styles.projection} data-view={view} aria-label="观点云投屏" onKeyDown={event => {
        if (event.key === 'Escape') event.stopPropagation();
      }} onClose={() => {
        setProjecting(false);
        requestAnimationFrame(() => launchButton.current?.focus());
      }}>
      {projecting && <ClassroomImagePreviewContext.Provider value={null}>{renderContent(true)}</ClassroomImagePreviewContext.Provider>}
    </dialog>}
  </section>;
}
