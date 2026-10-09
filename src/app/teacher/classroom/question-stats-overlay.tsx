'use client';

import { useMemo } from 'react';
import type { WorksheetBoard, WorksheetQuestionNode } from '@/lib/types';
// ★ 2026-09-30：矩阵表头是**连线右项 / 归类框名**（教师原文）⇒ 认公式。
import { PromptText } from '@/lib/worksheet-prompt-text';
import { indexQuestions } from './worksheet-drawer-state';
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
 * ── 两块（规格 §6）──────────────────────────────────────────────────
 *   ① 本题统计（答案分布、课堂观察和作答过程）
 *   ② AI 分析 ← **打开统一的分析结果浮层**（裁决：见下面 `onOpenAnalysis` 那段注释）
 */

const OK = '#15803d';
const BAD = '#934e4e';
const WARN = '#b45309';
const MUTED = '#64748b';
const FAINT = '#94a3b8';

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
              <div className={styles.statusBand}>
                <StackedBar stats={stats} />
              </div>

              <div className={styles.insightGrid}>
                {/* ① 本题统计：图与事实并排，课堂上不需要来回滚动。 */}
                <Section title="答案分布">
                  {distribution === null && (
                    <div style={{ fontSize: '0.75rem', color: FAINT }}>
                      这一题没有可统计的分布，或者题型修改后存在多种作答形状。
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
                      <HeatLegend max={Math.max(0, ...distribution.cells.map((cell) => cell.count))} unit={unit} />
                    </div>
                  )}
                  {distribution?.kind === 'text' && (() => {
                    const present = distribution.lengths.filter((item) => item.count > 0);
                    return present.length > 0
                      ? <CountBars bars={present} unit={unit} dense height={Math.max(54, present.length * 30)} />
                      : <div style={{ fontSize: '0.75rem', color: FAINT }}>尚无可统计的文字作答。</div>;
                  })()}
                  {distribution?.kind === 'ink' && (
                    <div style={{ fontSize: '0.75rem', color: MUTED }}>
                      {distribution.drawn} {unit}提交了笔迹作答。
                    </div>
                  )}
                </Section>

                <Section title="课堂观察">
                  {stats.insights.length > 0 ? (
                    <ul className={styles.insightList}>
                      {stats.insights.map((insight, index) => (
                        <li key={index} data-tone={insight.level}>
                          <span>{emphasizeNumbers(insight.text)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <div className={styles.quietState}>当前没有需要补充的统计说明。</div>}
                </Section>
              </div>

              <Section title="作答过程" note="旧数据缺少过程记录时显示「—」">
                <div className={styles.processStrip}>
                  {[
                    { label: '典型用时', value: stats.process.medianMs === null ? '—' : `${Math.round(stats.process.medianMs / 1000)} 秒` },
                    { label: '典型修改', value: stats.process.medianSaves === null ? '—' : `${stats.process.medianSaves} 次` },
                    { label: '尚未提交', value: `${stats.process.notSubmitted.length} ${unit}` },
                  ].map((item) => (
                    <div key={item.label} className={styles.processMetric}>
                      <small>{item.label}</small>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}

          {/* ② AI 分析。结果只保留一个统一查看窗口；这里不再内嵌第二套结果页。 */}
          {node && showsAgentAnalysis(node) && (
            <Section title="AI 分析" note="发现简单统计之外的理解方式与共同困难">
              <button type="button" onClick={onOpenAnalysis} className={styles.analysisAction}>
                <span>
                  <strong>
                    {worksheet?.analyzedQuestionIds?.includes(questionId) ? '查看已保存的 AI 分析' : '生成 AI 分析'}
                  </strong>
                  <span>
                    分析结论、逐生 AI 评分和发送数据都在统一结果窗口中查看
                  </span>
                </span>
                <b>进入分析</b>
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
