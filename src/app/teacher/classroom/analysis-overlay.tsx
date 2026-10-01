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
 * 题目统计与矩阵分析都通过这里查看结果，避免出现两套内容结构与交互。
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
   * 矩阵与按题统计两条入口都会打开本浮层；参数保留给上层覆盖关系的明确调节。
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
      <div className={styles.header}>
        <div className={styles.heading}>
          <div className={styles.eyebrow}>AI 分析</div>
          <div id="analysis-dialog-title" className={styles.title}>
            {payload ? `${payload.questionLabel} · ${payload.typeLabel}` : '正在读取题目信息'}
          </div>
          <div className={styles.prompt}>
            {/* ★ 2026-09-30：题干认公式。⚠️ 三层：还没有载荷 / 载荷里题干为空 / 有题干。 */}
            {payload
              ? (payload.prompt ? <PromptText text={payload.prompt} placeholder="" /> : '（题干为空）')
              : '正在读取…'}
          </div>
        </div>
        {/* 🔴 分母必须显眼：载荷只覆盖一部分人，而一份没有分母的名单会被读成「全班就这些人」。 */}
        {payload && (
          <div className={styles.count}>已交 <b>{payload.covered}</b>/{payload.total} {state.unit}</div>
        )}
        <button type="button" onClick={onClose}
          title={busy ? '关闭后任务仍会在后台继续' : undefined}
          className={styles.closeButton}>
          {busy ? '关闭（后台继续）' : '关闭'}
        </button>
      </div>

      <AnalysisBanners state={state} />
      <AnalysisBody state={state} classroomId={classroomId} worksheetId={worksheetId} questionId={questionId} />

      <div className={styles.footer}>
        <AnalysisActions state={state} />
      </div>
      </section>
    </div>
  );
}
