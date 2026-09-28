'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isNotFound } from '@/lib/http-error';
import type { WorksheetAnalysisPayload } from '@/lib/types';
import { moduleCountUnit } from './worksheet-tile-state';
// ★ M7b：预览那几行住在**纯模块**里（它是隐私闸门的实质文本，必须有测试）
import { analysisPreviewLines } from './analysis-preview';

/**
 * 「智能体解读」的**取数 + 呈现**，抽出来给**两处**用（★ 2026-09-28，规格 §6.2）。
 *
 * 🔴 **为什么要抽**（不是洁癖）：
 *   · 它今天有两个宿主 —— 整屏的 `AnalysisOverlay`（从矩阵那条路进）与
 *     **按题统计浮层**里那块内联的「② 智能体解读」；
 *   · 同一个 `narrative` 若在两处各画一份，迟早会长得不一样 —— 那是这类功能的经典分叉，
 *     而**两边都不报错**；
 *   · 更硬的一条是**隐私闸门**：「发给 AI 分析」之前必须先给教师看一遍「本次将发什么」
 *     （M7b 的裁定 3）。那份预览是承重文本，**绝不允许有第二个宿主自己拼一份**。
 *
 * ⚠️ **这里的代码是从 `analysis-overlay.tsx` 原样搬过来的**（连注释一起）——
 * 搬的时候行为**一个字都没改**，理由逐条都留在原处。
 */

export interface WorksheetAnalysisState {
  payload: WorksheetAnalysisPayload | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** 联系表的图没取回来（服务端缺 sharp 时回 503）。没有它，界面上只有一个**坏图**。 */
  sheetFailed: boolean;
  /** 正在让教师确认「本次将发什么」（裁定 3：发之前必须看见）。 */
  confirming: boolean;
  setConfirming: (next: boolean) => void;
  markSheetFailed: () => void;
  /** 「重新生成」= **全在本机**（重渲 + 重新聚合），不外发。 */
  regenerate: () => Promise<void>;
  /** 「确认发送」——**唯一**外发的那一步（只在确认块里被调）。 */
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetFailed, setSheetFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

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

  const regenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setPayload(await api.computeWorksheetAnalysis(classroomId, worksheetId, questionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(false);
    }
  }, [classroomId, worksheetId, questionId]);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.runWorksheetAnalysis(classroomId, worksheetId, questionId);
      // 只把那三格合进去（`aggregate`/`covered` 那些是载荷那一侧，这次一个都没动）
      setPayload((prev) => (prev ? { ...prev, ...out } : prev));
      setConfirming(false);
    } catch (e) {
      // 🔴 失败**不动 payload.narrative** —— 已有的解读必须原样留在屏幕上
      // （服务端也没写库；两边都不动，才叫「失败不丢东西」）。
      setError(e instanceof Error ? e.message : '分析失败');
    } finally {
      setBusy(false);
    }
  }, [classroomId, worksheetId, questionId]);

  return {
    payload, loading, busy, error, sheetFailed, confirming,
    setConfirming,
    markSheetFailed: useCallback(() => setSheetFailed(true), []),
    regenerate, run,
    unit: moduleCountUnit(mode),
  };
}

/** 确认块要用的那几行（★ 隐私闸门的实质文本）。 */
export function analysisPreviewFor(state: WorksheetAnalysisState, payload: WorksheetAnalysisPayload): string[] {
  // ⚠️ 调用方已经判过 `payload.analysisAgent` 在场；这一句只是**让类型收窄**。
  // 返回空数组（而不是编一行）—— 没有智能体时那份预览本来就没有内容可说。
  const agent = payload.analysisAgent;
  if (!agent) return [];
  return analysisPreviewLines({
    agentName: agent.name,
    platform: agent.platform,
    sendable: {
      covered: payload.covered, total: payload.total, payloadKind: payload.payloadKind,
      sheetCount: payload.sheetLayouts.length,
      columns: payload.knobs.columns, cellWidth: payload.knobs.cellWidth, cellHeight: payload.knobs.cellHeight,
    },
    unit: state.unit,
    blockedReason: payload.canSend.ok ? null : payload.canSend.reason,
  });
}

