'use client';

import { useMemo } from 'react';
import { flattenAnswerable, questionTypeLabel } from '@/lib/worksheet-questions';
import { normalizeAnswerMode } from '@/lib/worksheet-answer-mode';
import type { WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';

/**
 * 「逐题开放」浮层（★ 2026-09-30，教师）。
 *
 * 教师原话：「题目开放方式有必要再增加一个：允许教师纯手工，可按顺序的，一个一个去开启
 * 每个小题的使用权限，在教师看板页面中，找一个合适的位置和方式，帮我呈现控制界面」。
 *
 * ── 它替教师做的事 ────────────────────────────────────────────────────────
 * 学习单设成「手动逐题开放」之后，**学生能看见哪几道题完全由这一屏决定**。
 * 所以这一屏的头号任务是：任何时候都能一眼看出「现在开到哪儿了」与「下一步按哪个」。
 *
 * ── 三条取舍 ──────────────────────────────────────────────────────────────
 *
 * ① **题号与顺序读 `flattenAnswerable`**，不自己排一遍 —— 那个函数同时喂着学生端的题号、
 *    看板列头、抽屉、导出与矩阵（「同一个数只有一处算」）。这里重排一次，教师看到的
 *    第 3 题就可能不是学生看到的第 3 题，而两边都不报错。
 *
 * ② **逐题开关、不是游标**（教师裁定）：存的是「已开放的题 id 集合」。所以教师可以跳着开
 *    （先开第 3 题）、也可以单独收回某一题 —— 中途插题/删题不会让已开的题错位。
 *    「开放下一题」那个主按钮只是**按顺序推**的快捷方式，不是唯一的路径。
 *
 * ③ **不改模式的单，也照常列出来**（但画成「非本档」）：高级模式下各组可能是不同的单，
 *    教师打开这一屏时得知道「哪几份受这一档管」——把不受管的整段藏掉，他会以为漏配了。
 *
 * ⚠️ 收回**不删**任何已交的答案：它只让学生看不见这一题（教师侧的统计照旧算它）。
 *    这一点必须写在屏幕上 —— 教师不然不敢按。
 */

export interface WorksheetOpenOverlayProps {
  /** 这一屏里有哪几份学习单（`useWorksheetBoard` 的 `nodesByWorksheet`）。 */
  worksheets: ReadonlyArray<{ id: string; title: string; nodes: WorksheetQuestionNode[]; settings?: WorksheetSettings }>;
  /** 每份单已开放的题 id（服务端下发的整张映射）。 */
  open: Record<string, string[]>;
  /**
   * 写一份单的开放清单（整份替换）。
   * ⚠️ 由调用方负责「乐观更新 + 失败回滚 + 提示」—— 这一屏只负责画与点。
   */
  onChange: (worksheetId: string, questionIds: string[]) => void;
  busy: boolean;
  onClose: () => void;
  zIndex?: number;
}

export function WorksheetOpenOverlay({
  worksheets, open, onChange, busy, onClose, zIndex = 260,
}: WorksheetOpenOverlayProps) {
  /**
   * 每份单的题列表 —— 只算一次（`flattenAnswerable` 会走整棵树）。
   * ⚠️ 依赖里放的是 `worksheets` 本身：它由调用方按 `nodesByWorksheet` 建，
   * 而那个对象只在题目树真的变了（60 秒节拍拉到新版）时才换。
   */
  const rows = useMemo(() => worksheets.map((sheet) => {
    const mode = normalizeAnswerMode(sheet.settings?.answerMode);
    return {
      ...sheet,
      mode,
      /** 只有这一档受本屏管。其它三档照常列出来，但画成「非本档」。 */
      managed: mode === 'manual',
      questions: flattenAnswerable(sheet.nodes),
      openIds: open[sheet.id] ?? [],
    };
  }), [worksheets, open]);

  /** 全部「受管」的题（按学习单顺序、每份单内按题目顺序）—— 「开放下一题」在这上面找。 */
  const totalManaged = rows.reduce((sum, row) => sum + (row.managed ? row.questions.length : 0), 0);
  const totalOpen = rows.reduce((sum, row) => sum + (row.managed ? row.openIds.length : 0), 0);

  return (
    /*
      ⚠️ 外壳走**本页（课堂进行页）自己的写法**：遮罩 + 居中卡片，全是行内样式。
      不借 `teacher-editor-dialog` 那一套：那群类明确写着「只给四个**管理页**用，
      避免改变课堂进行页等高频操作弹窗」（`globals.css` 那一节的注释）——
      在课堂上借它，改管理页的浮层语言会连带改到这一屏。
      ⚠️ `zIndex` 默认 260：与矩阵 250 / 分析 270 同一档（学习单抽屉是 290/291）。
      ⚠️ 遮罩那一层挂 `data-overscroll-guard`：滚轮落在卡片外时别把看板带着滚
      （判据在 `@/lib/overscroll-guard`）。
    */
    <>
      <div
        data-overscroll-guard=""
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex, overflow: 'hidden',
          background: 'rgba(15, 23, 42, 0.42)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(3px)',
          overscrollBehavior: 'contain',
        }}
      >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="worksheet-open-title"
        data-overscroll-guard=""
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 620, maxWidth: '92vw', maxHeight: '86vh',
          display: 'flex', flexDirection: 'column',
          background: '#fff', borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(15, 23, 42, 0.24)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id="worksheet-open-title" style={{ margin: 0 }}>逐题开放</h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
              开一题，全班立刻能看见并作答；收回只是让学生看不见，已交的答案不会丢。
            </p>
          </div>
          {/* 🔴 分母与分子都要写出来：一份没有分母的进度会被读成「就这些题」。 */}
          <span style={{ flex: '0 0 auto', fontSize: '0.813rem', fontWeight: 700, color: '#0f172a' }}>
            已开放 {totalOpen} / {totalManaged}
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>关闭</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px 18px', background: '#f8fafc', overscrollBehavior: 'contain' }}>
          {rows.length === 0 ? (
            <p style={{ margin: 0, padding: '32px 0', textAlign: 'center', color: '#64748b' }}>
              这间课堂还没有学习单。
            </p>
          ) : rows.map((row) => {
            const nextQuestion = row.questions.find(({ node }) => !row.openIds.includes(node.id));
            return (
              <section key={row.id} style={{ marginBottom: 14, padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <strong style={{ fontSize: '0.875rem', color: '#172033' }}>{row.title}</strong>
                  {row.managed ? (
                    <>
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>已开放 {row.openIds.length} / {row.questions.length}</span>
                      {/*
                        主按钮 = 「第一道还没开放的题」。按顺序推是这一档的常见用法，
                        所以把它做成一等公民；跳着开仍然由下面每一行的小按钮承担。
                        ⚠️ 全开完了就**不画**这个按钮（画一个按下去没反应的按钮比没有更糟）。
                      */}
                      {nextQuestion && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busy}
                          style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: '0.75rem' }}
                          title={`开放「${nextQuestion.heading}」`}
                          onClick={() => onChange(row.id, [...row.openIds, nextQuestion.node.id])}
                        >
                          开放下一题（{nextQuestion.heading}）
                        </button>
                      )}
                      {!nextQuestion && row.questions.length > 0 && (
                        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#3f7859', fontWeight: 700 }}>已全部开放</span>
                      )}
                    </>
                  ) : (
                    <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#956834' }}>
                      这张单是「{ANSWER_MODE_LABEL[row.mode]}」，不受这里控制
                    </span>
                  )}
                </div>

                {row.questions.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8' }}>这张单还没有可作答的题。</p>
                ) : (
                  <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {row.questions.map(({ node, heading }) => {
                      const isOpen = row.openIds.includes(node.id);
                      return (
                        <li key={node.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 10px', borderRadius: 8,
                          background: isOpen ? '#f2f5f8' : '#fff',
                          border: `1px solid ${isOpen ? '#c8d5e3' : '#e2e8f0'}`,
                        }}>
                          <span style={{ flex: '0 0 auto', minWidth: 40, fontSize: '0.72rem', fontWeight: 700, color: '#64748b' }}>{heading}</span>
                          <span style={{ flex: '0 0 auto', fontSize: '0.688rem', color: '#94a3b8' }}>{questionTypeLabel(node.type)}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: '0.813rem', color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {node.prompt.trim() || '（题干为空）'}
                          </span>
                          {isOpen ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={busy || !row.managed}
                              style={{ flex: '0 0 auto', padding: '3px 10px', fontSize: '0.72rem' }}
                              title="收回这一题（学生将看不到它，已交的答案不会丢）"
                              onClick={() => onChange(row.id, row.openIds.filter((id) => id !== node.id))}
                            >
                              收回
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={busy || !row.managed}
                              style={{ flex: '0 0 auto', padding: '3px 10px', fontSize: '0.72rem' }}
                              title={row.managed ? '开放这一题' : '这张单不是「手动逐题开放」，开放也不会生效'}
                              onClick={() => onChange(row.id, [...row.openIds, node.id])}
                            >
                              开放
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      </div>
      </div>
    </>
  );
}

/** 四档在**教师这一屏**里的说法（与学生端设置面板的用词一致）。 */
const ANSWER_MODE_LABEL: Record<string, string> = {
  open: '开放式',
  'task-step': '按任务分步',
  'question-step': '按小题分步',
  manual: '手动逐题开放',
};
