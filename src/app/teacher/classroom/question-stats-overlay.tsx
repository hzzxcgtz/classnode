'use client';

import { useMemo } from 'react';
import type { WorksheetBoard, WorksheetQuestionNode } from '@/lib/types';
import { indexQuestions } from './worksheet-drawer-state';
import { QuestionAnswers } from './worksheet-drawer';
import { StackedBar } from './question-stacked-bar';
import { questionStats, type MatrixCell, type StatsRow } from './worksheet-question-stats';

/**
 * 「按题统计与分析」的浮层（规格 `specs/2026-09-28-按题统计与分析.md`）。
 *
 * ⚠️ **本文件只画，判据全在 `worksheet-question-stats.ts`**（纯函数、有测试）——
 * 本仓没有前端测试框架，画进 JSX 的判据没有任何回归网。
 *
 * ── 层级（规格 §1.2，会打架，先说清）────────────────────────────────
 * 矩阵 250 · 分析 270 · 抽屉 290/**291** · **本浮层 292**。
 * 本浮层画在抽屉**之上**，因为它是从抽屉里点开的；关闭它回到题列表，教师不丢位置。
 *
 * ── 三块（规格 §6）──────────────────────────────────────────────────
 *   ① 本题统计（本批新增）
 *   ② 智能体解读 ← **打开已有的分析浮层**（裁决：见下面 `onOpenAnalysis` 那段注释）
 *   ③ 逐个作答 ← **复用抽屉第三层那个组件**（不另写一份呈现）
 */

const OK = '#15803d';
const BAD = '#dc2626';
const WARN = '#b45309';
const BLUE = '#1d4ed8';
const MUTED = '#64748b';
const FAINT = '#94a3b8';

