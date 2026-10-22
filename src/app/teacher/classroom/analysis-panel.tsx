'use client';

import { ReviewPreviewButton } from './review-preview';
import { TeacherPendingText } from '@/components/teacher-pending-text';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import { isNotFound } from '@/lib/http-error';
import type { WorksheetAnalysisPayload } from '@/lib/types';
import { moduleCountUnit } from './worksheet-tile-state';
import { activeWorksheetAnalysisTask, startWorksheetAnalysisTask, stopWorksheetAnalysisTask, forgetWorksheetAnalysis, WORKSHEET_ANALYSIS_STARTED_EVENT, type AnalysisAction } from '@/lib/worksheet-analysis-background';
import { worksheetAnalysisProgressLabel } from '@/lib/worksheet-analysis-progress';
import { localizeLegacyLabels } from '@/lib/worksheet-analysis-cells';
import { AnalysisReport } from './analysis-report';
import { scoreParticipantMeta, sortAnalysisScores } from '@/lib/worksheet-analysis-score-display';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import { pointsUnitLabel, REWARD_STYLE_OPTIONS } from '@/lib/worksheet-reward';
import styles from './analysis-panel.module.css';
import { worksheetAnalysisActions } from '@/lib/worksheet-analysis-actions';

export type AnalysisOperation = 'analyzing' | null;
export type AnalysisRunStage = 'preparing' | 'sending' | 'analyzing' | 'finalizing' | null;

/**
 * 「AI 分析」的**取数 + 呈现**，抽成统一结果面板（★ 2026-09-28，规格 §6.2）。
 *
 * 🔴 **为什么要抽**（不是洁癖）：
 *   · 它今天有两个宿主 —— 整屏的 `AnalysisOverlay`（从矩阵那条路进）与
 *     **按题统计浮层**与矩阵分析中的查看入口；
 *   · 同一个 `narrative` 若在两处各画一份，迟早会长得不一样 —— 那是这类功能的经典分叉，
 *     而**两边都不报错**；
 *   · 分析任务已经改成静默后台执行；这里统一负责读取结果、展示进度和重新分析，
 *     避免两个宿主各自维护一套状态。
 *
 * ⚠️ **这里的代码是从 `analysis-overlay.tsx` 原样搬过来的**（连注释一起）——
 * 搬的时候行为**一个字都没改**，理由逐条都留在原处。
 */

export interface WorksheetAnalysisState {
  payload: WorksheetAnalysisPayload | null;
  loading: boolean;
  busy: boolean;
  operation: AnalysisOperation;
  activeAction?: AnalysisAction | null;
  runStage: AnalysisRunStage;
  runElapsedSeconds: number;
  runMessage?: string | null;
  stopping?: boolean;
  clearing?: boolean;
  stop?: () => Promise<void>;
  clear?: (kind: 'grades' | 'result', participantIds?: string[]) => Promise<boolean>;
  error: string | null;
  /** 联系表的图没取回来（服务端缺 sharp 时回 503）。没有它，界面上只有一个**坏图**。 */
  sheetFailed: boolean;
  markSheetFailed: () => void;
  /**
   * 后台重新整理数据并调用远端智能体；无需二次确认。
   * ★ 2026-10-07：`only` = **只补这几个人**（模型上次漏掉的那几个）；
   *   不传就是全班 —— 补跑只补分、不动整体解读，见服务端那条注释。
   */
  run: (only?: string[], regrade?: boolean, incremental?: boolean, analysisOnly?: boolean) => Promise<void>;
  unit: string;
}

/**
 * 取数与动作。**两处宿主共用同一个 hook**（各自一份 state，但行为同一个实现）。
 *
 * ⚠️ 各自的 state 是**有意**的：整屏浮层与内联块同时开着时，一边生成不该把另一边
 * 也刷成 loading —— 它们的生命周期本来就是分开的。
 */
