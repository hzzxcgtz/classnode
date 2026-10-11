'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isNotFound } from '@/lib/http-error';
import type { WorksheetAnalysisPayload } from '@/lib/types';
import { moduleCountUnit } from './worksheet-tile-state';
import { activeWorksheetAnalysisTask, startWorksheetAnalysisTask, WORKSHEET_ANALYSIS_STARTED_EVENT } from '@/lib/worksheet-analysis-background';
import { worksheetAnalysisProgressLabel } from '@/lib/worksheet-analysis-progress';
import { localizeLegacyLabels } from '@/lib/worksheet-analysis-cells';
import { AnalysisReport } from './analysis-report';
import { scoreParticipantMeta, sortAnalysisScores } from '@/lib/worksheet-analysis-score-display';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import { RewardUnit } from '@/components/worksheet-reward-unit';
import { pointsUnitLabel, REWARD_STYLE_OPTIONS } from '@/lib/worksheet-reward';
import styles from './analysis-panel.module.css';

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
  runStage: AnalysisRunStage;
  runElapsedSeconds: number;
  error: string | null;
  /** 联系表的图没取回来（服务端缺 sharp 时回 503）。没有它，界面上只有一个**坏图**。 */
  sheetFailed: boolean;
  markSheetFailed: () => void;
  /**
   * 后台重新整理数据并调用远端智能体；无需二次确认。
   * ★ 2026-10-07：`only` = **只补这几个人**（模型上次漏掉的那几个）；
   *   不传就是全班 —— 补跑只补分、不动整体解读，见服务端那条注释。
   */
  run: (only?: string[]) => Promise<void>;
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
  const [payload, setPayload] = useState<WorksheetAnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<AnalysisOperation>(null);
  const [runStage, setRunStage] = useState<AnalysisRunStage>(null);
  const [runElapsedSeconds, setRunElapsedSeconds] = useState(0);
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
    if (!task) return;
    let alive = true;
    setOperation('analyzing');
    setRunStage(task.stage);
    setRunElapsedSeconds(Math.max(0, Math.floor((Date.now() - task.startedAt) / 1000)));
    const stageTimer = window.setInterval(() => {
      setRunStage(task.stage);
      // 根据任务真实开始时间重算，后台节流或面板重挂载不会漏计秒数。
      setRunElapsedSeconds(Math.max(0, Math.floor((Date.now() - task.startedAt) / 1000)));
    }, 300);
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
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '分析失败');
      })
      .finally(() => {
        if (!alive) return;
        setRunStage(null);
        setOperation(null);
      });
    return () => { alive = false; window.clearInterval(stageTimer); };
  }, [classroomId, worksheetId, questionId, taskRevision]);

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

  const run = useCallback(async (only?: string[]) => {
    setOperation('analyzing');
    setRunStage('preparing');
    setRunElapsedSeconds(0);
    setError(null);
    // 远端平台只在请求结束时返回最终结果，无法报告真实百分比；这里按已经开始的真实步骤
    // 给教师阶段提示，不伪造“完成 63%”一类精度。
    const stageTimers = [
      window.setTimeout(() => setRunStage('sending'), 650),
      window.setTimeout(() => setRunStage('analyzing'), 1800),
    ];
    try {
      const task = startWorksheetAnalysisTask({
        classroomId, worksheetId, questionId,
        questionLabel: payload?.questionLabel ?? '本题',
        ...(only && only.length > 0 ? { only } : {}),
      });
      const out = await task.promise;
      stageTimers.forEach((timer) => window.clearTimeout(timer));
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
      stageTimers.forEach((timer) => window.clearTimeout(timer));
      // 🔴 失败**不动 payload.narrative** —— 已有的解读必须原样留在屏幕上
      // （服务端也没写库；两边都不动，才叫「失败不丢东西」）。
      setError(e instanceof Error ? e.message : '分析失败');
    } finally {
      setRunStage(null);
      setOperation(null);
    }
  }, [classroomId, worksheetId, questionId, payload?.questionLabel]);

  return {
    payload, loading, busy, operation, runStage, runElapsedSeconds,
    error, sheetFailed,
    markSheetFailed: useCallback(() => setSheetFailed(true), []),
    run,
    unit: moduleCountUnit(mode),
  };
}