/** 一根横条。🔴 **数字一律写出来**（颜色不承载唯一信息，规格 §5）。 */
function Bars({ bars, unit, color = BLUE }: { bars: Array<{ label: string; count: number; correct?: boolean }>; unit: string; color?: string }) {
  const max = Math.max(1, ...bars.map((bar) => bar.count));
  if (bars.length === 0) return <div style={{ fontSize: '0.75rem', color: FAINT }}>（没有数据）</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {bars.map((bar) => (
        <div key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem' }}>
          <span style={{ flex: '0 0 42%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#0f172a' }}>
            {bar.label}
          </span>
          <span style={{ flex: 1, height: 12, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${(bar.count / max) * 100}%`, height: '100%', background: bar.correct ? OK : color }} />
          </span>
          <span style={{ flex: '0 0 auto', color: bar.count > 0 ? '#0f172a' : FAINT, fontWeight: 600 }}>
            {bar.count} {unit}
          </span>
          {bar.correct && <span style={{ flex: '0 0 auto', fontSize: '0.625rem', color: OK }}>答案</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * 矩阵热力（连线左×右、归类条目×框）。
 *
 * 🔴 **每一格都写数字**（规格 §5 的第二条纪律）：只靠深浅，教师读不出「到底是 3 人还是 30 人」，
 * 而色觉障碍的教师连深浅都可能分不出。正确的那一格另加一个边框。
 */
function Matrix({ rowLabel, colLabel, rows, cols, cells }: {
  rowLabel: string;
  colLabel: string;
  rows: Array<{ id: string; text: string }>;
  cols: Array<{ id: string; text: string }>;
  cells: MatrixCell[];
}) {
  if (rows.length === 0 || cols.length === 0) return <div style={{ fontSize: '0.75rem', color: FAINT }}>（没有数据）</div>;
  const max = Math.max(1, ...cells.map((cell) => cell.count));
  const at = (rowId: string, colId: string) => cells.filter((cell) => cell.rowId === rowId && cell.colId === colId)[0];
  const shade = (count: number) => (count === 0 ? 'transparent' : `rgba(37, 99, 235, ${(0.12 + (count / max) * 0.55).toFixed(2)})`);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.75rem' }}>
        <thead>
          <tr>
            <th style={{ padding: '3px 6px', color: MUTED, fontWeight: 500, textAlign: 'left' }}>{rowLabel} \ {colLabel}</th>
            {cols.map((col) => (
              <th key={col.id} title={col.text} style={{ padding: '3px 6px', color: MUTED, fontWeight: 500, maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {col.text || col.id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th title={row.text} style={{ padding: '3px 6px', color: '#0f172a', fontWeight: 500, textAlign: 'left', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.text || row.id}
              </th>
              {cols.map((col) => {
                const cell = at(row.id, col.id);
                const count = cell?.count ?? 0;
                return (
                  <td key={col.id} title={`${row.text || row.id} → ${col.text || col.id}：${count} 人`}
                    style={{
                      padding: '3px 6px', textAlign: 'center', background: shade(count),
                      color: count > 0 ? '#0f172a' : FAINT, fontWeight: count > 0 ? 600 : 400,
                      // 正确答案那一格加一个边框 —— **不靠颜色**（颜色已经用在人数深浅上了）。
                      outline: cell?.correct ? `2px solid ${OK}` : undefined, outlineOffset: -2,
                    }}>
                    {count || '·'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 一行小标题。 */
function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h4 style={{ margin: 0, fontSize: '0.813rem', fontWeight: 700, color: '#0f172a' }}>
        {title}
        {note && <span style={{ marginLeft: 8, fontSize: '0.688rem', fontWeight: 400, color: MUTED }}>{note}</span>}
      </h4>
      {children}
    </section>
  );
}

export function QuestionStatsOverlay({
  mode, board, worksheetId, questionId, nodesByWorksheet, onClose, onOpenAnalysis, onOpenParticipant,
}: {
  /** 课堂 mode —— 只在量词上用（分组 / 高级模式下「人」要写成「组」），与旁边两屏同源。 */
  mode: string;
  board: WorksheetBoard | null;
  worksheetId: string;
  questionId: string;
  nodesByWorksheet: Record<string, WorksheetQuestionNode[]>;
  onClose: () => void;
  /** ② 智能体解读：**打开已有的分析浮层**（见下面那段注释）。 */
  onOpenAnalysis: () => void;
  /** 点某个学生的名字 ⇒ 跳到他那一题（由调用方先关本浮层再开抽屉）。 */
  onOpenParticipant: (participantId: string) => void;
}) {
  const worksheet = board?.worksheets.filter((item) => item.id === worksheetId)[0];
  const nodes = nodesByWorksheet[worksheetId] ?? null;
  const node = nodes ? indexQuestions(nodes).byId.get(questionId) ?? null : null;
  const heading = nodes ? indexQuestions(nodes).headingOf(questionId) : null;

  const stats = useMemo(() => {
    if (!node || !worksheet) return null;
    // 🔴 每个参与者**占一格**（没作答的是 `undefined`）—— 分母是参与者数，
    // 把没作答的人过滤掉会让「已交 N/M」凭空满员（与 `questionAggregate` 同一条纪律）。
    const rows: Array<StatsRow | undefined> = worksheet.participants.map((participant) => {
      const row = participant.answerRows.filter((item) => item.questionId === questionId)[0];
      if (!row) return undefined;
      return {
        participantId: participant.participantId,
        // 小组 / 高级模式下这里是**一个组一行参与者** —— 取组名，`student.name` 会是 undefined。
        participantName: participant.name,
        status: row.status,
        isCorrect: row.isCorrect,
        gradeState: row.gradeState,
        value: row.value,
        createdAt: row.createdAt,
        savedAt: row.savedAt,
        saveCount: row.saveCount,
      };
    });
    return questionStats(node, rows);
  }, [node, worksheet, questionId]);

  const unit = mode === 'group' || mode === 'advanced' ? '组' : '人';
  const distribution = stats?.distribution ?? null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 292, background: 'rgba(0,0,0,0.16)' }} />
      <div style={{
        position: 'fixed', top: 48, bottom: 32, left: '50%', transform: 'translateX(-50%)',
        width: 'min(860px, calc(100vw - 48px))', zIndex: 293,
        background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 12px 40px rgba(0,0,0,0.16)',
      }}>
        {/* 页头 */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg, #f8faff, #f0f4ff)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, flex: 1, fontSize: '1rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node ? `${heading ? `${heading} · ` : ''}${node.type}` : '按题统计'}
            </h3>
            <button type="button" className="btn btn-ghost" onClick={onClose} style={{ fontSize: '0.688rem', padding: '4px 10px' }}>关闭</button>
          </div>
          {stats && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6, fontSize: '0.75rem', color: MUTED, flexWrap: 'wrap' }}>
              <span>{stats.total} {unit}</span>
              <span>已交 <b style={{ color: '#0f172a' }}>{stats.submitted}</b></span>
              <span>全对 <b style={{ color: OK }}>{stats.correct}</b></span>
              <span>部分 <b style={{ color: WARN }}>{stats.partial}</b></span>
              <span>错 <b style={{ color: BAD }}>{stats.wrong}</b></span>
              {/* ⚠️ 正确率是 `null` 时显示「—」而**不是 0%** —— 0% 是一句假话（没有判过的行）。 */}
              <span style={{ marginLeft: 'auto' }}>正确率 <b style={{ color: BLUE }}>{stats.accuracy === null ? '—' : `${stats.accuracy}%`}</b></span>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!node && <div style={{ color: FAINT, fontSize: '0.813rem' }}>这一题的内容还没加载到。</div>}

          {stats && (
            <>
              <StackedBar stats={stats} />

              {/* ① 本题统计 —— 图 + 文字说明（判据全在纯层） */}
              <Section title="本题统计">
                {distribution === null && (
                  <div style={{ fontSize: '0.75rem', color: FAINT }}>
                    这一题没有可统计的分布（或者库里同时有几种作答形状 —— 教师改过题型）。
                  </div>
                )}
                {distribution?.kind === 'options' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Bars bars={distribution.bars} unit={unit} />
                    {distribution.combos.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.688rem', color: MUTED, marginBottom: 4 }}>选答组合（前 3）</div>
                        <Bars bars={distribution.combos} unit={unit} color={MUTED} />
                      </div>
                    )}
                  </div>
                )}
                {distribution?.kind === 'blanks' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {distribution.blanks.map((blank) => (
                      <div key={blank.label}>
                        <div style={{ fontSize: '0.688rem', color: MUTED, marginBottom: 4 }}>
                          {blank.label}
                          {blank.distinct > 0 && <span style={{ marginLeft: 6 }}>共 {blank.distinct} 种写法</span>}
                        </div>
                        <Bars bars={blank.bars} unit={unit} />
                      </div>
                    ))}
                  </div>
                )}
                {distribution?.kind === 'order' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* 「有几位排对了」：**计数**，不是判分结论（判分那件事由页头那四格说）。 */}
                    <Bars
                      bars={distribution.positions.map((position) => ({ label: `第 ${position.index + 1} 位`, count: position.hits }))}
                      unit={unit}
                    />
                    {distribution.topOrders.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.688rem', color: MUTED, marginBottom: 4 }}>出现最多的顺序（前 3）</div>
                        <Bars bars={distribution.topOrders} unit={unit} color={MUTED} />
                      </div>
                    )}
                  </div>
                )}
                {distribution?.kind === 'match' && (
                  <Matrix rowLabel="左栏" colLabel="右栏" rows={distribution.left} cols={distribution.right} cells={distribution.cells} />
                )}
                {distribution?.kind === 'categorize' && (
                  <Matrix rowLabel="条目" colLabel="框" rows={distribution.items} cols={distribution.zones} cells={distribution.cells} />
                )}
                {distribution?.kind === 'text' && <Bars bars={distribution.lengths} unit={unit} />}
                {distribution?.kind === 'ink' && (
                  <div style={{ fontSize: '0.75rem', color: MUTED }}>
                    {distribution.drawn} {unit}交了这一题（笔迹的图见下面「逐个作答」）。
                  </div>
                )}
              </Section>

              {/* 文字说明。🔴 只陈述算得出来的事实（判据层的硬线） */}
              {stats.insights.length > 0 && (
                <Section title="说明">
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {stats.insights.map((insight, index) => (
                      <li key={index} style={{
                        fontSize: '0.813rem',
                        color: insight.level === 'warn' ? WARN : insight.level === 'good' ? OK : '#0f172a',
                      }}>
                        {insight.text}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* 过程统计（★ 教师批准保留）。⚠️ 三列都是 NULL 的旧行**不进样本** ⇒ 那时整段是「—」。 */}
              <Section title="作答过程" note="旧数据没有这一项，显示「—」">
                <div style={{ display: 'flex', gap: 20, fontSize: '0.813rem', color: '#0f172a' }}>
                  <span>用时中位数 <b>{stats.process.medianMs === null ? '—' : `${Math.round(stats.process.medianMs / 1000)} 秒`}</b></span>
                  <span>修改次数中位数 <b>{stats.process.medianSaves === null ? '—' : `${stats.process.medianSaves} 次`}</b></span>
                  <span>还没交 <b>{stats.process.notSubmitted.length}</b> {unit}</span>
                </div>
                {stats.process.notSubmitted.length > 0 && (
                  <div style={{ fontSize: '0.75rem', color: MUTED, marginTop: 4 }}>
                    {stats.process.notSubmitted.join('、')}
                  </div>
                )}
              </Section>
            </>
          )}

          {/* ② 智能体解读 —— 打开已有的分析浮层（zIndex 由调用方抬高到本浮层之上）。
              ⚠️ 规格 §6.2 原本要求把分析正文抽成一个块**内联**在这里；本批**没做**：
              那要重构 `analysis-overlay.tsx`（它身上还有「发之前先给教师确认」那套隐私闸门），
              而我**没有逐行读过它**（规格 §11 已把这条列为没核过）。
              先接线 —— 教师点得到、看得到结果；内联留作下一步。 */}
          <Section title="智能体解读" note="问答 / 绘图题交给智能体分析">
            <button type="button" className="btn btn-secondary" onClick={onOpenAnalysis}
              style={{ alignSelf: 'flex-start', fontSize: '0.813rem', padding: '6px 12px' }}>
              打开分析
            </button>
          </Section>

          {/* ③ 逐个作答 —— **复用抽屉第三层那个组件**，不另写一份呈现 */}
          {board && node && (
            <Section title="逐个作答">
              <QuestionAnswers
                board={board}
                worksheetId={worksheetId}
                questionId={questionId}
                nodes={nodes}
                onOpenParticipant={onOpenParticipant}
              />
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
