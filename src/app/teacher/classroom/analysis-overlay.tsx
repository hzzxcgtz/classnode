'use client';

import { useWorksheetAnalysis, AnalysisActions, AnalysisBanners, AnalysisBody } from './analysis-panel';
// ★ 2026-09-30：页头那句题干里可能有数学公式（`$x^2$`）。
import { PromptText } from '@/lib/worksheet-prompt-text';
import styles from './analysis-overlay.module.css';

/**
 * 分析载荷的**居中浮窗**（★ M7a/M7b）。
 *
 * ★ 2026-09-28：**正文抽走了**（规格 `specs/2026-09-28-按题统计与分析.md` §6.2）。
 * 本文件现在只剩**外壳**：页头 + 三块（`AnalysisBanners` / `AnalysisBody` / `AnalysisActions`）。
 * 那三块同时被「按题统计浮层」里内联的「② 智能体解读」使用 —— **一个实现、两处宿主**。
 *
 * 正文、后台进度与重新分析动作由 `analysis-panel.tsx` 统一实现，避免两个宿主分叉。
 *
 * ⚠️ 搬走的时候行为**一个字都没改**（连注释一起搬的，理由都留在 `analysis-panel.tsx`）。
 */

export function AnalysisOverlay({
  classroomId,
  worksheetId,
  questionId,
  mode,
  zIndex = 270,
  onClose,
}: {
  /** 🔴 必填：同一份学习单可以被多个课堂引用，服务端不许猜（猜错就把别的班的数据给这个班看）。 */
  classroomId: string;
  worksheetId: string;
  questionId: string;
  /** 课堂 mode —— **只**用来定「已交 N/M」的单位（分组 / 高级模式下是「组」）。 */
  mode: string;
  /**
   * ★ 2026-09-28：默认 **270**（矩阵 250 之上、抽屉 291 之下 —— 它原来的位置）。
   * ⚠️ 它现在**只从矩阵那条路进**（按题统计浮层改成内联正文了，不再打开本浮层），
   * 所以这个参数**暂时没有调用方传值** —— 留着是因为它是一个正当的旋钮，
   * 而不是因为「现在有人用」。
   */
  zIndex?: number;
  onClose: () => void;
}) {
  const state = useWorksheetAnalysis(classroomId, worksheetId, questionId, mode);
  const { payload, busy } = state;

  return (
    <div data-overscroll-guard="" className={styles.backdrop} style={{ zIndex }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="analysis-dialog-title">
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
        borderBottom: '1px solid #e2e8f0', background: '#fff', flex: '0 0 auto',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div id="analysis-dialog-title" style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
            {payload ? `${payload.questionLabel} · ${payload.typeLabel}` : '分析载荷'}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {/* ★ 2026-09-30：题干认公式。⚠️ 三层：还没有载荷 / 载荷里题干为空 / 有题干。 */}
            {payload
              ? (payload.prompt ? <PromptText text={payload.prompt} placeholder="" /> : '（题干为空）')
              : '正在读取…'}
          </div>
        </div>
        {/* 🔴 分母必须显眼：载荷只覆盖一部分人，而一份没有分母的名单会被读成「全班就这些人」。 */}
        {payload && (
          <div style={{ fontSize: '0.85rem', color: '#0f172a', whiteSpace: 'nowrap' }}>
            已交 <b>{payload.covered}</b>/{payload.total} {state.unit}
          </div>
        )}
        <button type="button" onClick={onClose}
          title={busy ? '关闭后任务仍会在后台继续' : undefined}
          style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', color: '#334155' }}>
          {busy ? '关闭（后台继续）' : '关闭'}
        </button>
      </div>

      <AnalysisBanners state={state} />
      <AnalysisBody state={state} classroomId={classroomId} worksheetId={worksheetId} questionId={questionId} />

      <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', background: '#fff', flex: '0 0 auto' }}>
        <AnalysisActions state={state} />
      </div>
      </section>
    </div>
  );
}
