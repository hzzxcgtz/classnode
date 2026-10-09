'use client';

// ⚠️ `CSSProperties` 要显式 import：本仓的组件不引 React 本体（Next 的新 JSX 变换），
// 直接写 `React.CSSProperties` 会 `tsc` 报「找不到名称 React」。惯例见 `worksheet-panel.tsx:4`。
// ★ 2026-09-29：`Fragment` 是**具名** import（不是 `React.Fragment`）—— 段头行与它下面的题行
// 是同一层里的兄弟节点，key 只能挂在 Fragment 上。同目录的 `analysis-panel.tsx` 也是这么引 hook 的。
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { WorksheetBoard, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
import { api } from '@/lib/api';
import { isNotFound } from '@/lib/http-error';
import { activeWorksheetAnalysisTask, hasCompletedWorksheetAnalysis, startWorksheetAnalysisTask, type BackgroundAnalysisTask } from '@/lib/worksheet-analysis-background';
import { worksheetAnalysisProgressLabel } from '@/lib/worksheet-analysis-progress';
import { indexQuestions, isGradedType, questionAggregate } from './worksheet-drawer-state';
import { buildWorksheetMatrix, matrixGroups, matrixHeadline, questionTallies, rowTally, uncoveredCount, type CellState, type MatrixHeadline, type MatrixRow } from './worksheet-matrix';
import { questionTypeNickname } from '@/lib/worksheet-questions';
import type { ParticipantWorksheetProgress } from './worksheet-tile-state';
import { ParticipantAnswers, QuestionList } from './worksheet-drawer';
import { QuestionStatsOverlay } from './question-stats-overlay';
import { AnalysisOverlay } from './analysis-overlay';
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
};