export function useWorksheetAnalysis(
  classroomId: string,
  worksheetId: string,
  questionId: string,
  mode: string,
  enabled = true,
): WorksheetAnalysisState {
  const { on } = useSocket();
  const [payload, setPayload] = useState<WorksheetAnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const ownedRun = useRef(false);
  const [activeAction, setActiveAction] = useState<AnalysisAction | null>(null);
  const [operation, setOperation] = useState<AnalysisOperation>(null);
  const [runStage, setRunStage] = useState<AnalysisRunStage>(null);
  const [runElapsedSeconds, setRunElapsedSeconds] = useState(0);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetFailed, setSheetFailed] = useState(false);
  const busy = operation !== null;
  const [taskRevision, setTaskRevision] = useState(0);
  useEffect(() => {
    const started = () => setTaskRevision(value => value + 1);
    window.addEventListener(WORKSHEET_ANALYSIS_STARTED_EVENT, started);
    return () => window.removeEventListener(WORKSHEET_ANALYSIS_STARTED_EVENT, started);
  }, []);

  // 关闭浮窗后任务仍在模块级注册表中。重新打开同一道题时接回原 Promise，而不是重复外发。
  useEffect(() => {
    const task = activeWorksheetAnalysisTask(classroomId, worksheetId, questionId);
    if (!task || ownedRun.current) return;
    let alive = true;
    setOperation('analyzing');
    setActiveAction(task.action);
    setRunStage(task.stage);
    setRunMessage(task.message ?? null);
    setRunElapsedSeconds(Math.max(0, Math.floor((Date.now() - task.startedAt) / 1000)));
    void task.promise
      .then(async (out) => {
        if (!alive) return;
        setRunStage('finalizing');
        try {
          const refreshed = await api.getWorksheetAnalysis(classroomId, worksheetId, questionId);
          if (alive) setPayload(refreshed);
        } catch {
          if (alive) setPayload((prev) => (prev ? { ...prev, ...out } : prev));
        }
      })
      .catch(async (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '分析失败');
        // 前几批可能已成功，后续失败时仍需显示实际已保存的评分。
        try {
          const refreshed = await api.getWorksheetAnalysis(classroomId, worksheetId, questionId);
          if (alive) setPayload(refreshed);
        } catch {}
      })
      .finally(() => {
        if (!alive) return;
        setRunStage(null);
        setOperation(null);
      });
    return () => { alive = false; };
  }, [classroomId, worksheetId, questionId, taskRevision]);

  // Both a newly started task and a reattached task use the registry's real start time.
  useEffect(() => {
    if (operation !== 'analyzing') return;
    const updateProgress = () => {
      const task = activeWorksheetAnalysisTask(classroomId, worksheetId, questionId);
      if (!task) return;
      setRunStage(task.stage);
      setRunMessage(task.message ?? null);
      setRunElapsedSeconds(Math.max(0, Math.floor((Date.now() - task.startedAt) / 1000)));
    };
    updateProgress();
    const timer = window.setInterval(updateProgress, 300);
    return () => window.clearInterval(timer);
  }, [operation, classroomId, worksheetId, questionId, taskRevision]);

  /** 打开时先读已存的（不重算）；没算过则算一次。 */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      try {
        setPayload(await api.getWorksheetAnalysis(classroomId, worksheetId, questionId));
      } catch (e) {
        // 🔴 **只把 404 当成「还没算过」**。原先 `catch {}` 吞掉一切再改写 ——
        // 那会把 GET 的真失败（网络断、500、库坏）当成「没算过」而**触发一次 POST**，
        // 于是教师看到的是第二次调用的错误，而第一次的真因被丢掉（独立审查 M7）。
        if (!isNotFound(e)) throw e;
        setPayload(await api.computeWorksheetAnalysis(classroomId, worksheetId, questionId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取分析失败');
    } finally {
      setLoading(false);
    }
  }, [classroomId, worksheetId, questionId]);

  useEffect(() => { if (enabled) void load(); }, [load, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision = 0;
    const refresh = () => {
      clearTimeout(timer);
      const requestRevision = ++revision;
      timer = setTimeout(() => {
        void api.getWorksheetAnalysis(classroomId, worksheetId, questionId).then(next => {
          if (alive && requestRevision === revision) setPayload(next);
        }).catch(() => { /* Keep the current result during a temporary disconnect. */ });
      }, 150);
    };
    const stopReview = on('worksheet-analysis-updated', data => { if (data.worksheetId === worksheetId) refresh(); });
    const stopAnswer = on('worksheet-answer-updated', data => { if (data.classroomId === classroomId && data.questionId === questionId) refresh(); });
    const fallback = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    return () => { alive = false; clearTimeout(timer); clearInterval(fallback); stopReview(); stopAnswer(); window.removeEventListener('focus', refresh); };
  }, [enabled, on, classroomId, worksheetId, questionId]);

  const run = useCallback(async (only?: string[], regrade = false, incremental = false, analysisOnly = false) => {
    if (ownedRun.current) return;
    ownedRun.current = true;
    setOperation('analyzing');
    setActiveAction(regrade ? 'regrade' : incremental || only?.length ? 'incremental' : 'analysis');
    setRunStage('preparing');
    setRunElapsedSeconds(0);
    setRunMessage(null);
    setError(null);
    try {
      const task = startWorksheetAnalysisTask({
        classroomId, worksheetId, questionId, regrade, incremental, analysisOnly,
        questionLabel: payload?.questionLabel ?? '当前任务',
        ...(only && only.length > 0 ? { only } : {}),
      });
      const out = await task.promise;
      setRunStage('finalizing');
      // 只合入 AI 产出的解读、参考评分与审计字段；载荷统计一个都不动。
      try {
        setPayload(await api.getWorksheetAnalysis(classroomId, worksheetId, questionId));
      } catch {
        setPayload((prev) => (prev ? { ...prev, ...out } : prev));
      }
      // 让“结果已返回”这一阶段能被人看见；不影响请求本身，也不伪造网络进度。
      await new Promise<void>((resolve) => window.setTimeout(resolve, 450));
    } catch (e) {
      // 保留已有报告，并回读前几批可能已成功保存的评分。
      setError(e instanceof Error ? e.message : '分析失败');
      try { setPayload(await api.getWorksheetAnalysis(classroomId, worksheetId, questionId)); } catch {}
    } finally {
      ownedRun.current = false;
      setRunStage(null);
      setOperation(null);
    }
  }, [classroomId, worksheetId, questionId, payload?.questionLabel]);

  const stop = async () => {
    setStopping(true);
    try { await stopWorksheetAnalysisTask(classroomId, worksheetId, questionId); }
    catch (e) { setError(e instanceof Error ? e.message : '停止失败，请重试'); }
    finally { setStopping(false); }
  };
  const clear = async (kind: 'grades' | 'result', participantIds?: string[]) => {
    setClearing(true);
    setError(null);
    try {
      await api.clearWorksheetAnalysis(classroomId, worksheetId, questionId, kind, participantIds);
      if (kind === 'result') forgetWorksheetAnalysis(classroomId, worksheetId, questionId);
      await load();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : '清除失败，请重试'); return false; }
    finally { setClearing(false); }
  };

  return {
    payload, loading, busy, operation, activeAction, runStage, runElapsedSeconds, runMessage,
    error, sheetFailed, stopping, clearing, stop, clear,
    markSheetFailed: useCallback(() => setSheetFailed(true), []),
    run,
    unit: moduleCountUnit(mode),
  };
}

