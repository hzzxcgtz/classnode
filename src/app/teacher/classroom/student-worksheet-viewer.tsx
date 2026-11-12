'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { IconBook2, IconLayoutColumns, IconListDetails, IconX } from '@tabler/icons-react';
import { WorksheetQuestionList } from '@/app/classroom/worksheet/worksheet-panel';
import type { AnswerReview } from '@/app/classroom/worksheet/review-history';
import worksheetStyles from '@/app/classroom/worksheet/worksheet.module.css';
import { getApiBaseUrl } from '@/lib/api-base';
import type { WorksheetBoardParticipant, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
import { resolveWorksheetBackgroundSources } from '@/lib/worksheet-backgrounds';
import { draftFromValue, questionTypeLabel, studentVisibleGroups } from '@/lib/worksheet-questions';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { resolveRewardScale, resolveWorksheetFullStep } from '@/lib/worksheet-reward';
import { normalizeWorksheetSurfaceOpacity, surfaceAlphas } from '@/lib/worksheet-surface';
import { answerRowWithDraft } from './worksheet-board-data';
import { rowVerdict } from './worksheet-drawer-state';
import { WorksheetTaskNavigation } from './worksheet-task-navigation';
import styles from './student-worksheet-viewer.module.css';

interface ViewerSource {
  classroomId: string;
  worksheetId: string;
  title: string;
  participant: WorksheetBoardParticipant;
  nodes: WorksheetQuestionNode[];
  settings?: WorksheetSettings;
  liveDraft?: Parameters<typeof answerRowWithDraft>[1];
}

export function StudentWorksheetViewerButton({ className, ...source }: ViewerSource & { className?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={[styles.launch, className].filter(Boolean).join(' ')}
      aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <IconBook2 size={17} aria-hidden="true" />查看学习单
    </button>
    {open && <StudentWorksheetViewer {...source} onClose={() => setOpen(false)} />}
  </>;
}

function StudentWorksheetViewer({ classroomId, worksheetId, title, participant, nodes, settings, liveDraft, onClose }: ViewerSource & { onClose: () => void }) {
  const [mode, setMode] = useState<'continuous' | 'slides'>('continuous');
  const [active, setActive] = useState(0);
  const [reviews, setReviews] = useState<AnswerReview[]>([]);
  const [reviewsFailed, setReviewsFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const pagePositions = useRef(new Map<string, number>());
  const activeRef = useRef(0);
  const titleId = useId();
  const groups = useMemo(() => studentVisibleGroups(nodes), [nodes]);
  const slides = useMemo(() => groups.flatMap(group => group.items.map(item => ({
    ...group, items: [item],
  }))), [groups]);
  const activeIndex = Math.min(active, Math.max(0, slides.length - 1));
  activeRef.current = activeIndex;
  const { drafts, statuses, grades, scores, currentReviews, submitted } = useMemo(() => {
    const answerRows = new Map(participant.answerRows.map(row => [row.questionId, row]));
    const drafts: Parameters<typeof WorksheetQuestionList>[0]['drafts'] = {};
    const statuses: Parameters<typeof WorksheetQuestionList>[0]['statuses'] = {};
    const grades: NonNullable<Parameters<typeof WorksheetQuestionList>[0]['gradeStates']> = {};
    const scores: NonNullable<Parameters<typeof WorksheetQuestionList>[0]['scores']> = {};
    const submittedValues = new Map<string, string | undefined>();
    for (const { items } of groups) for (const { node } of items) {
      const row = answerRowWithDraft(answerRows.get(node.id), liveDraft, worksheetId, node.id);
      if (row?.status !== 'draft' && row?.status !== 'submitted') continue;
      statuses[node.id] = row.status;
      if (row.value != null) drafts[node.id] = draftFromValue(node, row.value);
      if (row.status === 'submitted') {
        scores[node.id] = row.score;
        grades[node.id] = rowVerdict(row);
        submittedValues.set(node.id, JSON.stringify(row.value));
      }
    }
    const currentReviews = reviews.filter(review => submittedValues.has(review.questionId)
      && submittedValues.get(review.questionId) === JSON.stringify(review.value));
    return { drafts, statuses, grades, scores, currentReviews, submitted: submittedValues.size };
  }, [groups, liveDraft, participant.answerRows, reviews, worksheetId]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    element.focus({ preventScroll: true });
    return () => {
      if (typeof element.close === 'function') element.close();
      else element.removeAttribute('open');
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ classroomId, participantId: participant.participantId });
    void fetch(`${getApiBaseUrl()}/api/worksheets/${encodeURIComponent(worksheetId)}/reviews?${params}`, {
      credentials: 'include', signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('读取评价失败');
      const result: { reviews: AnswerReview[] } = await response.json();
      if (!controller.signal.aborted) setReviews(result.reviews ?? []);
    }).catch(() => {
      if (!controller.signal.aborted) setReviewsFailed(true);
    });
    return () => controller.abort();
  }, [classroomId, participant.participantId, worksheetId]);

  useEffect(() => {
    track.current?.querySelectorAll<HTMLAudioElement>('section[inert] audio').forEach(audio => audio.pause());
  }, [activeIndex]);

  useLayoutEffect(() => {
    const slot = track.current?.children[activeIndex];
    const page = slot?.querySelector<HTMLElement>('section');
    const id = slides[activeIndex]?.items[0].node.id;
    if (page && id) page.scrollTop = pagePositions.current.get(id) ?? 0;
  }, [activeIndex, mode, slides]);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const alignPage = () => {
      const slot = element.firstElementChild as HTMLElement | null;
      if (slot) element.scrollTo({ left: slot.getBoundingClientRect().width * activeRef.current, behavior: 'auto' });
    };
    alignPage();
    const observer = new ResizeObserver(alignPage);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode, slides.length]);

  const background = resolveWorksheetBackgroundSources(settings?.backgroundTheme ?? 'none', settings?.backgroundImageUrl ?? null, settings?.backgroundPortraitImageUrl ?? null);
  const landscape = background.landscape ?? background.portrait;
  const alphas = surfaceAlphas(normalizeWorksheetSurfaceOpacity(settings?.surfaceOpacity));
  const surface = {
    '--ws-card-alpha': alphas.card,
    '--ws-card-active-alpha': alphas.cardActive,
    '--ws-surface-alpha': alphas.container,
    ...(landscape ? { '--worksheet-background-landscape': `url(${worksheetAssetUrl(landscape)})` } : {}),
    ...(background.portrait ? { '--worksheet-background-portrait': `url(${worksheetAssetUrl(background.portrait)})` } : {}),
  } as CSSProperties;
  const surfaceProps = {
    'data-has-background': landscape ? '1' : '0',
    'data-has-portrait': background.portrait ? '1' : '0',
    style: surface,
  };
  const reward = settings ? resolveRewardScale(settings) : null;
  const renderQuestions = (visibleGroups: typeof groups) => <WorksheetQuestionList
    groups={visibleGroups} drafts={drafts} statuses={statuses} gradeStates={grades} scores={scores}
    reviews={currentReviews} submitting={{}} interactive={false} reviewOnly answersLocked={false}
    allowResubmit={false} reward={reward} rewardFullFallback={resolveWorksheetFullStep(settings)}
  />;
  const goTo = (index: number) => {
    const element = track.current;
    if (!element || index < 0 || index >= slides.length) return;
    const slot = element.firstElementChild as HTMLElement | null;
    if (!slot) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({ left: slot.getBoundingClientRect().width * index, behavior: reduceMotion || Math.abs(index - activeIndex) > 1 ? 'auto' : 'smooth' });
  };

  return createPortal(<dialog ref={dialog} tabIndex={-1} className={styles.dialog}
    aria-labelledby={titleId} aria-modal="true" data-view-mode={mode} data-overscroll-guard=""
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (mode !== 'slides' || !['ArrowLeft', 'ArrowRight'].includes(event.key)
        || (event.target instanceof Element && event.target.closest('input, textarea, select, audio, video, [role="slider"]'))) return;
      event.preventDefault();
      goTo(activeIndex + (event.key === 'ArrowLeft' ? -1 : 1));
    }}>
    <header className={styles.header}>
      <div className={styles.identity}>
        <span className={styles.avatar} aria-hidden="true">{participant.name.trim().slice(0, 1) || '学'}</span>
        <div>
          <h2 id={titleId}>{participant.name}的学习单</h2>
          <p>{title} <span>· 已提交 {submitted}/{slides.length}</span></p>
        </div>
      </div>
      <div className={styles.modes} role="group" aria-label="查看模式">
        <button type="button" aria-pressed={mode === 'continuous'} onClick={() => setMode('continuous')}>
          <IconListDetails size={18} aria-hidden="true" />整页查看
        </button>
        <button type="button" aria-pressed={mode === 'slides'} disabled={!slides.length} onClick={() => setMode('slides')}>
          <IconLayoutColumns size={18} aria-hidden="true" />翻页查看
        </button>
      </div>
      <button type="button" className={styles.close} aria-label="关闭整张学习单" onClick={onClose}><IconX size={21} aria-hidden="true" /></button>
    </header>
    {reviewsFailed && <p className={styles.notice} role="status">暂时未能读取 AI 评价，仍可查看作答。</p>}
    {mode === 'continuous' || !slides.length ? <div className={`${worksheetStyles.scroller} ${styles.continuous}`} {...surfaceProps}>
      {renderQuestions(groups)}
    </div> : <>
      <div className={styles.track} ref={track} aria-label="翻页查看学习单" onScroll={event => {
        const element = event.currentTarget;
        if (event.target !== element) return;
        const slot = element.firstElementChild as HTMLElement | null;
        const pageWidth = slot?.getBoundingClientRect().width;
        if (pageWidth) setActive(Math.max(0, Math.min(slides.length - 1, Math.round(element.scrollLeft / pageWidth))));
      }}>
        {slides.map((slide, index) => {
          const { node } = slide.items[0];
          const current = index === activeIndex;
          return <div key={node.id} className={styles.slideSlot} data-active={current}>
            <section className={`${worksheetStyles.scroller} ${styles.slide}`} {...surfaceProps}
              aria-label={`第 ${index + 1} 项 · ${questionTypeLabel(node.type)}`} aria-hidden={!current} inert={!current}
              onScroll={event => {
                if (current && event.target === event.currentTarget) pagePositions.current.set(node.id, event.currentTarget.scrollTop);
              }}>
              {Math.abs(index - activeIndex) <= 1 && renderQuestions([slide])}
            </section>
            {!current && Math.abs(index - activeIndex) === 1 && <button type="button" className={styles.sidePage}
              aria-label={`翻到第 ${index + 1} 项任务`} onClick={() => goTo(index)} />}
          </div>;
        })}
      </div>
      <WorksheetTaskNavigation slides={slides} activeIndex={activeIndex} goTo={goTo} swipe />
    </>}
  </dialog>, document.body);
}
