'use client';

import { useMemo, useState } from 'react';
import type { WorksheetBoard, WorksheetQuestionNode } from '@/lib/types';
import { WorksheetStatusIcon } from '@/components/worksheet-status-icon';
// ★ 2026-09-30：矩阵表头是**连线右项 / 归类框名**（教师原文）⇒ 认公式。
import { PromptText } from '@/lib/worksheet-prompt-text';
import { indexQuestions } from './worksheet-drawer-state';
import { AnswerViewBody } from './answer-view';
import { CHART, CountBars, HeatLegend, VerdictDonut } from './question-stats-charts';
import { StackedBar } from './question-stacked-bar';
import { questionStats, showsAgentAnalysis, type MatrixCell, type StatsRow } from './worksheet-question-stats';
import { questionTypeNickname } from '@/lib/worksheet-questions';
import styles from './question-stats-overlay.module.css';

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
 *   ② AI 分析 ← **打开统一的分析结果浮层**（裁决：见下面 `onOpenAnalysis` 那段注释）
 *   ③ 逐个作答 ← **复用抽屉第三层那个组件**（不另写一份呈现）
 */

const OK = '#15803d';
const BAD = '#934e4e';
const WARN = '#b45309';
const MUTED = '#64748b';
const FAINT = '#94a3b8';