export function MatrixOverlay({
  entry,
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
  const [analysisTarget, setAnalysisTarget] = useState<{ worksheetId: string; questionId: string } | null>(null);
  const [questionWorksheetId, setQuestionWorksheetId] = useState(entry.worksheetId ?? '');

  useEffect(() => {
    setView(entry.view);
    setParticipantId(entry.participantId ?? '');
    setFocusQuestionId(entry.questionId ?? null);
    setQuestionTarget(entry.worksheetId && entry.questionId
      ? { worksheetId: entry.worksheetId, questionId: entry.questionId }
      : null);
    setAnalysisTarget(null);
    setQuestionWorksheetId(entry.worksheetId ?? '');
  }, [entry]);

  const participantOptions = useMemo(() => (board?.worksheets.flatMap((worksheet) =>
    worksheet.participants.map((participant) => ({
      id: participant.participantId,
      name: participant.name,
      worksheetId: worksheet.id,
      worksheetTitle: worksheet.title,
    }))) ?? []), [board]);
  const selectedParticipantId = participantId || participantOptions[0]?.id || '';
  const selectedWorksheetId = questionWorksheetId || board?.worksheets[0]?.id || '';

  const openParticipant = (nextParticipantId: string, questionId?: string) => {
    setParticipantId(nextParticipantId);
    setFocusQuestionId(questionId ?? null);
    setView('student');
    setQuestionTarget(null);
    setAnalysisTarget(null);
  };
  const openQuestion = (worksheetId: string, questionId: string) => {
    setQuestionWorksheetId(worksheetId);
    setQuestionTarget({ worksheetId, questionId });
    setAnalysisTarget(null);
    setView('question');
  };
  const openAnalysis = (worksheetId: string, questionId: string) => {
    setQuestionWorksheetId(worksheetId);
    setQuestionTarget({ worksheetId, questionId });
    setAnalysisTarget({ worksheetId, questionId });
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
          {([['overview', '学习单总览'], ['student', '按学生查看'], ['question', '按题目查看']] as const).map(([value, label]) => (
            <button key={value} type="button" data-active={view === value}
              onClick={() => { setView(value); setAnalysisTarget(null); if (value !== 'question') setQuestionTarget(null); }}>
              {label}
            </button>
          ))}
        </nav>
        <button onClick={onClose} type="button" className={styles.closeButton}>
          返回课堂
        </button>
      </div>

      <div className={styles.content}>
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
                onOpenAnalysis={openAnalysis}
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
            <aside className={styles.workspaceSidebar}>
              <div className={styles.sidebarHeading}>学生与小组</div>
              {participantOptions.map((participant) => (
                <button key={`${participant.worksheetId}:${participant.id}`} type="button"
                  data-active={selectedParticipantId === participant.id}
                  onClick={() => openParticipant(participant.id)}>
                  <strong>{participant.name}</strong>
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
          <div className={styles.questionWorkspace}>
            {analysisTarget ? (
              <AnalysisOverlay
                classroomId={classroomId}
                worksheetId={analysisTarget.worksheetId}
                questionId={analysisTarget.questionId}
                mode={mode}
                embedded
                onClose={() => setAnalysisTarget(null)}
              />
            ) : questionTarget ? (
              <QuestionStatsOverlay
                mode={mode}
                board={board}
                worksheetId={questionTarget.worksheetId}
                questionId={questionTarget.questionId}
                nodesByWorksheet={nodesByWorksheet}
                embedded
                onClose={() => setQuestionTarget(null)}
                onOpenAnalysis={() => setAnalysisTarget(questionTarget)}
              />
            ) : (
              <>
                {board.worksheets.length > 1 && (
                  <div className={styles.worksheetPicker}>
                    {board.worksheets.map((worksheet) => (
                      <button key={worksheet.id} type="button" data-active={selectedWorksheetId === worksheet.id}
                        onClick={() => setQuestionWorksheetId(worksheet.id)}>{worksheet.title}</button>
                    ))}
                  </div>
                )}
                <QuestionList
                  board={board}
                  worksheetId={selectedWorksheetId}
                  nodes={nodesByWorksheet[selectedWorksheetId] ?? null}
                  onOpen={(questionId) => openQuestion(selectedWorksheetId, questionId)}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 一块 = 一份学习单。 */
function MatrixBlock({
  sheet, title, nodes, live, liveTrustedAfter, classroomId, avatarSvgByParticipantId, onOpenQuestion, onOpenParticipant, onOpenAnalysis,
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
  onOpenAnalysis: (worksheetId: string, questionId: string) => void;
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
          <table className={styles.table}>
            <thead>
              <tr className={styles.taskHeaderRow}>
                <th rowSpan={2} className={styles.corner}>学生 / 题目</th>
                {matrixGroups(visibleRows).map((group, index) => (
                  <th key={`${index}:${group.taskTitle ?? ''}`} colSpan={group.rows.length} className={styles.columnGroupHead}>
                    {group.taskTitle ?? '题目'}
                  </th>
                ))}
                <th rowSpan={2} className={styles.aggregateHead}>完成情况</th>
              </tr>
              <tr>
                {visibleRows.map((row) => (
                  <th key={row.questionId} className={styles.questionHead} data-stuck={row.questionId === stuckId}>
                    <button type="button" className={styles.questionHeadButton}
                      title={`${row.heading} · ${row.typeLabel} · ${row.prompt || '题干为空'}`}
                      onClick={() => onOpenQuestion(sheet.id, row.questionId)}>
                      <strong>{row.label}</strong>
                      <span>{questionTypeNickname(row.type)}</span>
                    </button>
                    <AnalysisTrigger classroomId={classroomId} worksheetId={sheet.id} row={row}
                      onOpen={() => onOpenAnalysis(sheet.id, row.questionId)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {participants.map((participant) => {
                const states = visibleRows.map((row) => row.cells[participant.participantId]);
                const submitted = states.filter((state) => state === 'submitted').length;
                const drafting = states.filter((state) => state === 'draft').length;
                return (
                  <tr key={participant.participantId}>
                    <th scope="row" className={styles.studentRowHead}>
                      <button type="button" onClick={() => onOpenParticipant(participant.participantId)}>
                        <span className={styles.initial}>
                          {avatarSvgByParticipantId[participant.participantId]
                            ? <span className={styles.participantAvatar} aria-hidden="true"
                                dangerouslySetInnerHTML={{ __html: avatarSvgByParticipantId[participant.participantId] }} />
                            : participant.name.trim().slice(0, 1) || '·'}
                        </span>
                        <span>{participant.name}</span>
                      </button>
                    </th>
                    {visibleRows.map((row) => {
                      const state = row.cells[participant.participantId];
                      return (
                        <td key={row.questionId} className={styles.bodyCell} data-stuck={row.questionId === stuckId}>
                          <button type="button"
                            onClick={() => onOpenParticipant(participant.participantId, row.questionId)}
                            title={`${participant.name} · ${row.heading}：${CELL_LABEL[state]}`}
                            className={styles.cellButton}
                            style={{ '--cell-color': CELL_COLOR[state] } as CSSProperties}>
                            <span className={styles.srOnly}>{CELL_LABEL[state]}</span>
                          </button>
                        </td>
                      );
                    })}
                    <td className={styles.aggregateCell}>
                      <button type="button" onClick={() => onOpenParticipant(participant.participantId)}>
                        <strong>{submitted}/{visibleRows.length}</strong>
                        <span>{drafting > 0 ? `${drafting} 题作答中` : submitted === visibleRows.length ? '已完成' : '已提交'}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th className={styles.matrixFooterLabel}>全班概况</th>
                {visibleRows.map((row) => {
                  const tally = rowTally(row);
                  return (
                    <td key={row.questionId} className={styles.matrixFooterCell} data-stuck={row.questionId === stuckId}>
                      <button type="button" onClick={() => onOpenQuestion(sheet.id, row.questionId)}>
                        <strong>{tally.submitted}/{tally.total}</strong>
                        <span>已提交</span>
                      </button>
                    </td>
                  );
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
function AnalysisTrigger({ classroomId, worksheetId, row, onOpen }: {
  classroomId: string;
  worksheetId: string;
  row: MatrixRow;
  onOpen: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [ready, setReady] = useState(() => hasCompletedWorksheetAnalysis(classroomId, worksheetId, row.questionId));
  const [, setTick] = useState(0);
  const task = activeWorksheetAnalysisTask(classroomId, worksheetId, row.questionId);

  // 页面重新进入后也要识别服务端已经保存的 AI 结果，不能只依赖本次会话的内存标记。
  useEffect(() => {
    if (ready || task) return;
    let alive = true;
    void api.getWorksheetAnalysis(classroomId, worksheetId, row.questionId)
      .then((stored) => { if (alive && stored.narrative) setReady(true); })
      .catch(() => { /* 404 表示尚未分析；入口保持初始状态即可。 */ });
    return () => { alive = false; };
  }, [classroomId, worksheetId, row.questionId, ready, task]);

  const watch = (backgroundTask: BackgroundAnalysisTask) => {
    setTick((value) => value + 1);
    void backgroundTask.promise
      .then(() => setReady(true))
      .catch(() => setReady(false))
      .finally(() => setTick((value) => value + 1));
  };

  useEffect(() => {
    if (!task) return;
    let alive = true;
    const timer = window.setInterval(() => setTick((value) => value + 1), 500);
    void task.promise
      .then(() => { if (alive) setReady(true); })
      .catch(() => { /* 顶层 Toast 已经说明失败原因。 */ })
      .finally(() => { if (alive) setTick((value) => value + 1); });
    return () => { alive = false; window.clearInterval(timer); };
  }, [task]);

  const handleClick = async () => {
    if (task) return;
    if (ready) { onOpen(); return; }
    setChecking(true);
    try {
      const stored = await api.getWorksheetAnalysis(classroomId, worksheetId, row.questionId);
      if (stored.narrative) {
        setReady(true);
        onOpen();
        return;
      }
    } catch (error) {
      // 404 = 从未分析；其它读取错误也交给完整后台流程统一报告，避免按钮停在死状态。
      if (!isNotFound(error)) { /* 后台请求会给出可见错误。 */ }
    }
    watch(startWorksheetAnalysisTask({
      classroomId, worksheetId, questionId: row.questionId, questionLabel: row.heading,
    }));
    setChecking(false);
  };

  let text = 'AI 分析';
  let buttonState = 'idle';
  if (checking) { text = '检查中…'; buttonState = 'running'; }
  else if (task) {
    buttonState = 'running';
    const elapsed = Math.max(0, Math.floor((Date.now() - task.startedAt) / 1000));
    text = worksheetAnalysisProgressLabel(task.stage, elapsed);
  } else if (ready) { text = '查看 AI 分析'; buttonState = 'ready'; }

  return (
    <button type="button" onClick={() => void handleClick()} disabled={checking || Boolean(task)}
      data-state={buttonState} className={styles.analysisButton}
      title={task ? '分析正在后台进行，可以离开当前页面' : ready ? '查看已保存结果，也可以重新分析' : '静默启动本题的 AI 分析'}>
      {task && <span className={styles.analysisSpinner} aria-hidden="true" />}
      {text}
    </button>
  );
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
