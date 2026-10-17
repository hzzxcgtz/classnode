'use client';

// ⚠️ `CSSProperties` 要显式 import：本仓的组件不引 React 本体（Next 的新 JSX 变换），
// 直接写 `React.CSSProperties` 会 `tsc` 报「找不到名称 React」。惯例见 `worksheet-panel.tsx:4`。
// ★ 2026-09-29：`Fragment` 是**具名** import（不是 `React.Fragment`）—— 段头行与它下面的题行
// 是同一层里的兄弟节点，key 只能挂在 Fragment 上。同目录的 `analysis-panel.tsx` 也是这么引 hook 的。
import { TeacherPendingText } from '@/components/teacher-pending-text';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { WorksheetBoard, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
import { api } from '@/lib/api';
import { activeWorksheetAnalysisTask, hasCompletedWorksheetAnalysis, WORKSHEET_ANALYSIS_STARTED_EVENT } from '@/lib/worksheet-analysis-background';
import { indexQuestions, isGradedType, questionAggregate } from './worksheet-drawer-state';
import { buildWorksheetMatrix, matrixHeadline, questionTallies, rowTally, uncoveredCount, type CellState, type MatrixHeadline, type MatrixRow } from './worksheet-matrix';
import { questionTypeNickname } from '@/lib/worksheet-questions';
import type { ParticipantWorksheetProgress } from './worksheet-tile-state';
import { ParticipantAnswers } from './worksheet-drawer';
import { showsAgentAnalysis } from './worksheet-question-stats';
import { QuestionStatsOverlay } from './question-stats-overlay';
import styles from './matrix-overlay.module.css';

/**
 * 教师看板的**学习单矩阵**覆盖层（规格 `specs/2026-09-25-m5b-matrix-overview.md`）。
 *
 * ⚠️ **本文件只画，不判断**：每一格是什么状态、哪一题卡住，全在 `worksheet-matrix.ts`
 * （纯函数、有测试）。判据写进 JSX 就没有任何回归网了（本仓没有 jsdom，
 * `node --test` 加载不了 JSX）—— 与 `worksheet-drawer.tsx` 同一条规矩。
 *
 * 🔴 **一块 = 一份学习单**：高级模式下每个组可以是**不同的**学习单（规格 §2.2），
 * 「全班共有的第 3 题」并不存在。标准 / 分组模式下 `worksheets[]` 只有一个元素，
 * 这里自动退化成一块（无额外 UI）。
 *
 * 🔴 **层级**：本覆盖层 `zIndex: 250`（与 `gridFullscreen` 同档），而学习单抽屉是 `290/291`
 * ⇒ 点行首 / 点格子打开抽屉时，抽屉**画在上面**，不需要改抽屉、也不该把矩阵关掉。
 */
export type WorksheetWorkspaceEntry = {
  token: number;
  view: 'overview' | 'student' | 'question';
  participantId?: string;
  worksheetId?: string;
  questionId?: string;
  analysis?: boolean;
};

export function MatrixOverlay({
  entry,
  onNavigate,
  board,
  nodesByWorksheet,
  settingsByWorksheet,
  liveDrafts,
  live,
  liveTrustedAfter,
  loading,
  participantCount,
  avatarSvgByParticipantId,
  classroomId,
  advancedMode,
  mode,
  reviewBusy,
  onClose,
  onReview,
  onClearQuestion,
}: {
  entry: WorksheetWorkspaceEntry;
  onNavigate?: (entry: Omit<WorksheetWorkspaceEntry, 'token'>) => void;
  board: WorksheetBoard | null;
  nodesByWorksheet: Record<string, WorksheetQuestionNode[]>;
  settingsByWorksheet: Record<string, WorksheetSettings>;
  liveDrafts: Record<string, { worksheetId: string; questionId: string; value: unknown }>;
  live: Record<string, ParticipantWorksheetProgress>;
  /** ★ 只信在这个时刻之后到达的广播（= 本次快照发起的时刻）。见 `buildWorksheetMatrix` 的参数说明。 */
  liveTrustedAfter: number | undefined;
  loading: boolean;
  participantCount: number;
  /** 看板已经加载好的学生头像 SVG；小组参与者没有头像时仍回落为首字。 */
  avatarSvgByParticipantId: Record<string, string>;
  classroomId: string;
  /** ★ 只有高级模式才谈得上「有的组没配学习单」—— 下面那行提示按它收窄。 */
  advancedMode: boolean;
  mode: string;
  reviewBusy: string | null;
  onClose: () => void;
  onReview: (worksheetId: string, participantId: string, questionId: string) => void;
  onClearQuestion: (worksheetId: string, participantId: string, questionId: string) => void;
}) {
  // ⚠️ 算术在纯函数里（GC 26）：JSX 里只调用，不再自己算一遍。
  // ⚠️ **两个入参取自不同时刻的快照**（`participantCount` 来自课堂详情、`board` 来自作答端点），
  //    差额因此可以是负数（钳在 0）或短暂偏大 —— 见 `uncoveredCount` 的注释与移交说明里的已知残余。
  const uncovered = board ? uncoveredCount(participantCount, board.worksheets) : 0;
  const [view, setView] = useState(entry.view);
  const [participantId, setParticipantId] = useState(entry.participantId ?? '');
  const [focusQuestionId, setFocusQuestionId] = useState(entry.questionId ?? null);
  const [questionTarget, setQuestionTarget] = useState<{ worksheetId: string; questionId: string } | null>(
    entry.worksheetId && entry.questionId ? { worksheetId: entry.worksheetId, questionId: entry.questionId } : null,
  );
  const [analysisJumpCount, setAnalysisJumpCount] = useState(0);
  const [analysisTarget, setAnalysisTarget] = useState<{ worksheetId: string; questionId: string } | null>(null);
  const [questionWorksheetId, setQuestionWorksheetId] = useState(entry.worksheetId ?? '');

  useEffect(() => {
    setView(entry.view);
    setParticipantId(entry.participantId ?? '');
    setFocusQuestionId(entry.questionId ?? null);
    setQuestionTarget(entry.worksheetId && entry.questionId
      ? { worksheetId: entry.worksheetId, questionId: entry.questionId }
      : null);
    setAnalysisTarget(entry.analysis && entry.worksheetId && entry.questionId
      ? { worksheetId: entry.worksheetId, questionId: entry.questionId } : null);
    if (entry.analysis) setAnalysisJumpCount(count => count + 1);
    setQuestionWorksheetId(entry.worksheetId ?? '');
  }, [entry]);

  const participantOptions = useMemo(() => (board?.worksheets.flatMap((worksheet) =>
    worksheet.participants.map((participant) => ({
      id: participant.participantId,
      name: participant.name,
      worksheetId: worksheet.id,
      worksheetTitle: worksheet.title,
      submitted: participant.answerRows.filter(row => row.status === 'submitted').length,
      total: indexQuestions(nodesByWorksheet[worksheet.id] ?? []).items.length,
    }))) ?? []), [board, nodesByWorksheet]);
  const questionOptions = useMemo(() => (board?.worksheets.flatMap((worksheet) => {
    const nodes = nodesByWorksheet[worksheet.id];
    if (!nodes) return [];
    return indexQuestions(nodes).items.map((item) => {
      const rows = worksheet.participants.map((participant) =>
        participant.answerRows.find((row) => row.questionId === item.node.id));
      return {
        worksheetId: worksheet.id,
        worksheetTitle: worksheet.title,
        questionId: item.node.id,
        heading: item.heading,
        title: [item.heading, item.node.prompt.replace(/\s+/g, ' ').trim()].filter(Boolean).join(' · '),
        typeLabel: questionTypeNickname(item.node.type),
        aggregate: questionAggregate(rows),
        analysisAvailable: showsAgentAnalysis(item.node),
        manual: !isGradedType(item.node.type) || item.node.autoGrade === false,
      };
    });
  })) ?? [], [board, nodesByWorksheet]);
  const participantSidebarRef = useRef<HTMLElement>(null);
  const selectedParticipantId = participantId || participantOptions[0]?.id || '';
  const selectedQuestionTarget = questionTarget ?? questionOptions.find((item) =>
    !questionWorksheetId || item.worksheetId === questionWorksheetId) ?? null;

  useEffect(() => {
    if (view !== 'student') return;
    const frame = requestAnimationFrame(() => {
      participantSidebarRef.current
        ?.querySelector<HTMLButtonElement>('button[data-active="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [view, selectedParticipantId, participantOptions.length]);

  const contentRef = useRef<HTMLDivElement>(null);
  const matrixPositionRef = useRef<{ top: number; tables: { top: number; left: number }[] } | null>(null);
  const navigate = (next: Omit<WorksheetWorkspaceEntry, 'token'>) => {
    if (view === 'overview' && contentRef.current) {
      matrixPositionRef.current = {
        top: contentRef.current.scrollTop,
        tables: Array.from(contentRef.current.querySelectorAll(`.${styles.tableShell}`))
          .map(element => ({ top: element.scrollTop, left: element.scrollLeft })),
      };
    }
    onNavigate?.(next);
  };
  useEffect(() => {
    if (view !== 'overview' || !matrixPositionRef.current) return;
    const frame = requestAnimationFrame(() => {
      const content = contentRef.current;
      const position = matrixPositionRef.current;
      if (!content || !position) return;
      content.scrollTop = position.top;
      content.querySelectorAll(`.${styles.tableShell}`).forEach((element, index) => {
        const saved = position.tables[index];
        if (saved) { element.scrollTop = saved.top; element.scrollLeft = saved.left; }
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [view]);

  const openParticipant = (nextParticipantId: string, questionId?: string) => {
    navigate({ view: 'student', participantId: nextParticipantId, questionId });
    setParticipantId(nextParticipantId);
    setFocusQuestionId(questionId ?? null);
    setView('student');
    setQuestionTarget(null);
    setAnalysisTarget(null);
  };
  const openQuestion = (worksheetId: string, questionId: string) => {
    navigate({ view: 'question', worksheetId, questionId });
    setQuestionWorksheetId(worksheetId);
    setQuestionTarget({ worksheetId, questionId });
    setAnalysisTarget(null);
    setView('question');
  };


  return (
    <div data-overscroll-guard="" className={styles.overlay}>
      <div className={styles.topbar}>
        <div className={styles.titleBlock}>
          <h2>学习单答题情况</h2>
          <p>从全班总览进入学生或题目详情，所有查看都在这一层完成</p>
        </div>
        <nav className={styles.viewTabs} aria-label="学习单查看方式">
          {([['overview', '学习单矩阵'], ['student', '按学生查看'], ['question', '按题目查看']] as const).map(([value, label]) => (
            <button key={value} type="button" data-active={view === value}
              onClick={() => { if (value === view) return; navigate({ view: value, participantId: selectedParticipantId, worksheetId: selectedQuestionTarget?.worksheetId, questionId: value === 'question' ? selectedQuestionTarget?.questionId : undefined }); setView(value); setAnalysisTarget(null); if (value !== 'question') setQuestionTarget(null); }}>
              {label}
            </button>
          ))}
        </nav>
        <button onClick={onClose} type="button" className={styles.closeButton}>
          返回课堂
        </button>
      </div>

      <div ref={contentRef} className={styles.content}>
        {!board && loading ? (
          <div className={styles.emptyState}>正在读取作答…</div>
        ) : !board ? (
          // ⚠️ 与「全班都没作答」是两件事 —— 拉失败时 MUST NOT 画成一张空表。
          <div className={styles.emptyState}>还没读到这一堂课的作答</div>
        ) : board.worksheets.length === 0 ? (
          <div className={styles.emptyState}>这间课堂还没配学习单</div>
        ) : view === 'overview' ? (
          <>
            {board.worksheets.map((sheet) => (
              <MatrixBlock
                key={sheet.id}
                title={sheet.title}
                nodes={nodesByWorksheet[sheet.id]}
                live={live}
                liveTrustedAfter={liveTrustedAfter}
                sheet={sheet}
                classroomId={classroomId}
                avatarSvgByParticipantId={avatarSvgByParticipantId}
                onOpenQuestion={openQuestion}
                onOpenParticipant={openParticipant}
              />
            ))}
            {/* 🔴 高级模式下「没配学习单的组」不在任何一块里（`resolveMaterialTargetId` 不回落）。
                少了这一行，教师看到的是一张**少了几个组**的表，而屏幕上没有任何东西说少了人。 */}
            {advancedMode && uncovered > 0 && (
              <p className={styles.uncovered}>
                另有 {uncovered} 个参与者没有可作答的学习单（高级模式下每组各自配置）
              </p>
            )}
          </>
        ) : view === 'student' ? (
          <div className={styles.workspaceSplit}>
            <aside ref={participantSidebarRef} className={styles.workspaceSidebar}>
              <div className={styles.sidebarHeading}>学生与小组</div>
              {participantOptions.map((participant) => (
                <button key={`${participant.worksheetId}:${participant.id}`} type="button"
                  data-active={selectedParticipantId === participant.id}
                  onClick={() => openParticipant(participant.id)}>
                  <strong>{participant.name}</strong>
                  <span>已交 {participant.submitted}/{participant.total}</span>
                  {board.worksheets.length > 1 && <span>{participant.worksheetTitle}</span>}
                </button>
              ))}
            </aside>
            <main className={styles.workspacePanel}>
              {selectedParticipantId ? (
                <ParticipantAnswers
                  key={`${selectedParticipantId}:${focusQuestionId ?? ''}`}
                  board={board}
                  participantId={selectedParticipantId}
                  nodesByWorksheet={nodesByWorksheet}
                  settingsByWorksheet={settingsByWorksheet}
                  liveDrafts={liveDrafts}
                  reviewBusy={reviewBusy}
                  onReview={onReview}
                  onClearQuestion={onClearQuestion}
                  focusQuestionId={focusQuestionId}
                />
              ) : <div className={styles.emptyState}>还没有学生或小组可以查看</div>}
            </main>
          </div>
        ) : (
          <div className={`${styles.workspaceSplit} ${styles.questionSplit}`}>
            <aside className={`${styles.workspaceSidebar} ${styles.questionSidebar}`}>
              <div className={styles.sidebarHeading}>题目</div>
              {board.worksheets.map((worksheet) => {
                const options = questionOptions.filter((item) => item.worksheetId === worksheet.id);
                if (options.length === 0) return null;
                return (
                  <section key={worksheet.id} className={styles.questionGroup}>
                    {board.worksheets.length > 1 && <h3>{worksheet.title}</h3>}
                    {options.map((item) => {
                      const active = selectedQuestionTarget?.worksheetId === item.worksheetId
                        && selectedQuestionTarget.questionId === item.questionId;
                      return (
                        <div key={item.questionId} className={styles.questionNavRow} data-active={active} data-analysis={item.analysisAvailable}>
                          <button type="button" className={styles.questionNavSelect}
                            onClick={() => openQuestion(item.worksheetId, item.questionId)}>
                            <span className={styles.questionNavTitle}>
                              <strong title={item.title}>{item.title}</strong>
                            </span>
                            <span className={styles.questionNavMeta}>
                              <small>已交 {item.aggregate.submitted}/{item.aggregate.total}</small>
                              <strong>{item.typeLabel}</strong>
                              {!item.manual && <strong data-tone={(item.aggregate.accuracy ?? 100) < 60 ? 'warning' : 'good'}>
                                {item.aggregate.graded > 0 ? `${item.aggregate.accuracy}%` : '待判分'}
                              </strong>}
                            </span>
                          </button>
                          {item.analysisAvailable && <div className={styles.questionNavAnalysis}>
                            <AnalysisStatus classroomId={classroomId} worksheetId={item.worksheetId}
                              row={item} analyzed={worksheet.analyzedQuestionIds.includes(item.questionId)} />
                          </div>}
                        </div>
                      );
                    })}
                  </section>
                );
              })}
              {questionOptions.length === 0 && <div className={styles.sidebarEmpty}>这份学习单还没有题目</div>}
            </aside>
            <main className={styles.questionDetailPanel}>
              {selectedQuestionTarget ? (
                <QuestionStatsOverlay
                  key={`${selectedQuestionTarget.worksheetId}:${selectedQuestionTarget.questionId}:${Boolean(analysisTarget)}:${analysisJumpCount}`}
                  classroomId={classroomId}
                  mode={mode}
                  board={board}
                  worksheetId={selectedQuestionTarget.worksheetId}
                  questionId={selectedQuestionTarget.questionId}
                  nodesByWorksheet={nodesByWorksheet}
                  embedded
                  onClose={() => {}}
                  onOpenStudent={id => openParticipant(id, selectedQuestionTarget.questionId)}
                  expandAnalysis={Boolean(analysisTarget)}
                />
              ) : <div className={styles.emptyState}>从左侧选择一道题查看详情</div>}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

/** 一块 = 一份学习单。 */
function MatrixBlock({
  sheet, title, nodes, live, liveTrustedAfter, classroomId, avatarSvgByParticipantId, onOpenQuestion, onOpenParticipant,
}: {
  sheet: WorksheetBoard['worksheets'][number];
  title: string;
  nodes: WorksheetQuestionNode[] | undefined;
  live: Record<string, ParticipantWorksheetProgress>;
  liveTrustedAfter: number | undefined;
  classroomId: string;
  avatarSvgByParticipantId: Record<string, string>;
  onOpenQuestion: (worksheetId: string, questionId: string) => void;
  onOpenParticipant: (participantId: string, questionId?: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention' | 'manual'>('all');
  if (!nodes) return <div className={styles.emptyState}>《{title}》正在读取题目…</div>;

  const rows = buildWorksheetMatrix(sheet, nodes, live, liveTrustedAfter);
  // 🔴 **不再在这里早退**（独立审查抓到的）：原先 `rows.length === 0` 直接 return 一句自己写的文案，
  // 于是 `matrixHeadline` 的 `no-questions` 那一支**永远不可达**、它的用例白写，
  // 而 R1「空态只有一处判据」的目的**没达成**（还是两半，且纯函数那半是死的）。
  // 现在让没有题的那种情况照常走 `matrixHeadline` → `headlineText`。
  const headline = matrixHeadline(questionTallies(rows));
  const stuckId = headline.kind === 'stuck' ? headline.questionId : null;
  const indexed = indexQuestions(nodes).byId;
  const details = new Map(rows.map((row) => {
    const answerRows = sheet.participants.map((participant) =>
      participant.answerRows.find((answer) => answer.questionId === row.questionId));
    const aggregate = questionAggregate(answerRows);
    const node = indexed.get(row.questionId);
    const manual = !isGradedType(row.type) || node?.autoGrade === false;
    const attention = !manual && aggregate.graded > 0 && (aggregate.accuracy ?? 100) < 60;
    return [row.questionId, { aggregate, manual, attention }] as const;
  }));
  const visibleRows = rows.filter((row) => {
    const detail = details.get(row.questionId);
    if (filter === 'attention') return detail?.attention;
    if (filter === 'manual') return detail?.manual;
    return true;
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const participants = sheet.participants.filter((participant) =>
    normalizedQuery.length === 0 || participant.name.toLocaleLowerCase().includes(normalizedQuery));
  const totalSubmissions = rows.reduce((sum, row) => sum + rowTally(row).submitted, 0);
  const manualCount = [...details.values()].filter((detail) => detail.manual).length;
  const attentionCount = [...details.values()].filter((detail) => detail.attention).length;
  const focusRow = stuckId ? rows.find((row) => row.questionId === stuckId) : rows.find((row) => details.get(row.questionId)?.attention);
  const focusDetail = focusRow ? details.get(focusRow.questionId) : undefined;

  return (
    <section className={styles.sheet}>
      <div className={styles.sheetHeader}>
        <div>
          <h3>《{title}》</h3>
          <p data-tone={headline.kind === 'stuck' ? 'warning' : undefined}>{headlineText(headline)}</p>
        </div>
      </div>

      <div className={styles.overviewStrip}>
        <div className={styles.summary} aria-label="学习单概况">
          <span className={styles.metric}><strong>{sheet.participants.length}</strong> 参与者</span>
          <span className={styles.metric}><strong>{totalSubmissions}</strong> 已提交</span>
          <span className={styles.metric}><strong>{rows.length - manualCount}</strong> 自动评分</span>
          <span className={styles.metric} data-tone="warning"><strong>{manualCount}</strong> 主观题</span>
        </div>

        <div className={styles.focusStrip}>
          {focusRow && focusDetail ? (<>
            <strong>{focusDetail.attention ? '优先关注' : '当前进度'}：{focusRow.heading}</strong>
            <span>已提交 {focusDetail.aggregate.submitted}/{focusDetail.aggregate.total}</span>
            <span>{focusDetail.manual
              ? `${focusDetail.aggregate.submitted} 份主观作答`
              : focusDetail.aggregate.graded > 0
                ? `答对 ${focusDetail.aggregate.correct}/${focusDetail.aggregate.graded}`
                : '暂无判分结果'}</span>
            {focusDetail.aggregate.submitted > 0 && focusDetail.aggregate.submitted < 3 && <span>样本较少</span>}
            <button type="button" className={styles.focusAction}
              onClick={() => onOpenQuestion(sheet.id, focusRow.questionId)}>查看该题</button>
          </>) : <span>当前没有需要优先关注的题目</span>}
        </div>
      </div>

      <div className={styles.toolbar}>
        <input className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索学生或小组" aria-label="搜索学生或小组" />
        <button type="button" className={styles.filterButton} data-active={filter === 'all'} onClick={() => setFilter('all')}>全部题目 {rows.length}</button>
        <button type="button" className={styles.filterButton} data-active={filter === 'attention'} onClick={() => setFilter('attention')}>需要关注 {attentionCount}</button>
        <button type="button" className={styles.filterButton} data-active={filter === 'manual'} onClick={() => setFilter('manual')}>主观题 {manualCount}</button>
        <div className={styles.legend} aria-label="状态图例">
          {(Object.entries(CELL_LABEL) as Array<[CellState, string]>).map(([state, label]) => (
            <span className={styles.legendItem} key={state}>
              <i className={styles.legendDot} style={{ '--cell-color': CELL_COLOR[state] } as CSSProperties} />{label}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.tableShell}>
        {participants.length === 0 || visibleRows.length === 0 ? (
          <div className={styles.noMatches}>{participants.length === 0 ? '没有找到匹配的学生或小组。' : '这个筛选条件下暂时没有题目。'}</div>
        ) : (
          <table className={styles.table} style={{ '--student-count': participants.length } as CSSProperties}>
            <colgroup>
              <col className={styles.questionColumn} />
              {participants.map(participant => <col key={participant.participantId} className={styles.studentColumn} />)}
              <col className={styles.aggregateColumn} />
            </colgroup>
            <thead>
              <tr>
                <th className={`${styles.corner} ${styles.matrixQuestionCorner}`}>题目 / 学生</th>
                {participants.map((participant) => (
                  <th key={participant.participantId} className={styles.participantHead} scope="col">
                    <button type="button" className={styles.participantHeadButton}
                      title={participant.name} onClick={() => onOpenParticipant(participant.participantId)}>
                      <span className={styles.initial}>
                        {avatarSvgByParticipantId[participant.participantId]
                          ? <span className={styles.participantAvatar} aria-hidden="true" dangerouslySetInnerHTML={{ __html: avatarSvgByParticipantId[participant.participantId] }} />
                          : participant.name.trim().slice(0, 1) || '·'}
                      </span>
                      <span className={styles.participantVerticalName}>{participant.name}</span>
                    </button>
                  </th>
                ))}
                <th className={styles.aggregateHead}>已交</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const tally = rowTally(row);
                return <tr key={row.questionId}>
                  <th scope="row" className={styles.matrixQuestionHead} data-stuck={row.questionId === stuckId}>
                    <button type="button" className={styles.questionHeadButton}
                      title={`${row.heading} · ${row.typeLabel} · ${row.prompt || '题干为空'}`}
                      onClick={() => onOpenQuestion(sheet.id, row.questionId)}>
                      <strong>{row.heading}</strong>
                    </button>
                    <div className={styles.matrixQuestionMeta}>
                      <span>{row.typeLabel}</span>
                      <AnalysisStatus classroomId={classroomId} worksheetId={sheet.id} row={row} analyzed={sheet.analyzedQuestionIds.includes(row.questionId)} />
                    </div>
                  </th>
                  {participants.map((participant) => {
                    const state = row.cells[participant.participantId];
                    return <td key={participant.participantId} className={styles.bodyCell} data-stuck={row.questionId === stuckId}>
                      <button type="button" onClick={() => onOpenParticipant(participant.participantId, row.questionId)}
                        title={`${participant.name} · ${row.heading}：${CELL_LABEL[state]}`} className={styles.cellButton}
                        style={{ '--cell-color': CELL_COLOR[state] } as CSSProperties}>
                        <span className={styles.srOnly}>{CELL_LABEL[state]}</span>
                      </button>
                    </td>;
                  })}
                  <td className={styles.aggregateCell}>
                    <button type="button" onClick={() => onOpenQuestion(sheet.id, row.questionId)}>
                      <strong>{tally.submitted}/{tally.total}</strong><span>已提交</span>
                    </button>
                  </td>
                </tr>;
              })}
            </tbody>
            <tfoot>
              <tr>
                <th className={styles.matrixFooterLabel}>完成题数</th>
                {participants.map((participant) => {
                  const submitted = visibleRows.filter(row => row.cells[participant.participantId] === 'submitted').length;
                  return <td key={participant.participantId} className={styles.matrixFooterCell}>
                    <button type="button" onClick={() => onOpenParticipant(participant.participantId)}>
                      <strong>{submitted}/{visibleRows.length}</strong>
                    </button>
                  </td>;
                })}
                <td className={styles.matrixFooterTotal}>{totalSubmissions} 份作答</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </section>
  );
}

/** 第一次点击静默启动后台分析；完成后同一位置变成结果入口。 */
function AnalysisStatus({ classroomId, worksheetId, row, analyzed }: {
  classroomId: string;
  worksheetId: string;
  row: Pick<MatrixRow, 'questionId'>;
  analyzed?: boolean;
}) {
  const [ready, setReady] = useState(() => analyzed ?? hasCompletedWorksheetAnalysis(classroomId, worksheetId, row.questionId));
  const [, setTick] = useState(0);
  const task = activeWorksheetAnalysisTask(classroomId, worksheetId, row.questionId);
  useEffect(() => {
    if (analyzed !== undefined) { setReady(analyzed); return; }
    let alive = true;
    void api.getWorksheetAnalysis(classroomId, worksheetId, row.questionId)
      .then(stored => { if (alive) setReady(Boolean(stored.narrative)); }).catch(() => {});
    return () => { alive = false; };
  }, [classroomId, worksheetId, row.questionId, analyzed]);
  useEffect(() => {
    const started = () => setTick(value => value + 1);
    window.addEventListener(WORKSHEET_ANALYSIS_STARTED_EVENT, started);
    return () => window.removeEventListener(WORKSHEET_ANALYSIS_STARTED_EVENT, started);
  }, []);
  useEffect(() => {
    if (!task) return;
    let alive = true;
    void task.promise.then(() => { if (alive) setReady(true); }).catch(() => {}).finally(() => { if (alive) setTick(value => value + 1); });
    return () => { alive = false; };
  }, [task]);
  return <span className={styles.analysisStatus} data-state={task ? 'running' : ready ? 'ready' : 'idle'} role="status">
    <span aria-hidden="true">●</span> <TeacherPendingText active={Boolean(task)}>{task ? 'AI 分析中' : ready ? '已分析' : '未分析'}</TeacherPendingText>
  </span>;
}

/** 三档颜色。**只有三档** —— 对错不在这里（规格 §3.4）。 */
// ⚠️ 键类型是 `CellState` 而不是 `string`：用 `string` 时**缺键 TS 判不出来**，
//    色块会静默变透明（审查点名的一处）。
const CELL_COLOR: Record<CellState, string> = {
  unanswered: '#e1e7ee',
  draft: '#d3a45f',
  submitted: '#6889ad',
};

const CELL_LABEL: Record<CellState, string> = {
  unanswered: '未作答',
  draft: '作答中',
  submitted: '已提交',
};

/**
 * 那一句「此刻该讲哪一题」。五个变体各有各的话（规格 §3.5 / §3.8）。
 *
 * 🔴 **两件事都是刻意的，别「顺手修」**：
 *   · **显式标注返回类型 `: string`** —— 本仓的 `tsconfig` **没有** `noImplicitReturns`
 *     （实测：`/usr/bin/grep -n noImplicitReturns tsconfig.json` 零命中），
 *     所以少了这个标注时，将来给 `MatrixHeadline` 加第六个变体却忘了写文案，
 *     函数会**静默返回 `undefined`**，屏幕上那一行变成空白而**没有任何报错**。
 *     有了标注，缺分支是 TS2366（编译错误）。
 *   · **不写 `default:`** —— 一个 `default: return ''` 会把上面那个检查关掉。
 *     （本目录的 `worksheet-tiles.tsx:68` 有 `default: return ''`，那是**既有**写法，
 *     本批不跟着抄：它恰好是「加了变体、屏幕上出现一句空话、无人报错」的入口。）
 */
function headlineText(headline: MatrixHeadline): string {
  switch (headline.kind) {
    case 'no-questions': return '这份学习单还没有题目';
    case 'no-participants': return '还没有人加入';
    case 'all-submitted': return '全部交齐';
    case 'not-started': return '全班还没开始';
    case 'stuck': return `卡住的是 ${headline.heading} · ${headline.tally}/${headline.total} 人作答过`;
  }
}