/** 状态条那两行（过期警告 / 错误）。两处宿主共用。 */
export function AnalysisBanners({ state }: { state: WorksheetAnalysisState }) {
  const stopped = state.error?.startsWith('分析已停止');
  return (
    <>
      {/* 「算完之后又有人交了」—— 服务端算的，必须显眼。否则教师会把一份不完整的名单当成当前的。 */}
      {!state.busy && state.payload?.stale && state.payload.narrative && (
        <div style={{ padding: '8px 18px', background: '#edf5ff', borderBottom: '1px solid #d7e5f4', color: '#315f8c', fontSize: '0.82rem', flex: '0 0 auto' }}>
          作答或分析依据有更新，重新生成班级分析后即可纳入总结。
        </div>
      )}
      {state.error && (
        <div role={stopped ? 'status' : 'alert'} style={{ padding: '8px 18px', background: stopped ? '#edf5ff' : '#f8eeee', borderBottom: `1px solid ${stopped ? '#d7e5f4' : '#fca5a5'}`, color: stopped ? '#315f8c' : '#b91c1c', fontSize: '0.82rem', flex: '0 0 auto' }}>
          {state.error}
        </div>
      )}
    </>
  );
}

/**
 * 正文（文档 / 联系表 / 解读 / 确认块）。
 * ⚠️ **从 `analysis-overlay.tsx` 原样搬过来**，行为一个字没改。
 */