/** 状态条那两行（过期警告 / 错误）。两处宿主共用。 */
export function AnalysisBanners({ state }: { state: WorksheetAnalysisState }) {
  return (
    <>
      {/* 「算完之后又有人交了」—— 服务端算的，必须显眼。否则教师会把一份不完整的名单当成当前的。 */}
      {state.payload?.stale && (
        <div style={{ padding: '8px 18px', background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#92400e', fontSize: '0.82rem', flex: '0 0 auto' }}>
          ⚠️ 有新的作答，结果可能已过期 —— 点「重新生成」以纳入。
        </div>
      )}
      {state.error && (
        <div role="alert" style={{ padding: '8px 18px', background: '#fef2f2', borderBottom: '1px solid #fca5a5', color: '#b91c1c', fontSize: '0.82rem', flex: '0 0 auto' }}>
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
  const { payload, loading, busy, confirming, sheetFailed } = state;
  const sheets = payload?.sheetLayouts ?? [];
  const previewLines = payload && payload.analysisAgent ? analysisPreviewFor(state, payload) : [];

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
      {loading && <div style={{ color: '#64748b' }}>正在读取…</div>}

      {!loading && payload && payload.covered === 0 && (
        // 零份已提交是教师最可能踩的一步（全班还没交就点开了）——说清楚，别给一张空图。
        <div style={{ color: '#64748b' }}>这道题还没有已提交的作答。</div>
      )}

      {!loading && payload && payload.payloadKind === 'mixed' && (
        <div style={{ marginBottom: 12, color: '#92400e', fontSize: '0.82rem' }}>
          ⚠️ 本题有两种作答方式（部分文字、部分笔迹）—— 下面文档与联系表各是一部分。
        </div>
      )}

      {!loading && payload?.text !== null && payload?.text !== undefined && payload.text !== '' && (
        <pre style={{
          margin: '0 0 18px', padding: 14, background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontSize: '0.85rem', lineHeight: 1.7, color: '#0f172a', fontFamily: 'inherit',
        }}>{payload.text}</pre>
      )}

      {!loading && payload && sheets.length > 0 && (
        <>
          {payload.labeled === false && (
            // 缺 fontconfig 时图上**没有**标签 —— 必须说清，并给出编号对照，否则认不出哪格是谁。
            <div style={{ marginBottom: 10, color: '#92400e', fontSize: '0.82rem' }}>
              ⚠️ 这张图上**没有标签**（本机渲染不出文字）—— 请按下面的编号对照表：
            </div>
          )}
          {sheets.map((sheet) => (
            <div key={sheet.sheetIndex} style={{ marginBottom: 16 }}>
              {sheets.length > 1 && (
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>
                  第 {sheet.sheetIndex + 1} 张 / 共 {sheets.length} 张
                </div>
              )}
              <img
                src={api.worksheetAnalysisSheetUrl(classroomId, worksheetId, questionId, sheet.sheetIndex)}
                alt={`${payload.questionLabel} 的联系表（第 ${sheet.sheetIndex + 1} 张）`}
                // ★ 取不回来时**说一句**（服务端缺 sharp 的能力时回 503）——
                // 没有它，界面上只有一个坏图，而教师不知道是「坏了」还是「本来就空」。
                onError={state.markSheetFailed}
                style={{ maxWidth: '100%', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' }}
              />
            </div>
          ))}
          {sheetFailed && (
            <div role="alert" style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: '0.82rem' }}>
              ⚠️ 联系表**画不出来**（本机没有图片渲染能力，服务端回了 503）—— 文字那部分若存在仍然可读。
            </div>
          )}
          {/* ★ 2026-09-29：对照表**一直显示**（原来只在图上没有标签时才显示），
              而且带上**真名** —— 教师拿它对着那张图看「第几格是谁」。
              🔴 真名只画在**这一屏**上（`nameOf` 由调用方从名册解析，是本机数据）；
              发给 AI 的仍然是伪名，一个字没变。 */}
          <ol style={{ margin: '0 0 18px', padding: '10px 12px 10px 28px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: '0.82rem', color: '#334155' }}>
            {payload.entries.map((entry, index) => {
              const real = nameOf ? nameOf(entry.studentId) : null;
              return (
                <li key={entry.studentId}>
                  <b>{entry.anonLabel}</b>
                  {real ? <> · <b style={{ color: '#0f172a' }}>{real}</b></> : null}
                  {' '}· 第 {index + 1} 格
                </li>
              );
            })}
          </ol>
        </>
      )}

      {/* ★ M7b：解读显示在文档/图**之后**，视觉上与它们分开 —— AI 写的东西不该看起来
          像学生写的。 */}
      {!loading && payload?.narrative && (
        <div style={{ margin: '0 0 18px', padding: 14, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10 }}>
          <div style={{ fontSize: '0.8rem', color: '#0369a1', marginBottom: 6 }}>
            AI 解读{payload.model ? `（${payload.model}）` : ''}
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85rem', lineHeight: 1.7, fontFamily: 'inherit', color: '#0f172a' }}>
            {payload.narrative}
          </pre>
        </div>
      )}

      {/* ★ M7b：确认块（**一个块**，不是新浮层）。 */}
      {confirming && (
        <div style={{ margin: '0 0 12px', padding: 12, border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 10 }}>
          <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 6 }}>即将把下面这些发给第三方 AI：</div>
          <ul style={{ margin: '0 0 10px', paddingLeft: 20, fontSize: '0.82rem', color: '#78350f', lineHeight: 1.9 }}>
            {previewLines.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <button type="button" onClick={() => void state.run()} disabled={busy}
            style={{ border: '1px solid #b45309', background: '#fff', borderRadius: 10, padding: '6px 16px', cursor: busy ? 'default' : 'pointer', color: '#92400e', opacity: busy ? 0.5 : 1 }}>
            {busy ? '发送中…' : '确认发送'}
          </button>
          <button type="button" onClick={() => state.setConfirming(false)} disabled={busy}
            style={{ marginLeft: 8, border: '1px solid #cbd5e1', background: '#fff', borderRadius: 10, padding: '6px 16px', cursor: busy ? 'default' : 'pointer', color: '#334155' }}>
            取消
          </button>
        </div>
      )}
    </div>
  );
}

/** 底部那两个按钮（重新生成 / 发给 AI 分析 + 不可点时的原因）。 */
export function AnalysisActions({ state }: { state: WorksheetAnalysisState }) {
  const { payload, busy, confirming } = state;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #e2e8f0', flex: '0 0 auto' }}>
      {/* 「重新生成」= **全在本机**（重渲 + 重新聚合）；「发给 AI 分析」才是外发的那一步，
          而它必须先过上面那个确认块。 */}
      <button type="button" onClick={() => void state.regenerate()} disabled={busy}
        style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 10, padding: '8px 16px', cursor: busy ? 'default' : 'pointer', color: '#334155', opacity: busy ? 0.5 : 1 }}>
        {busy ? '生成中…' : '重新生成'}
      </button>
      {/* ★ M7b：这个按钮**活了** —— 但点它只打开预览，**确认之后**才真的发出去
          （用户裁定 3）。`canSend.ok` 与那句话都是**服务端**给的判断。 */}
      <button type="button" disabled={!payload?.canSend.ok || busy}
        onClick={() => state.setConfirming(true)}
        title={payload && !payload.canSend.ok ? payload.canSend.reason : undefined}
        style={{
          border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 16px',
          cursor: payload?.canSend.ok ? 'pointer' : 'not-allowed',
          background: payload?.canSend.ok ? '#fff' : '#f1f5f9',
          color: payload?.canSend.ok ? '#334155' : '#94a3b8',
        }}>
        发给 AI 分析
      </button>
      {/* 不可点时必须**说出来为什么** —— 只灰掉一个按钮，教师不知道该去哪儿修 */}
      {payload && !payload.canSend.ok && (
        <span style={{ fontSize: '0.78rem', color: '#b45309' }}>{payload.canSend.reason}</span>
      )}
      {payload?.canSend.ok && !confirming && (
        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
          点它会先给你看一遍「本次将发什么」
        </span>
      )}
    </div>
  );
}
