'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isNotFound } from '@/lib/http-error';
import type { WorksheetAnalysisPayload } from '@/lib/types';
import { moduleCountUnit } from './worksheet-tile-state';
import { activeWorksheetAnalysisTask, startWorksheetAnalysisTask } from '@/lib/worksheet-analysis-background';
import { worksheetAnalysisProgressLabel } from '@/lib/worksheet-analysis-progress';
import { Markdown } from '@/lib/markdown';
import { normalizeWorksheetAnalysisMarkdown } from '@/lib/worksheet-analysis-markdown';
import styles from './analysis-panel.module.css';

export type AnalysisOperation = 'analyzing' | null;
export type AnalysisRunStage = 'preparing' | 'sending' | 'analyzing' | 'finalizing' | null;

/**
 * 「智能体解读」的**取数 + 呈现**，抽出来给**两处**用（★ 2026-09-28，规格 §6.2）。
 *
 * 🔴 **为什么要抽**（不是洁癖）：
 *   · 它今天有两个宿主 —— 整屏的 `AnalysisOverlay`（从矩阵那条路进）与
 *     **按题统计浮层**里那块内联的「② 智能体解读」；
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
  /** 后台重新整理数据并调用远端智能体；无需二次确认。 */
  run: () => Promise<void>;
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
): WorksheetAnalysisState {
  const [payload, setPayload] = useState<WorksheetAnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<AnalysisOperation>(null);
  const [runStage, setRunStage] = useState<AnalysisRunStage>(null);
  const [runElapsedSeconds, setRunElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sheetFailed, setSheetFailed] = useState(false);
  const busy = operation !== null;

  useEffect(() => {
    if (operation !== 'analyzing') return;
    const timer = window.setInterval(() => setRunElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [operation]);

  // 关闭浮窗后任务仍在模块级注册表中。重新打开同一道题时接回原 Promise，而不是重复外发。
  useEffect(() => {
    const task = activeWorksheetAnalysisTask(classroomId, worksheetId, questionId);
    if (!task) return;
    let alive = true;
    setOperation('analyzing');
    setRunStage(task.stage);
    setRunElapsedSeconds(Math.max(0, Math.floor((Date.now() - task.startedAt) / 1000)));
    const stageTimer = window.setInterval(() => setRunStage(task.stage), 300);
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
  }, [classroomId, worksheetId, questionId]);

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

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async () => {
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
      });
      const out = await task.promise;
      stageTimers.forEach((timer) => window.clearTimeout(timer));
      setRunStage('finalizing');
      // 只把那三格合进去（`aggregate`/`covered` 那些是载荷那一侧，这次一个都没动）
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
export function AnalysisBody({ state, classroomId, worksheetId, questionId, nameOf }: {
  state: WorksheetAnalysisState;
  classroomId: string;
  worksheetId: string;
  questionId: string;
  /**
   * ★ 2026-09-29（教师）：「为什么没有显示姓名」。
   *
   * 🔴 **发出去的东西一个字不改**：那张联系表与文档上的标签**必须**是伪名
   * （`User_001`…）—— 它们是**要发给第三方 AI 的**，而本项目的匿名器规定
   * 「任何提示词离开这台机器之前，真名一律换成伪名」（`ai-proxy.ts`）。
   * 真名进那张图 = 把未成年人的姓名发给第三方，**那不是这一屏能决定的事**。
   *
   * ⇒ 教师要看的是「第 3 格是谁」，而这个映射**本来就在他手上的数据里**
   *（载荷里的 `entries[].studentId` 就是参与者 id，名册在这一屏也有）。
   * 于是**只在教师自己的屏幕上**画一张对照表 —— 既不发出去，也不改任何载荷。
   *
   * ⚠️ 缺省不传 ⇒ 退回「只有伪名」（整屏那个分析浮层没有名册，它就不传）。
   */
  nameOf?: (participantId: string) => string | null;
}) {
  const { payload, loading, sheetFailed } = state;
  const sheets = payload?.sheetLayouts ?? [];
  const [showDetails, setShowDetails] = useState(false);

  /**
   * ★ 2026-09-29（教师）：「经过第三方 AI 分析后返回的数据，在看的时候还是要有真名」。
   *
   * 🔴 **这就是学伴那条路上早就有的做法**（`ai-proxy.ts` 的文件头：出去时换成伪名，
   * 模型回话时再把真名换回来）—— 分析这条路当时只做了前半段，于是教师在屏幕上
   * 读到的是 `User_001 把第 2 空填成了…`。
   *
   * ⚠️ **替换只发生在渲染这一层**：发给 AI 的仍然是伪名，库里存的也仍然是伪名
   * （`WorksheetQuestionAnalysis.narrative` 不变）。⇒ 将来若有人把这段解读**导出**
   * 或**别处复用**，那份东西里仍是伪名 —— 想让它也带真名，要在**那一处**同样替换。
   * 这一句写在这里，是因为「同一份数据在两个出口长得不一样」是本仓反复吃的形状。
   *
   * ⚠️ 朴素替换（不是正则）是安全的：伪名是 `User_` + **至少三位**零填充
   *（`payloadLabels` 的 `padStart(3, '0')`），`User_001` 不会出现在别的伪名里面。
   * 一个班不可能有 1000 人。
   */
  const localize = (text: string | null | undefined): string | null => {
    if (!text) return text ?? null;
    if (!nameOf || !payload) return text;
    return payload.entries.reduce((acc, entry) => {
      const real = nameOf(entry.studentId);
      return real ? acc.split(entry.anonLabel).join(real) : acc;
    }, text);
  };

  return (
    <div className={styles.body}>
      {loading && <div className={styles.loading}>正在读取已保存的分析结果…</div>}

      {!loading && payload && payload.covered === 0 && (
        <div className={styles.emptyResult}>这道题还没有已提交的作答。</div>
      )}

      {!loading && payload && payload.covered > 0 && payload.narrative && (
        <section className={styles.resultCard} aria-label="AI 解读结果">
          <div className={styles.resultHeader}>
            <span className={styles.aiMark}>AI</span>
            <span className={styles.resultTitle}>AI 解读</span>
            {payload.model && <span className={styles.resultMeta}>{payload.model}</span>}
          </div>
          <Markdown className={styles.resultText} allowImages={false}>
            {normalizeWorksheetAnalysisMarkdown(localize(payload.narrative) ?? '')}
          </Markdown>
        </section>
      )}

      {!loading && payload && payload.covered > 0 && !payload.narrative && (
        <div className={styles.emptyResult}>尚未生成 AI 解读。点击下方按钮后，分析会在后台完成并自动保存。</div>
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
export function AnalysisActions({ state }: { state: WorksheetAnalysisState }) {
  const { payload, busy, operation, runStage, runElapsedSeconds } = state;
  let actionText = payload?.narrative ? '重新生成 AI 解读' : '生成 AI 解读';
  if (operation === 'analyzing' && runStage) actionText = worksheetAnalysisProgressLabel(runStage, runElapsedSeconds);
  return (
    <div className={styles.actions}>
      <button type="button" disabled={!payload?.canSend.ok || busy}
        onClick={() => void state.run()}
        title={payload && !payload.canSend.ok ? payload.canSend.reason : undefined}
        className={styles.actionButton}>
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