function pickedStatusView(row: { status?: string; gradeState?: string | null } | undefined) {
  if (row?.status === 'submitted') {
    if (row.gradeState === 'correct') return { icon: 'correct', label: '答对' } as const;
    if (row.gradeState === 'partial') return { icon: 'partial', label: '部分给分' } as const;
    if (row.gradeState === 'incorrect') return { icon: 'retry', label: '答错' } as const;
    return { icon: 'submitted', label: '已提交' } as const;
  }
  return row?.status === 'draft'
    ? { icon: 'drafting', label: '作答中' } as const
    : { icon: 'unanswered', label: '未作答' } as const;
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
  if (rows.length === 0 || cols.length === 0) {
    return <div style={{ fontSize: '0.813rem', color: CHART.faint }}>这一题还没有人作答，所以没有分布可看。</div>;
  }
  const max = Math.max(1, ...cells.map((cell) => cell.count));
  const at = (rowId: string, colId: string) => cells.filter((cell) => cell.rowId === rowId && cell.colId === colId)[0];
  const shade = (count: number) => (count === 0 ? '#f8fafc' : `rgba(var(--primary-focus-rgb), ${(0.10 + (count / max) * 0.62).toFixed(2)})`);
  // ★ 行列合计（展示用）：教师要看的是「**这一条左项**有 12 人连错」，
  // 而不是逐个格子去加 —— 那是这张图最重要的一栏，而裸表里没有。
  const rowTotal = (rowId: string) => cells.filter((cell) => cell.rowId === rowId).reduce((sum, cell) => sum + cell.count, 0);
  const colTotal = (colId: string) => cells.filter((cell) => cell.colId === colId).reduce((sum, cell) => sum + cell.count, 0);
  const th: React.CSSProperties = { padding: '6px 10px', fontSize: '0.75rem', fontWeight: 500, color: CHART.muted };
  const totalStyle: React.CSSProperties = { ...th, fontWeight: 700, color: CHART.ink, textAlign: 'center' };
  return (
    <div style={{ overflowX: 'auto' }}>
      {/* 圆角格 + 2px 间隙（**不画网格线**）：表格线是数据录入的长相，间隙才是热力图的长相。 */}
      <table style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: '0.813rem' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>{rowLabel} ＼ {colLabel}</th>
            {cols.map((col) => (
              <th key={col.id} title={col.text} style={{ ...th, maxWidth: 108, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {/* ★ 2026-09-30：`col.text` 是**教师原文**（`col.id` 那条回落路是机器的）。 */}
                {col.text ? <PromptText text={col.text} placeholder="" /> : col.id}
              </th>
            ))}
            <th style={{ ...th, color: CHART.faint }}>合计</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th title={row.text} style={{ ...th, textAlign: 'left', maxWidth: 132, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: CHART.ink }}>
                {/* ★ 2026-09-30：同列头（`row.text` 是教师原文）。 */}
                {row.text ? <PromptText text={row.text} placeholder="" /> : row.id}
              </th>
              {cols.map((col) => {
                const cell = at(row.id, col.id);
                const count = cell?.count ?? 0;
                return (
                  <td key={col.id} title={`${row.text || row.id} → ${col.text || col.id}：${count} 人`}
                    style={{
                      padding: '7px 10px', textAlign: 'center', borderRadius: 6, background: shade(count),
                      color: count > 0 ? CHART.ink : CHART.faint, fontWeight: count > 0 ? 700 : 400,
                      // 正确答案那一格加**绿框**（不靠深浅 —— 深浅已经用在人数上了）。
                      boxShadow: cell?.correct ? `inset 0 0 0 2px ${CHART.correct}` : undefined,
                    }}>
                    {count || '·'}
                  </td>
                );
              })}
              <td style={{ ...totalStyle, background: '#f1f5f9', borderRadius: 6 }}>{rowTotal(row.id)}</td>
            </tr>
          ))}
          <tr>
            <th style={{ ...th, textAlign: 'left', color: CHART.faint }}>合计</th>
            {cols.map((col) => (
              <td key={col.id} style={{ ...totalStyle, background: '#f1f5f9', borderRadius: 6 }}>{colTotal(col.id)}</td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * 把一句话里的**数字**挑出来加粗放大（★ 教师：「文字也要有设计感」）。
 *
 * 🔴 这是**显示变换，不是判据** —— 它不认识「12 人」是什么意思，只认识「数字」。
 * 所以它不解释、不判断，只让数字从灰句子里跳出来。措辞本身仍由纯层给
 * （`worksheet-question-stats.ts` 的 `buildInsights`，那里有一条用例钉着
 * 「不许出现解释性的词」）。
 *
 * ⚠️ 用 `split` 保留分隔符的写法（`/(\d+)/`）而不是 `match` 循环：前者天然保住顺序与
 * 非数字段，后者要自己拼回去、容易漏尾巴。
 */
function emphasizeNumbers(text: string): React.ReactNode {
  return text.split(/(\d+)/).map((part, index) => (
    /^\d+$/.test(part)
      ? <b key={index} style={{ fontSize: '1rem', fontWeight: 700, color: CHART.ink }}>{part}</b>
      : <span key={index}>{part}</span>
  ));
}

/** 一行小标题。 */
function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className={styles.section}>
      <h4>
        {title}
        {note && <span>{note}</span>}
      </h4>
      {children}
    </section>
  );
}

export function QuestionStatsOverlay({
  mode, board, worksheetId, questionId, nodesByWorksheet, onClose, onOpenAnalysis, embedded = false,
}: {
  /** 课堂 mode —— 只在量词上用（分组 / 高级模式下「人」要写成「组」），与旁边两屏同源。 */
  mode: string;
  board: WorksheetBoard | null;
  worksheetId: string;
  questionId: string;
  nodesByWorksheet: Record<string, WorksheetQuestionNode[]>;
  onClose: () => void;
  /** 两个入口统一打开同一个 AI 分析结果窗口，避免内嵌版与独立版继续分叉。 */
  onOpenAnalysis: () => void;
  /** 统一学习单工作区内直接渲染，不再创建遮罩和第二层浮窗。 */
  embedded?: boolean;
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
  /**
   * ★ 2026-09-28（教师）：「在这一屏加一个『看某人的作答』的入口」。
   * 🔴 **刻意是一个下拉 + 一块作答，而不是把全班列出来** —— 教师刚把「逐个作答」
   * 整块删掉（那正是「列出全班」），所以这里要的是「按需看一个人」。
   */
  const [pickedId, setPickedId] = useState<string>('');
  const participants = worksheet?.participants ?? [];
  const picked = participants.filter((item) => item.participantId === pickedId)[0];
  const pickedRow = picked?.answerRows.filter((item) => item.questionId === questionId)[0];

  const distribution = stats?.distribution ?? null;

  const panel = (
      <div data-overscroll-guard="" className={styles.panel} data-embedded={embedded ? 'true' : 'false'}>
        {/* 页头 */}
        <div className={styles.header}>
          <div className={styles.headingRow}>
            <div className={styles.headingText}>
              <div className={styles.eyebrow}>题目详情</div>
              <h3>
                {node ? `${heading ? `${heading} · ` : ''}${questionTypeNickname(node.type)}` : '正在读取题目'}
              </h3>
            </div>
            {!embedded && <button type="button" onClick={onClose} className={styles.closeButton}>关闭</button>}
          </div>
          {stats && (
            // ★ 2026-09-28（教师：课堂展示、有听课老师）：页头改成**数字块 + 结论环**。
            // 数字块给精确值，环给「一眼抓住比例」—— 两者并列才算「丰富」。
            <div className={styles.summary}>
              <div className={styles.metrics}>
                {[
                  { label: `参与者`, value: String(stats.total), suffix: unit, color: '#0f172a' },
                  { label: '已交', value: String(stats.submitted), suffix: unit, color: '#0f172a' },
                  { label: '全对', value: String(stats.correct), suffix: unit, color: OK },
                  { label: '部分给分', value: String(stats.partial), suffix: unit, color: WARN },
                  { label: '答错', value: String(stats.wrong), suffix: unit, color: BAD },
                ].map((cell) => (
                  // 展示用：数值 1.375rem/700（这一屏第二大的字），标签降到 0.688rem 灰。
                  <div key={cell.label} className={styles.metric}>
                    <small>{cell.label}</small>
                    <div style={{ color: cell.color }}>
                      {cell.value}<span>{cell.suffix}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.donut}>
                {/* ⚠️ 正确率是 `null` 时中心画「—」而**不是 0%** —— 0% 是一句假话（没有判过的行）。 */}
                <VerdictDonut
                  size={96}
                  unit={unit}
                  centerText={stats.accuracy === null ? null : `${stats.accuracy}%`}
                  centerNote={stats.accuracy === null ? '不统计正确率' : '正确率'}
                  data={[
                    { name: '全对', value: stats.correct, color: CHART.correct },
                    { name: '部分给分', value: stats.partial, color: CHART.partial },
                    { name: '答错', value: stats.wrong, color: CHART.wrong },
                    { name: '已提交（无对错）', value: stats.noVerdict, color: CHART.noVerdict },
                    { name: '未作答', value: stats.unanswered, color: CHART.unanswered },
                  ]}
                />
              </div>
            </div>
          )}
        </div>

        <div className={styles.body}>
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
                    <CountBars bars={distribution.bars} unit={unit} />
                    {distribution.combos.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.688rem', color: MUTED, marginBottom: 4 }}>选答组合（前 3）</div>
                        <CountBars bars={distribution.combos} unit={unit} colorFor={() => CHART.muted} dense />
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
                        <CountBars bars={blank.bars} unit={unit} dense />
                      </div>
                    ))}
                  </div>
                )}
                {distribution?.kind === 'order' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* 「有几位排对了」：**计数**，不是判分结论（判分那件事由页头那四格说）。 */}
                    <CountBars
                      bars={distribution.positions.map((position) => ({ label: `第 ${position.index + 1} 位`, count: position.hits }))}
                      unit={unit}
                    />
                    {distribution.topOrders.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.688rem', color: MUTED, marginBottom: 4 }}>出现最多的顺序（前 3）</div>
                        <CountBars bars={distribution.topOrders} unit={unit} colorFor={() => CHART.muted} dense />
                      </div>
                    )}
                  </div>
                )}
                {(distribution?.kind === 'match' || distribution?.kind === 'categorize') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Matrix
                      rowLabel={distribution.kind === 'match' ? '左栏' : '条目'}
                      colLabel={distribution.kind === 'match' ? '右栏' : '框'}
                      rows={distribution.kind === 'match' ? distribution.left : distribution.items}
                      cols={distribution.kind === 'match' ? distribution.right : distribution.zones}
                      cells={distribution.cells}
                    />
                    {/* 🔴 热力图**必须**有图例：没有它，深浅只是一片蓝。 */}
                    <HeatLegend max={Math.max(0, ...distribution.cells.map((cell) => cell.count))} unit={unit} />
                  </div>
                )}
                {distribution?.kind === 'text' && (() => {
                  // 问答题的 5 个长度区间大多只有 1—2 个有值。零值也各占一行会留下大片空白，
                  // 所以这里只画实际出现过的区间；没有有效文字时才保留一句空态。
                  const present = distribution.lengths.filter((item) => item.count > 0);
                  return present.length > 0
                    ? <CountBars bars={present} unit={unit} dense height={Math.max(54, present.length * 30)} />
                    : <div style={{ fontSize: '0.75rem', color: FAINT }}>尚无可统计的文字作答。</div>;
                })()}
                {distribution?.kind === 'ink' && (
                  <div style={{ fontSize: '0.75rem', color: MUTED }}>
                    {distribution.drawn} {unit}交了这一题（笔迹的图见下面「逐个作答」）。
                  </div>
                )}
              </Section>

              {/* 文字说明。🔴 只陈述算得出来的事实（判据层的硬线） */}
              {stats.insights.length > 0 && (
                <Section title="说明">
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {stats.insights.map((insight, index) => (
                      // 🔴 **整句不染色**，改用左侧 3px 色条 —— 染色整句是最像「调试输出」的写法。
                      <li key={index} style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                        borderLeft: `3px solid ${insight.level === 'warn' ? CHART.partial : insight.level === 'good' ? CHART.correct : '#e2e8f0'}`,
                        paddingLeft: 10, fontSize: '0.875rem', color: '#334155', lineHeight: 1.6,
                      }}>
                        <span>{emphasizeNumbers(insight.text)}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* 过程统计（★ 教师批准保留）。⚠️ 三列都是 NULL 的旧行**不进样本** ⇒ 那时整段是「—」。 */}
              <Section title="作答过程" note="旧数据没有这一项，显示「—」">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                  {[
                    { mark: '◷', label: '典型用时', value: stats.process.medianMs === null ? '—' : `${Math.round(stats.process.medianMs / 1000)} 秒` },
                    { mark: '↻', label: '典型修改', value: stats.process.medianSaves === null ? '—' : `${stats.process.medianSaves} 次` },
                    { mark: '○', label: '尚未提交', value: `${stats.process.notSubmitted.length} ${unit}` },
                  ].map((item) => (
                    <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 9, alignItems: 'center', padding: '9px 11px', border: '1px solid #e0e8f0', borderRadius: 10, background: '#fff' }}>
                      <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8, background: '#eef4fa', color: '#56789b', fontSize: '0.9rem' }}>{item.mark}</span>
                      <span style={{ minWidth: 0 }}>
                        <small style={{ display: 'block', color: CHART.faint, fontSize: '0.65rem', lineHeight: 1.2 }}>{item.label}</small>
                        <b style={{ display: 'block', marginTop: 2, color: CHART.ink, fontSize: '0.88rem' }}>{item.value}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}

          {/* ★ 看某人的作答（教师指定）—— 复用逐题型的呈现组件，不另写一份。 */}
          <Section title="看某人的作答" note="选一个人，看他这道题写了什么">
            <select
              value={pickedId}
              onChange={(event) => setPickedId(event.target.value)}
              style={{ alignSelf: 'flex-start', minWidth: 180, padding: '5px 8px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.813rem', background: 'white' }}>
              <option value="">（选一个人）</option>
              {participants.map((item) => {
                const row = item.answerRows.filter((entry) => entry.questionId === questionId)[0];
                const state = row?.status === 'submitted' ? '已交' : row?.status === 'draft' ? '作答中' : '未作答';
                return <option key={item.participantId} value={item.participantId}>{item.name}（{state}）</option>;
              })}
            </select>
            {picked && node && (
              <div style={{ marginTop: 8, padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'white' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <b style={{ fontSize: '0.813rem' }}>{picked.name}</b>
                  {/* 判分结论读的是行里的 `gradeState`（服务端判过的），本地不重算。 */}
                  {(() => {
                    const statusView = pickedStatusView(pickedRow);
                    return (
                      <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: MUTED, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <WorksheetStatusIcon name={statusView.icon} size={15} />
                        {statusView.label}
                      </span>
                    );
                  })()}
                </div>
                <AnswerViewBody node={node} value={pickedRow?.value} />
              </div>
            )}
          </Section>

          {/* ② AI 分析。结果只保留一个统一查看窗口；这里不再内嵌第二套结果页。 */}
          {node && showsAgentAnalysis(node) && (
            <Section title="AI 分析" note="发现简单统计之外的理解方式与共同困难">
              <button type="button" onClick={onOpenAnalysis} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18,
                width: '100%', padding: '15px 17px', border: '1px solid #cddceb', borderRadius: 12,
                background: '#f5f9fd', color: '#28445f', cursor: 'pointer', textAlign: 'left',
              }}>
                <span>
                  <strong style={{ display: 'block', fontSize: '0.86rem' }}>
                    {worksheet?.analyzedQuestionIds?.includes(questionId) ? '查看已保存的 AI 分析' : '生成 AI 分析'}
                  </strong>
                  <span style={{ display: 'block', marginTop: 4, color: '#71859a', fontSize: '0.74rem' }}>
                    分析结论、逐生 AI 评分和发送数据都在统一结果窗口中查看
                  </span>
                </span>
                <span aria-hidden style={{ color: '#6685a5', fontSize: '1.1rem' }}>›</span>
              </button>
            </Section>
          )}

        </div>
      </div>
  );

  if (embedded) return panel;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 292, background: 'rgb(25 43 62 / 34%)', backdropFilter: 'blur(2px)' }} />
      {panel}
    </>
  );
}