export function AnalysisBody({ state, classroomId, worksheetId, questionId, nameOf, onOpenStudent, compact = false }: {
  compact?: boolean;
  state: WorksheetAnalysisState;
  classroomId: string;
  worksheetId: string;
  questionId: string;
  /**
   * ★ 2026-09-29（教师）：「为什么没有显示姓名」。
   *
   * 🔴 ★ 2026-10-07（教师裁定）**改口径了**：发出去的那张图上就是**真名 + 学号**
   * （`张伟#7`）。教师明确接受这个代价 —— 伪名只差最后一位、模型读图会看串，
   * 而看串的后果是分数**静默贴到别人头上**（原本那张对照表藏在「查看发送数据」里，
   * 不看就无从核对）。**别再照旧注释把它改回伪名。**
   * ⚠️ 真名只出现在**发给分析型智能体的那份载荷**上；聊天那条路仍走 `anonymizer`。
   *
   * ⇒ 教师要看的是「第 3 格是谁」，而这个映射**本来就在他手上的数据里**
   *（载荷里的 `entries[].studentId` 就是参与者 id，名册在这一屏也有）。
   * 于是**只在教师自己的屏幕上**画一张对照表 —— 既不发出去，也不改任何载荷。
   *
   * ⚠️ 缺省不传时优先使用服务端随本次教师查询返回的 `participantNames`；这个映射
   * 只回到教师端，不会进入发给第三方 AI 的载荷。
   */
  nameOf?: (participantId: string) => string | null;
  onOpenStudent?: (participantId: string) => void;
}) {
  const { payload, loading, sheetFailed } = state;
  const sheets = payload?.sheetLayouts ?? [];
  const generatingReport = state.busy && state.activeAction !== 'incremental';
  const pendingMessage = state.runMessage || (state.activeAction === 'incremental'
    ? '正在补评未评学生，请稍等…'
    : state.activeAction === 'regrade'
      ? `正在${worksheetAnalysisActions(payload).regradeLabel}，请稍等…`
      : `正在${worksheetAnalysisActions(payload).primaryLabel}，请稍等…`);
  const [showDetails, setShowDetails] = useState(false);

  /**
   * ★ 2026-09-29（教师）：「经过第三方 AI 分析后返回的数据，在看的时候还是要有真名」。
   *
   * 🔴 ★ 2026-10-07（教师：标签改用「姓名 + 学号」）—— **这一段的职责缩小了**：
   *   新结果里标签**本身就是真名**（`张伟#7`），既不需要、也**不许**替换；
   *   只有**老结果**里嵌着的 `User_00X` 还要换回真名（那些 narrative 已经存在库里）。
   * ⇒ 换成 `localizeLegacyLabels`（只认老格式那个正则）。
   *
   * 🔴 **朴素子串替换到这里为止**：它过去的安全性只依赖「`User_001` 互不为子串」，
   *   而标签换成真名之后，姓名可能是**别人姓名或正文的子串** ⇒ 静默改错文字。
   *   判据在 `src/lib/worksheet-analysis-cells.test.ts`（含反面对照）。
   *
   * ⚠️ **替换只发生在渲染这一层**：库里存的仍是模型原样返回的那份
   * （`WorksheetQuestionAnalysis.narrative` 不变）⇒ 将来若有人把这段解读**导出**
   * 或**别处复用**，老结果里那份东西仍是老式伪名 —— 想让它也带真名，要在**那一处**同样替换。
   * 这一句写在这里，是因为「同一份数据在两个出口长得不一样」是本仓反复吃的形状。
   */
  const localize = (text: string | null | undefined): string | null => {
    if (!payload) return text ?? null;
    return localizeLegacyLabels(text, payload.entries, (studentId) => (
      payload.participantNames?.[studentId] ?? nameOf?.(studentId) ?? null
    ));
  };

  return (
    <div className={`${styles.body} ${compact ? styles.compactBody : ''}`}>
      {loading && <div className={styles.loading}>正在读取已保存的分析结果…</div>}

      {!loading && payload && payload.covered === 0 && (
        <div className={styles.emptyResult}><strong>等待学生提交作品</strong><span>学生提交后，作答统计和 AI 评价会自动显示在这里。</span></div>
      )}

      {!loading && !state.busy && payload && payload.covered > 0 && payload.aiScoring.enabled && !payload.studentAiReviewEnabled && (() => {
        const scored = new Set((payload.perStudent?.scores ?? []).filter(row => row.score !== null).map(row => row.studentId));
        const unscorable = new Set(payload.unscorableIds ?? []);
        const missing = payload.entries.filter(row => !scored.has(row.studentId));
        const names = (unreadable: boolean) => missing.filter(row => unscorable.has(row.studentId) === unreadable)
          .map(row => payload.participantNames?.[row.studentId] ?? nameOf?.(row.studentId) ?? '未命名学生');
        const ungraded = names(false);
        const unreadable = names(true);
        if (!missing.length) return null;
        return <div className={styles.scoreMissing}>
          {ungraded.length > 0 && <span>尚未评分：<strong>{ungraded.join('、')}</strong></span>}
          {unreadable.length > 0 && <span>作品暂无法识别：<strong>{unreadable.join('、')}</strong>，请重新提交清晰作品。</span>}
        </div>;
      })()}

      {!loading && payload?.perStudent && (payload.perStudent.scores.length > 0 || !!payload.pendingReviewIds?.length) && (
        <details className={styles.scoreCard} aria-label="全班 AI 评分明细" open={payload.studentAiReviewEnabled || undefined} key={`${classroomId}:${worksheetId}:${questionId}`}>
          <summary className={styles.scoreHeader}>
            <div className={styles.scoreHeaderTitle}>
              <svg className={styles.scoreTableIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18M3 14h18M9 9v11" />
              </svg>
              <strong>全班 AI 评分明细</strong>
            </div>
            <div className={styles.scoreHeaderActions}>
              <span className={styles.scoreToggleClosed}>展开明细</span>
              <span className={styles.scoreToggleOpen}>收起明细</span>
              <svg className={styles.scoreChevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </div>
          </summary>
          {payload.perStudent.criteria && (
            /* ★ 2026-10-05：「评分要求」与「评分标准」在编辑器里已合并成同一份东西
               （唯一读取点 `rubricTextOf`）⇒ 这里跟着改名，同一个东西不叫两个名字。
               存下来的这一份是**那次分析时**用的文字，旧分析里的仍是当年的「评分要求」原文。 */
            <div className={styles.scoreCriteria}>评分标准：{payload.perStudent.criteria}</div>
          )}
          <div className={styles.scoreList}>
            {sortAnalysisScores([...payload.perStudent.scores, ...(payload.pendingReviewIds ?? []).filter(id => !payload.perStudent!.scores.some(row => row.studentId === id)).map(studentId => ({ studentId, score: null, reason: '', advice: '' }))], payload.entries).map((item) => (
              <div className={styles.scoreRow} key={item.studentId}>
                <span className={styles.scoreName}>
                  {payload.participantNames?.[item.studentId] ?? nameOf?.(item.studentId) ?? '未命名学生'}
                  {(() => {
                    const meta = scoreParticipantMeta(payload.entries, item.studentId);
                    return <span className={styles.scoreCell}>
                      {meta.number && `#${meta.number}`}
                    </span>;
                  })()}
                  {payload.pendingReviewIds?.includes(item.studentId) && <span className={styles.reviewPending} role="status"><TeacherPendingText>AI 正在评价…</TeacherPendingText></span>}
                </span>
                {!payload.pendingReviewIds?.includes(item.studentId) && <strong className={styles.scoreValue}>
                  {(() => {
                    if (item.score === null) return '暂无法评分';
                    if (item.score === 0) return null;
                    const unit = payload.perStudent!.unit;
                    const reward = REWARD_STYLE_OPTIONS.find(option => option.value !== 'points' && pointsUnitLabel(option.value) === unit);
                    if (!reward || !Number.isInteger(item.score)) return `${item.score} / ${payload.perStudent!.maxScore} ${unit}`;
                    return <span className={styles.scoreRewards} role="img" aria-label={`${item.score} ${unit}，满额 ${payload.perStudent!.maxScore}`} title={`${item.score} / ${payload.perStudent!.maxScore} ${unit}`}>
                      {Array.from({ length: item.score }, (_, index) => <RewardIcon key={index} kind={reward.value} size={22} />)}
                    </span>;
                  })()}
                </strong>}
                {!payload.pendingReviewIds?.includes(item.studentId) && <div className={styles.scoreReason}>
                  <div className={styles.scoreReasonHeading}>
                    <span>{item.reason || '智能体未补充简短评价'}</span>
                    <div className={styles.scoreReviewActions}>
                    {onOpenStudent && <button type="button" className={styles.answerShortcut}
                      onClick={() => onOpenStudent(item.studentId)} title="查看这位学生的本题作答" aria-label={`查看${payload.participantNames?.[item.studentId] ?? nameOf?.(item.studentId) ?? '这位学生'}的本题作答`}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M15 3h6v6m0-6L10 14M7 8h3M7 17h7" /></svg>
                    </button>}
                    <ReviewPreviewButton title={`${payload.participantNames?.[item.studentId] ?? nameOf?.(item.studentId) ?? '学生'} · AI 评价与建议`}
                      reason={item.reason} advice={item.advice || payload.feedback?.students.find(row => row.studentId === item.studentId)?.advice}
                      score={item.score} maxScore={payload.perStudent!.maxScore} unit={payload.perStudent!.unit} />
                    </div>
                  </div>
                  {(item.advice || payload.feedback?.students.find(row => row.studentId === item.studentId)?.advice) && (
                    <div className={styles.scoreAdvice}>
                      <strong className={styles.scoreAdviceHeading}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.9.6-1.5 1.5-1.5 2.5h-4c0-1-.6-1.9-1.5-2.5Z" />
                        </svg>
                        AI 给{payload.participantNames?.[item.studentId] ?? nameOf?.(item.studentId) ?? '这位'}同学的小建议
                      </strong>
                      <p>{item.advice || payload.feedback?.students.find(row => row.studentId === item.studentId)?.advice}</p>
                    </div>
                  )}
                </div>}
              </div>
            ))}
          </div>
        </details>
      )}

      {!loading && payload && payload.covered > 0 && payload.narrative && !generatingReport && (
        <section className={styles.resultCard} aria-label="AI 分析结果">
          <AnalysisReport onOpenStudent={onOpenStudent} className={styles.resultText} payload={payload} text={localize(payload.narrative) ?? ''} />
        </section>
      )}

      {state.busy && <div className={`${styles.analysisNotice} ${styles.reportPending}`} role="status">
        <span className={styles.reportPendingDots} aria-hidden="true"><i /><i /><i /></span>
        <TeacherPendingText>{pendingMessage}</TeacherPendingText>
      </div>}

      {!loading && !state.busy && payload && payload.covered > 0 && !payload.narrative && (
        <div className={styles.analysisNotice}>{payload.perStudent?.scores.length ? '学生个人评价已更新。需要了解全班情况时，可生成全班分析。' : '已收到学生作品。可生成全班分析，查看整体情况。'}</div>
      )}

      {!loading && payload && payload.covered > 0 && (
        <>
          <button type="button" className={styles.detailsToggle}
            aria-expanded={showDetails} onClick={() => setShowDetails((value) => !value)}>
            {showDetails ? '收起发送数据' : '查看发送数据'}
            <span aria-hidden="true">{showDetails ? '⌃' : '⌄'}</span>
          </button>

          {showDetails && (
            <section className={styles.detailsPanel} aria-label="发送给 AI 的数据">
              <div className={styles.detailsHeading}>发送给 AI 的数据</div>
              {payload.payloadKind === 'mixed' && (
                <div className={styles.notice}>当前任务同时包含文字与笔迹作答，以下文档和联系表分别呈现两部分数据。</div>
              )}
              {payload.text !== null && payload.text !== undefined && payload.text !== '' && (
                <pre className={styles.payloadText}>{localize(payload.text)}</pre>
              )}
              {sheets.length > 0 && (
                <>
                  {payload.labeled === false && (
                    <div className={styles.notice}>联系表没有文字标签，请按下方编号对照表辨认。</div>
                  )}
                  {sheets.map((sheet) => (
                    <div key={sheet.sheetIndex} className={styles.sheetBlock}>
                      {sheets.length > 1 && (
                        <div className={styles.sheetCaption}>第 {sheet.sheetIndex + 1} 张 / 共 {sheets.length} 张</div>
                      )}
                      <img
                        src={api.worksheetAnalysisSheetUrl(classroomId, worksheetId, questionId, sheet.sheetIndex)}
                        alt={`${payload.questionLabel} 的联系表（第 ${sheet.sheetIndex + 1} 张）`}
                        onError={state.markSheetFailed}
                        className={styles.sheetImage}
                      />
                    </div>
                  ))}
                  {sheetFailed && (
                    <div role="alert" className={styles.errorNotice}>联系表暂时无法显示，文字数据仍可正常查看。</div>
                  )}
                  <ol className={styles.mapping}>
                    {payload.entries.map((entry, index) => {
                      const real = nameOf ? nameOf(entry.studentId) : null;
                      return (
                        <li key={entry.studentId}>
                          <b>{entry.anonLabel}</b>
                          {real ? <> · <b className={styles.realName}>{real}</b></> : null}
                          {' '}· 第 {index + 1} 格
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function AnalysisActionIcon({ action, pending = false, supplement = false }: { action: AnalysisAction; pending?: boolean; supplement?: boolean }) {
  return <svg className={pending ? styles.actionSpinner : undefined} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {pending ? <><circle cx="12" cy="12" r="8" opacity=".25" /><path d="M12 4a8 8 0 0 1 8 8" /></> : action === 'incremental'
      ? <><circle cx="8" cy="7" r="3" /><path d="M2 21v-3a6 6 0 0 1 12 0v3M19 6v8M15 10h8" /></>
      : action === 'regrade'
        ? <><path d="M3 8v13h18M7 17v-3M11 17v-6M15 17v-3" /><path d="M21 7a5 5 0 1 0-1.5 3.6M21 3v4h-4" /></>
        : supplement
          ? <><path d="M3 4v17h18M7 17v-5M11 17V8M15 17v-4M19 3v6M16 6h6" /></>
          : <><path d="M4 4v16h16M8 15v-4M13 15V7M18 15V4" /></>}
  </svg>;
}

function StudentScoreClearDialog({ payload, selected, onSelect, clearing, error, onClear, onClose, restoreFocus }: {
  payload: WorksheetAnalysisPayload | null;
  selected: string[];
  onSelect: (id: string, checked: boolean) => void;
  clearing: boolean;
  error: string | null;
  onClear: () => void;
  onClose: () => void;
  restoreFocus: HTMLElement | null;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    cancelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (dialog.getAttribute('aria-busy') !== 'true') onClose();
      } else if (event.key === 'Tab') {
        const controls = [...dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')].filter(control => !control.matches(':disabled'));
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => { document.removeEventListener('keydown', handleKey, true); restoreFocus?.focus(); };
  }, [onClose, restoreFocus]);
  return createPortal(
    <div className={styles.selectionBackdrop} data-overscroll-guard="" onClick={event => { if (event.target === event.currentTarget && !clearing) onClose(); }}>
      <div ref={dialogRef} className={styles.selectionDialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={clearing} tabIndex={-1}>
        <header className={styles.selectionHeader}>
          <h3 id={titleId}>选择学生清除 AI 评分</h3>
          <button type="button" aria-label="关闭学生选择窗口" disabled={clearing} onClick={onClose}>×</button>
        </header>
        <p id={descriptionId} className={styles.selectionDescription}>清除所选学生在当前任务的 AI 评分、评价及评分奖励，保留作答。</p>
        <fieldset className={styles.studentSelection} disabled={clearing}>
          <legend className={styles.selectionLegend}>选择学生</legend>
          {(payload?.entries ?? []).map(entry => <label key={entry.studentId} data-selected={selected.includes(entry.studentId)}><input type="checkbox" checked={selected.includes(entry.studentId)} onChange={event => onSelect(entry.studentId, event.target.checked)} />{payload?.participantNames?.[entry.studentId] ?? entry.anonLabel}</label>)}
        </fieldset>
        {error && <p className={styles.selectionError} role="alert">{error}</p>}
        <footer className={styles.selectionFooter}>
          <span>已选 {selected.length} 人</span>
          <button ref={cancelRef} type="button" className={styles.actionButton} disabled={clearing} onClick={onClose}>取消</button>
          <button type="button" className={`${styles.actionButton} ${styles.dangerButton}`} disabled={clearing || !selected.length} onClick={onClear}>{clearing ? '正在清除…' : '清除所选评分'}</button>
        </footer>
      </div>
    </div>, document.body,
  );
}

/** 结果窗底部：查看结果后可以直接重新分析，不再出现发送内容确认步骤。 */
export function AnalysisActions({ state, compact = false }: { state: WorksheetAnalysisState; compact?: boolean }) {
  const { payload, busy, operation, activeAction, runStage, runElapsedSeconds } = state;
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const clearMenuRef = useRef<HTMLDetailsElement>(null);
  const closeSelection = useCallback(() => { setSelecting(false); setSelected([]); setSelectionError(null); }, []);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = clearMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = clearMenuRef.current;
      if (event.key === 'Escape' && menu?.open) {
        event.preventDefault();
        event.stopPropagation();
        menu.open = false;
        menu.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, []);
  useEffect(() => {
    setSelected([]); setSelecting(false);
    if (clearMenuRef.current) clearMenuRef.current.open = false;
  }, [payload?.questionId]);
  const clear = async (kind: 'grades' | 'result', ids?: string[]) => {
    if (clearMenuRef.current) clearMenuRef.current.open = false;
    const scope = ids ? `选中的 ${ids.length} 位学生` : '全班学生';
    const message = kind === 'result' ? '清除当前任务的班级分析结果？学生作答和已有评分将保留。'
      : `清除当前任务${scope}的 AI 评分与评价？学生作答保留，已发放的当前任务评分奖励也会移除。`;
    if (!window.confirm(message)) return;
    setSelectionError(null);
    if (await state.clear?.(kind, ids)) { setSelected([]); setSelecting(false); }
    else if (ids) setSelectionError('评分未能清除，请重试。');
  };
  const actions = worksheetAnalysisActions(payload, busy ? activeAction ?? 'analysis' : null);
  if (payload?.covered === 0 && !busy) return null;
  const labelFor = (action: AnalysisAction, label: string) => operation === 'analyzing' && runStage && (activeAction ?? 'analysis') === action
    ? worksheetAnalysisProgressLabel(runStage, runElapsedSeconds) : label;

  return (
    <div className={`${styles.actions} ${compact ? styles.compactActions : ''}`} aria-busy={state.clearing || undefined}>
      <fieldset className={styles.operationButtons} disabled={state.clearing}>
      {actions.showSupplement && <button type="button" className={styles.actionButton} disabled={busy || !payload?.canSend.ok} onClick={() => void state.run(undefined, false, true)}><AnalysisActionIcon action="incremental" pending={busy && activeAction === 'incremental'} />{labelFor('incremental', `补评未评学生（${actions.ungradedCount}）`)}</button>}
      {actions.showAnalysis && <button type="button" disabled={!payload?.canSend.ok || busy}
        onClick={() => void state.run(undefined, false, false, actions.automatic)}
        title={payload && !payload.canSend.ok ? payload.canSend.reason : '分析会在后台执行，完成后自动保存'}
        className={styles.actionButton}>
        <AnalysisActionIcon action="analysis" supplement={actions.ungradedCount > 0} pending={busy && (activeAction ?? 'analysis') === 'analysis'} />
        {labelFor('analysis', actions.primaryLabel)}
      </button>}
      {actions.showRegrade && <button type="button" className={styles.actionButton} disabled={busy || !payload?.canSend.ok} onClick={() => { if (window.confirm('重新评分会替换本班已有 AI 评分，并按差额调整奖励。是否继续？')) void state.run(undefined, true); }}><AnalysisActionIcon action="regrade" pending={busy && activeAction === 'regrade'} />{labelFor('regrade', actions.regradeLabel)}</button>}
      {busy && state.stop && <button type="button" className={`${styles.actionButton} ${styles.dangerButton}`} disabled={state.stopping} onClick={() => void state.stop?.()}>{state.stopping ? '正在停止…' : '停止'}</button>}
      {!busy && state.clear && <details className={styles.clearMenu} ref={clearMenuRef}>
        <summary className={styles.actionButton}>{state.clearing ? '正在清除…' : '清除数据'}<svg className={styles.clearChevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></summary>
        <div className={styles.clearOptions}>
          <span>仅操作当前任务，保留学生作答</span>
          {actions.canClearAiScores && <button type="button" onClick={() => void clear('grades')}>清除全班 AI 评分</button>}
          {actions.canClearAiScores && <button type="button" onClick={() => { if (clearMenuRef.current) clearMenuRef.current.open = false; setSelected([]); setSelectionError(null); setSelecting(true); }}>选择学生清除 AI 评分</button>}
          <button type="button" onClick={() => void clear('result')}>清除班级分析结果</button>
        </div>
      </details>}
      </fieldset>
      {!busy && actions.canClearAiScores && selecting && <StudentScoreClearDialog payload={payload} selected={selected}
        onSelect={(id, checked) => setSelected(ids => checked ? [...ids, id] : ids.filter(value => value !== id))}
        clearing={state.clearing === true} error={selectionError} onClear={() => void clear('grades', selected)}
        onClose={closeSelection} restoreFocus={clearMenuRef.current?.querySelector('summary') ?? null} />}
            {/* 不可点时必须**说出来为什么** —— 只灰掉一个按钮，教师不知道该去哪儿修 */}
      {payload && !payload.canSend.ok && (
        <span className={styles.actionWarning}>{payload.canSend.reason}</span>
      )}
      {payload?.canSend.ok && !busy && (
        <span className={styles.actionHint}>{actions.hint}</span>
      )}
    </div>
  );
}