/** 状态条那两行（过期警告 / 错误）。两处宿主共用。 */
export function AnalysisBanners({ state }: { state: WorksheetAnalysisState }) {
  return (
    <>
      {/* 「算完之后又有人交了」—— 服务端算的，必须显眼。否则教师会把一份不完整的名单当成当前的。 */}
      {state.payload?.stale && (
        <div style={{ padding: '8px 18px', background: '#faf4eb', borderBottom: '1px solid #fde68a', color: '#92400e', fontSize: '0.82rem', flex: '0 0 auto' }}>
          ⚠️ 有新的作答，结果可能已过期 —— 点「重新生成」以纳入。
        </div>
      )}
      {state.error && (
        <div role="alert" style={{ padding: '8px 18px', background: '#f8eeee', borderBottom: '1px solid #fca5a5', color: '#b91c1c', fontSize: '0.82rem', flex: '0 0 auto' }}>
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
        <div className={styles.emptyResult}>这道题还没有已提交的作答。</div>
      )}

      {/*
        ★ 2026-10-07（教师：40 人一起交给智能体）—— 模型**很少一次评全**，
        而面板原来是「有分就显示、没拿到的人连名字都不出现」⇒ 教师无从知道漏了谁。
        这里把缺的人点名说出来（用真名，`participantNames` 那张表只给教师端）。
        ⚠️ 文案里那句「已经拿到的分不会丢」是真的：服务端写的时候是**并进**已存那份
           （见 `mergeAiScoring`），补跑不会把上一轮拿到的分换掉。
      */}
      {!loading && payload?.aiScoring?.enabled && (
        (() => {
          const got = payload.perStudent?.scores.length ?? 0;
          const all = payload.perStudent?.missing ?? [];
          /*
           * ★ 2026-10-07：把「模型这次漏了」与「**根本评不了**」分开 ——
           *  后者是那些**图没取到、形状也认不出**的作答（载荷里的 `unscorableIds`）。
           *  ⚠️ 他们**不能**进「只补这 N 人」那颗按钮：补跑再多次也评不出来，
           *    只会白等三分钟。要的是**让学生重新提交一次**（重交会重新抓一张图）。
           */
          const unscorable = new Set(payload.unscorableIds ?? []);
          const missing = all.filter((id) => !unscorable.has(id));
          const cannotScore = all.filter((id) => unscorable.has(id));
          if (missing.length === 0 && cannotScore.length === 0 && got > 0) return null;
          const names = missing.map((id) => payload.participantNames?.[id] ?? nameOf?.(id) ?? '未命名学生');
          const cannotNames = cannotScore.map((id) => payload.participantNames?.[id] ?? nameOf?.(id) ?? '未命名学生');
          return (
            <div className={styles.scoreMissing}>
              {got === 0
                ? '本次没有拿到任何逐生评分。'
                : `本次只拿到 ${got}/${got + missing.length} 份评分。`}
              {names.length > 0 && <> 还没拿到分的：<strong>{names.join('、')}</strong>。</>}
              {/*
                ★ 2026-10-07（教师问：「只补这几个人的话，AI 对整体的分析是不是也要更新呢？」）——
                答案：**要**。补跑只补分、不动整体解读（模型那段解读只说了这几个人，
                拿它盖掉全班那份是错的）。所以这里把「整体解读是按几个人写的」直接说出来：
                  拿到的分比解读当时覆盖的人多 ⇒ 那份整体解读已经旧了，人齐了就提示重写一遍。
              */}
              {(payload.perStudent?.scores.length ?? 0) > (payload.covered ?? 0) && (
                <span>
                  整体分析是按当时 <strong>{payload.covered}</strong> 人写的，现在已经有 {payload.perStudent?.scores.length} 人有分 ——
                  点「重新生成」可以按完整的人重写一遍整体分析。
                </span>
              )}
              {missing.length > 0 && (
                <button type="button" className={styles.scoreMissingAction} onClick={() => void state.run(missing)}>
                  只补这 {missing.length} 人
                </button>
              )}
              {missing.length > 0 && (
                <span>补跑只补这几个人的分（已经拿到的分不会丢，整体分析不动）。</span>
              )}
              {cannotScore.length > 0 && (
                <span>
                  <strong>{cannotNames.join('、')}</strong> 的作答这一版读不出来（快照没抓到、形状也认不出），
                  AI 评不了他们 —— 让他们重新提交一次这道题（重交会重新抓一张图），再点「重新生成」。
                </span>
              )}
            </div>
          );
        })()
      )}

      {!loading && payload?.perStudent && (
        <details className={styles.scoreCard} aria-label="AI 评分" key={`${classroomId}:${worksheetId}:${questionId}`}>
          <summary className={styles.scoreHeader}>
            <div>
              <strong>AI 评分</strong>
              <span className={styles.scoreFullMarks}>满额 {payload.perStudent.maxScore} <RewardUnit unit={payload.perStudent.unit} /></span>
            </div>
            {/* ★ 2026-10-07（教师裁定 2）：这份分**已经写回成绩**（进总分、进奖励、进报告），
                不再是「仅供参考」的旁注 —— 那句话会让教师以为不必核对。 */}
            <div className={styles.scoreHeaderActions}>
              <span className={styles.aiScoreNotice}>已计入成绩</span>
              <span className={styles.scoreToggleClosed}>展开评分 ▾</span>
              <span className={styles.scoreToggleOpen}>收拢评分 ▴</span>
            </div>
          </summary>
          {payload.perStudent.criteria && (
            /* ★ 2026-10-05：「评分要求」与「评分标准」在编辑器里已合并成同一份东西
               （唯一读取点 `rubricTextOf`）⇒ 这里跟着改名，同一个东西不叫两个名字。
               存下来的这一份是**那次分析时**用的文字，旧分析里的仍是当年的「评分要求」原文。 */
            <div className={styles.scoreCriteria}>评分标准：{payload.perStudent.criteria}</div>
          )}
          <div className={styles.scoreList}>
            {sortAnalysisScores(payload.perStudent.scores, payload.entries).map((item) => (
              <div className={styles.scoreRow} key={item.studentId}>
                <span className={styles.scoreName}>
                  {payload.participantNames?.[item.studentId] ?? nameOf?.(item.studentId) ?? '未命名学生'}
                  {(() => {
                    const meta = scoreParticipantMeta(payload.entries, item.studentId);
                    return <span className={styles.scoreCell}>
                      {meta.number && `#${meta.number}`}
                    </span>;
                  })()}
                </span>
                <strong className={styles.scoreValue}>
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
                </strong>
                <div className={styles.scoreReason}>
                  <span>{item.reason || '智能体未补充简短评价'}</span>
                  {(payload.feedback?.students.find(row => row.studentId === item.studentId)?.advice || item.advice) && (
                    <div className={styles.scoreAdvice}>
                      <strong className={styles.scoreAdviceHeading}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.9.6-1.5 1.5-1.5 2.5h-4c0-1-.6-1.9-1.5-2.5Z" />
                        </svg>
                        AI 给{payload.participantNames?.[item.studentId] ?? nameOf?.(item.studentId) ?? '这位'}同学的小建议
                      </strong>
                      <p>{payload.feedback?.students.find(row => row.studentId === item.studentId)?.advice || item.advice}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {!loading && payload?.feedback && (() => {
        const scored = new Set((payload.perStudent?.scores ?? []).filter(row => row.advice).map(row => row.studentId));
        const students = sortAnalysisScores(payload.feedback.students.filter(row => !scored.has(row.studentId)), payload.entries);
        const missing = payload.feedback.missing.filter(id => !scored.has(id));
        if (students.length === 0 && missing.length === 0) return null;
        return <details className={styles.scoreCard} aria-label="学生小建议" key={`feedback:${classroomId}:${worksheetId}:${questionId}`}>
          <summary className={styles.scoreHeader}><div><strong>学生小建议</strong><span>{students.length} 条</span></div><div><span className={styles.scoreToggleClosed}>展开建议 ▾</span><span className={styles.scoreToggleOpen}>收拢建议 ▴</span></div></summary>
          {missing.length > 0 && <div className={styles.scoreCriteria}>还有 {missing.length} 位同学的小建议未通过核对或未返回，可重新分析补全。</div>}
          <div className={styles.scoreList}>{students.map(item => <div className={styles.feedbackRow} key={item.studentId}>
            <span className={styles.scoreName}>{payload.participantNames?.[item.studentId] ?? '未命名学生'} <span className={styles.scoreCell}>{scoreParticipantMeta(payload.entries, item.studentId).number && `#${scoreParticipantMeta(payload.entries, item.studentId).number}`}</span></span>
            <div className={styles.scoreAdvice}><strong className={styles.scoreAdviceHeading}>AI 给{payload.participantNames?.[item.studentId] ?? '这位'}同学的小建议</strong><p>{item.advice}</p></div>
          </div>)}</div>
        </details>;
      })()}

      {!loading && payload && payload.covered > 0 && payload.narrative && (
        <section className={styles.resultCard} aria-label="AI 分析结果">
          <AnalysisReport onOpenStudent={onOpenStudent} className={styles.resultText} payload={payload} text={localize(payload.narrative) ?? ''} />
        </section>
      )}

      {!loading && payload && payload.covered > 0 && !payload.narrative && (
        <div className={styles.emptyResult}>尚未开始分析。点击分析按钮后，任务会在后台完成并自动保存。</div>
      )}

      {!loading && payload && (
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
                <div className={styles.notice}>本题同时包含文字与笔迹作答，以下文档和联系表分别呈现两部分数据。</div>
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

/** 结果窗底部：查看结果后可以直接重新分析，不再出现发送内容确认步骤。 */
export function AnalysisActions({ state, compact = false }: { state: WorksheetAnalysisState; compact?: boolean }) {
  const { payload, busy, operation, runStage, runElapsedSeconds } = state;
  let actionText = payload?.narrative
    ? (payload.aiScoring.enabled ? '重新分析与评分' : '重新分析')
    : (payload?.aiScoring.enabled ? '分析与评分' : '开始分析');
  if (operation === 'analyzing' && runStage) actionText = worksheetAnalysisProgressLabel(runStage, runElapsedSeconds);
  return (
    <div className={`${styles.actions} ${compact ? styles.compactActions : ''}`}>
      <button type="button" disabled={!payload?.canSend.ok || busy}
        onClick={() => void state.run()}
        title={payload && !payload.canSend.ok ? payload.canSend.reason : '分析会在后台执行，完成后自动保存'}
        className={styles.actionButton}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2" /></svg>
        {actionText}
      </button>
      {/* 不可点时必须**说出来为什么** —— 只灰掉一个按钮，教师不知道该去哪儿修 */}
      {payload && !payload.canSend.ok && (
        <span className={styles.actionWarning}>{payload.canSend.reason}</span>
      )}
      {payload?.canSend.ok && !busy && (
        <span className={styles.actionHint}>分析会在后台执行，完成后自动保存</span>
      )}
    </div>
  );
}
