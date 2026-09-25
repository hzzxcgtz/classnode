'use client';

import { useEffect, useMemo, useState } from 'react';
import type { WorksheetBoard, WorksheetQuestionNode } from '@/lib/types';
// ★ M4b/E1：笔迹的换算**只有一份**（`src/lib/worksheet-ink.ts`）—— 学生端 canvas（C1）与
// 教师端这个 SVG 都走它。各写一份 `x * canvas.w` 的后果是**两边画出来的形状不一样**，
// 而两处都「看起来正常」：没有任何报错、也没有一条用例会红。
import { strokePath, strokeWidthPx, type InkValue } from '@/lib/worksheet-ink';
import {
  indexQuestions,
  participantColumnTitle,
  participantUnitLabel,
  questionAggregate,
  questionHeading,
  questionOutcome,
  // `statusLabel` 不再从这里引：它的唯一调用点（`◐ 作答中` / `◐ 已提交` 那两个词）
  // 随 E2 一起搬进了 `worksheet-drawer-state.ts` 的 `NO_VERDICT_VIEW`（那里引它，同一份）。
  outcomeMarkView,
  type WorksheetOutcomeMark,
  type WorksheetQuestionStatus,
} from './worksheet-drawer-state';

/**
 * 教师看板的**学习单抽屉**（规格 §7.3）—— 同一块 420px 位置，两种形态：
 *
 *   · **形态 A —— 点某个学生/组**：逐题作答详情（题号 / 题型 / 状态 / 对错 / 学生原答案 /
 *     「标记已查看」）。主观题**没有对错**，未作答的题**不给**「标记已查看」按钮
 *     （服务端对它会回 409 —— 界面上不该给一个必然失败的按钮）。
 *   · **形态 B —— 顶栏入口**：**先按学习单分组，再按题**。
 *
 * 🔴 那一层「先按学习单」不是多余的：高级模式下**每个组可以是不同的学习单**（规格 §1.2），
 * 「全班共有的第 3 题」并不存在。标准 / 分组模式下只有一份，本组件会**自动退化成一层**
 * （见下面那段 `useEffect`）—— 那正是规格 §7.3 说的「它会自动退化成一层」。
 *
 * ⚠️ **本文件只画，不判断**：每一条判据都在 `worksheet-drawer-state.ts`（纯函数、有测试）。
 * 把判据写进 JSX 就没有任何回归网了（本仓没有前端测试框架，`node --test` 加载不了 JSX）——
 * 与 `worksheet-tiles.tsx` 同一条规矩。
 *
 * ⚠️ **抽屉里读 `content`（题目树）只为了画题号 / 题型 / 选项文字**。答案字段
 * （`correctKeys` / `answers` / `explanation`）住在同一棵树里，永远不从这里下发到别处；
 * 而服务端的历史读端点（`/classroom/:id/answers`）压根不返回 `content`（规格 §5.4）。
 */

/**
 * 抽屉当前停在哪一层。
 *
 * 「层次」是**栈**而不是单个值（`stack`）：形态 B 是三层下钻（学习单 → 题 → 该题的全部作答），
 * 反过来也要能一层层退回。形态 A 只有一层，但它可以从形态 B 的第三层点进来。
 */
export type WorksheetDrawerView =
  | { kind: 'worksheets' }
  | { kind: 'questions'; worksheetId: string }
  | { kind: 'question'; worksheetId: string; questionId: string }
  | { kind: 'participant'; participantId: string };

export interface WorksheetDrawerEntry {
  /** 每次「打开」换一个新对象 ⇒ 抽屉内的下钻栈随之重置（组件用它的引用做依赖）。 */
  token: number;
  view: WorksheetDrawerView;
}

export function WorksheetDrawer({
  entry, onClose, board, nodesByWorksheet, loading, reviewBusy, onReview,
}: {
  entry: WorksheetDrawerEntry;
  onClose: () => void;
  /** 历史读端点的结果；`null` = 还没到（第一次打开时它总要先来一趟）。 */
  board: WorksheetBoard | null;
  /** 学习单 id → 题目树（`loadWorksheetNodes` 拉的，格子的格数也用它）。 */
  nodesByWorksheet: Record<string, WorksheetQuestionNode[]>;
  loading: boolean;
  /** 正在标记的那一条（`participantId:questionId`），点过的按钮显示「标记中…」。 */
  reviewBusy: string | null;
  onReview: (worksheetId: string, participantId: string, questionId: string) => void;
}) {
  const [stack, setStack] = useState<WorksheetDrawerView[]>([entry.view]);

  // 每次「打开」都从入口那一层重新开始（换一个学生、再点一次同一个入口都算新的一次）。
  useEffect(() => { setStack([entry.view]); }, [entry]);

  // 🔴 **自动退化成一层**（规格 §7.3）：标准 / 分组模式下全班只有一份学习单，
  // 「先按学习单分组」那一层就只剩一行，等于让教师多点一次。所以板子到齐之后，
  // 若栈上只有「学习单列表」这一层、而它恰好只有一份，就把它换掉。
  // ⚠️ **只在栈恰好是 `[worksheets]` 时换**：教师自己从第三层退回第二层时栈比这长，
  // 那种情况下把他再推回题目列表会变成一个按不动的「返回」。
  useEffect(() => {
    if (!board) return;
    if (board.worksheets.length !== 1) return;
    setStack((prev) => (
      prev.length === 1 && prev[0].kind === 'worksheets'
        ? [{ kind: 'questions', worksheetId: board.worksheets[0].id }]
        : prev
    ));
  }, [board]);

  const current = stack[stack.length - 1];
  const push = (view: WorksheetDrawerView) => setStack((prev) => [...prev, view]);
  const back = () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));

  /** 这一层能不能退（退到上一层，而不是关掉抽屉）。 */
  const canGoBack = stack.length > 1;

  const header = useMemo(
    () => describeHeader(current, board, nodesByWorksheet),
    [current, board, nodesByWorksheet],
  );

  return (
    <>
      {/* 遮罩层。与对话抽屉同一块位置、同一个 z-index 层（两者互斥，见 page.tsx 的打开处）。 */}
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 290, background: 'rgba(0,0,0,0.12)' }} />
      <div data-worksheet-drawer style={{
        position: 'fixed', top: 96, right: 24, bottom: 24,
        width: 420, zIndex: 291,
        background: 'white', borderRadius: 14,
        border: '1px solid #e2e8f0',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      }}>
        {/* 头部：标题随层次变，左上角是「返回」（只在有多层时出现）。 */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(135deg, #f8faff, #f0f4ff)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {canGoBack && (
            <button type="button" onClick={back} aria-label="返回上一层"
              className="btn btn-ghost" style={{ fontSize: '0.688rem', padding: '4px 8px', flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              返回
            </button>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {header.title}
            </h3>
            {header.hint && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>{header.hint}</div>
            )}
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}
            style={{ fontSize: '0.688rem', padding: '4px 10px', flexShrink: 0 }}>关闭</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem' }}>正在读取作答…</div>
          )}
          {!loading && !board && (
            // 读失败 / 还没到：**如实说**，不要画一个像是「全班都没作答」的空列表
            // （那正是本任务要修的那类假象）。
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem', lineHeight: 1.7 }}>
              还没有读到这一堂课的作答。<br />请确认服务正在运行，或稍后再打开一次。
            </div>
          )}
          {!loading && board && current.kind === 'worksheets' && (
            <WorksheetList board={board} onOpen={(worksheetId) => push({ kind: 'questions', worksheetId })} />
          )}
          {!loading && board && current.kind === 'questions' && (
            <QuestionList board={board} worksheetId={current.worksheetId}
              nodes={nodesByWorksheet[current.worksheetId] ?? null}
              onOpen={(questionId) => push({ kind: 'question', worksheetId: current.worksheetId, questionId })} />
          )}
          {!loading && board && current.kind === 'question' && (
            <QuestionAnswers board={board} worksheetId={current.worksheetId} questionId={current.questionId}
              nodes={nodesByWorksheet[current.worksheetId] ?? null}
              onOpenParticipant={(participantId) => push({ kind: 'participant', participantId })} />
          )}
          {!loading && board && current.kind === 'participant' && (
            <ParticipantAnswers board={board} participantId={current.participantId}
              nodesByWorksheet={nodesByWorksheet} reviewBusy={reviewBusy} onReview={onReview} />
          )}
        </div>
      </div>
    </>
  );
}

// ── 头部标题 ─────────────────────────────────────────────────────────

function describeHeader(
  view: WorksheetDrawerView,
  board: WorksheetBoard | null,
  nodesByWorksheet: Record<string, WorksheetQuestionNode[]>,
): { title: string; hint: string | null } {
  const worksheetOf = (worksheetId: string) => board?.worksheets.filter((item) => item.id === worksheetId)[0] ?? null;

  if (view.kind === 'worksheets') {
    return { title: '学习单', hint: board ? `${board.worksheets.length} 份在用` : null };
  }
  if (view.kind === 'questions') {
    const worksheet = worksheetOf(view.worksheetId);
    return { title: worksheet ? `${worksheet.title} · 按题` : '按题', hint: '点某一题看全部作答' };
  }
  if (view.kind === 'question') {
    const worksheet = worksheetOf(view.worksheetId);
    const nodes = nodesByWorksheet[view.worksheetId] ?? [];
    const { byId, headingOf } = indexQuestions(nodes);
    const node = byId.get(view.questionId) ?? null;
    const kinds = worksheet?.participants.map((participant) => participant.kind) ?? [];
    // 标题写「全部作答」而不是「全班答案」：分组/高级模式下这里列的是**参与者**（是组不是人），
    // 而且「答案」在本项目里已被 §5.4 占用为「正确答案」（规格 §7.3 的原话）。
    return {
      title: (node ? questionHeading(node, headingOf(view.questionId)) : '题目') + ` · ${participantColumnTitle(kinds)}`,
      hint: worksheet?.title ?? null,
    };
  }
  const found = findParticipant(board, view.participantId);
  return {
    title: found ? `${found.participant.name} · 学习单` : '学习单',
    hint: found ? found.worksheet.title : null,
  };
}

function findParticipant(board: WorksheetBoard | null, participantId: string) {
  for (const worksheet of board?.worksheets ?? []) {
    for (const participant of worksheet.participants) {
      if (participant.participantId === participantId) return { worksheet, participant };
    }
  }
  return null;
}

// ── 形态 B · 第一层：学习单列表 ──────────────────────────────────────

function WorksheetList({ board, onOpen }: { board: WorksheetBoard; onOpen: (worksheetId: string) => void }) {
  if (board.worksheets.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem', lineHeight: 1.7 }}>
        这一堂课还没有配学习单。
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {board.worksheets.map((worksheet) => {
        const unit = participantUnitLabel(worksheet.participants.map((participant) => participant.kind));
        return (
          <button key={worksheet.id} type="button" onClick={() => onOpen(worksheet.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
              padding: '12px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer',
            }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                《{worksheet.title}》
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                {worksheet.participants.length} {unit}在用
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        );
      })}
    </div>
  );
}

// ── 形态 B · 第二层：题目列表（正确率 / 已交 N/M）────────────────────

function QuestionList({
  board, worksheetId, nodes, onOpen,
}: {
  board: WorksheetBoard;
  worksheetId: string;
  nodes: WorksheetQuestionNode[] | null;
  onOpen: (questionId: string) => void;
}) {
  const worksheet = board.worksheets.filter((item) => item.id === worksheetId)[0];
  if (!worksheet) return null;
  if (!nodes) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem' }}>
        学习单内容还没加载到。
      </div>
    );
  }
  const { items } = indexQuestions(nodes);
  if (items.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem' }}>这份学习单还没有题目。</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(({ node, heading }) => {
        // ⚠️ 一个参与者一格（没作答的是 `undefined`）：`questionAggregate` 的两个分母都靠
        // 「参与者数」这个长度，把没作答的人过滤掉会让「已交 N/M」凭空满员。
        const rows = worksheet.participants.map((participant) =>
          participant.answerRows.filter((row) => row.questionId === node.id)[0]);
        const aggregate = questionAggregate(rows);
        const accuracy = aggregate.accuracy;
        return (
          <button key={node.id} type="button" onClick={() => onOpen(node.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
              padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer',
            }}>
            <div style={{ minWidth: 0, flex: 1, fontWeight: 600, fontSize: '0.813rem', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {questionHeading(node, heading)}
            </div>
            {/* 主观题恒不判分 ⇒ 这里自然是「—」，不是 0%（见 questionAggregate 的注释）。 */}
            <span style={{ fontSize: '0.75rem', color: accuracy === null ? '#94a3b8' : accuracy >= 60 ? '#15803d' : '#b45309', whiteSpace: 'nowrap' }}
              title="正确率 = 已判对 ÷ 已判过的作答（主观题与关闭自动判分时没有这一项）">
              正确 {accuracy === null ? '—' : `${accuracy}%`}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>
              已交 {aggregate.submitted}/{aggregate.total}
            </span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        );
      })}
    </div>
  );
}

// ── 形态 B · 第三层：某题的全部作答（按参与者列，可能是组不是人）────

function QuestionAnswers({
  board, worksheetId, questionId, nodes, onOpenParticipant,
}: {
  board: WorksheetBoard;
  worksheetId: string;
  questionId: string;
  nodes: WorksheetQuestionNode[] | null;
  onOpenParticipant: (participantId: string) => void;
}) {
  const worksheet = board.worksheets.filter((item) => item.id === worksheetId)[0];
  if (!worksheet) return null;
  const node = nodes ? indexQuestions(nodes).byId.get(questionId) ?? null : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {worksheet.participants.map((participant) => {
        const row = participant.answerRows.filter((item) => item.questionId === questionId)[0];
        const outcome = node ? questionOutcome(node, row) : null;
        return (
          <button key={participant.participantId} type="button" onClick={() => onOpenParticipant(participant.participantId)}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left',
              padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer',
            }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '0.813rem', fontWeight: 600, color: '#334155' }}>{participant.name}</div>
              <div style={{ fontSize: '0.813rem', color: '#0f172a', marginTop: 3, wordBreak: 'break-word' }}>
                {/* 未作答就**不显示空白**：一句「未作答」比一个空框有信息量。
                    🔴 但「没有 `answerText`」**不等于**未作答 —— 笔迹作答的 `answerText` 恒为
                    `null`（笔迹不是文字，见 `formatAnswer`）⇒ 必须先看 `outcome.ink`，
                    否则一个画了一整幅画的学生在这一屏上显示成「未作答」，而教师会去催他。 */}
                {outcome?.ink ? (
                  <InkPreview value={outcome.ink} />
                ) : (
                  outcome?.answerText ?? <span style={{ color: '#94a3b8' }}>未作答</span>
                )}
              </div>
            </div>
            <OutcomeMark mark={outcome?.mark ?? 'none'} status={outcome?.status ?? 'unanswered'} />
          </button>
        );
      })}
    </div>
  );
}

// ── 形态 A：某参与者的逐题详情 ───────────────────────────────────────

function ParticipantAnswers({
  board, participantId, nodesByWorksheet, reviewBusy, onReview,
}: {
  board: WorksheetBoard;
  participantId: string;
  nodesByWorksheet: Record<string, WorksheetQuestionNode[]>;
  reviewBusy: string | null;
  onReview: (worksheetId: string, participantId: string, questionId: string) => void;
}) {
  const found = findParticipant(board, participantId);
  if (!found) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem' }}>这一格（参与者）此刻没有配学习单。</div>;
  }
  const { worksheet, participant } = found;
  const nodes = nodesByWorksheet[worksheet.id] ?? null;
  if (!nodes) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem' }}>学习单内容还没加载到。</div>;
  }
  const { items } = indexQuestions(nodes);
  if (items.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem' }}>这份学习单还没有题目。</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(({ node, heading }) => {
        const row = participant.answerRows.filter((item) => item.questionId === node.id)[0];
        const outcome = questionOutcome(node, row);
        const busyKey = `${participantId}:${node.id}`;
        return (
          <div key={node.id} style={{
            padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: 'white',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: '0.813rem', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {questionHeading(node, heading)}
              </span>
              <OutcomeMark mark={outcome.mark} status={outcome.status} />
            </div>
            {/* 学生原答案。未作答时如实说，不画一个空框。
                🔴 与上面「按题看」那一屏**同一条**：笔迹作答的 `answerText` 是 `null`，
                所以必须先看 `outcome.ink`。漏改这一处（或漏改上面那一处）的表现是
                「一屏说未作答、另一屏画出来了」—— 同一份数据两种说法，且没有任何报错。 */}
            <div style={{ fontSize: '0.813rem', color: outcome.answerText ? '#0f172a' : '#94a3b8', wordBreak: 'break-word' }}>
              {outcome.ink ? <InkPreview value={outcome.ink} /> : outcome.answerText ?? '未作答'}
            </div>
            {/* 🔴 「标记已查看」只在**作答过**的题上出现（`canReview`）：服务端对未作答的题回
                409，给一个必然失败的按钮是本任务明确要避免的那件事。
                已看过的题也留着按钮 —— 再点一次是**刷新**「最后查看时间」（服务端就是这么写的）。 */}
            {outcome.canReview && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button" className="btn btn-ghost" disabled={reviewBusy === busyKey}
                  onClick={() => onReview(worksheet.id, participantId, node.id)}
                  style={{ fontSize: '0.688rem', padding: '3px 8px' }}>
                  {reviewBusy === busyKey ? '标记中…' : outcome.reviewed ? '再看一次' : '标记已查看'}
                </button>
                {outcome.reviewed && (
                  <span style={{ fontSize: '0.688rem', color: '#15803d' }}>已看</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 两处共用的小组件 ─────────────────────────────────────────────────

/**
 * 学生笔迹的**只读**渲染（★ M4b/E1）—— 抽屉里两处渲染点（按题看 / 逐题列表）共用它。
 *
 * 🔴 **一个判据都不含**：坐标换算与线宽全部走 `src/lib/worksheet-ink.ts` 的
 * `strokePath` / `strokeWidthPx` —— 学生端的 canvas（C1）走的是同一对函数。各写一份的后果是
 * **两边画出来的形状不一样**，而两处都「看起来正常」。
 *
 * 宽高比用**值自己记的** `canvas.w/h`（裁定 2）：容器不足时按它留白，而不是把图拉变形。
 * ⚠️ 抽屉的宽度是 420px 固定（规格 §7.3），所以一幅 320×240 的图在这里是**缩小的**。
 * 「教师能不能看清学生的字」是产品判断，本批**不做**放大视图 —— 已写进 F1 的真机清单。
 */
function InkPreview({ value }: { value: InkValue }) {
  const { w, h } = value.canvas;
  // `w`/`h` 可能是 0（手改过的值 / 读不出来的框，见 `readCanvas` 的哨兵）：那时给一个最小
  // 可渲染的框，别让 SVG 的 viewBox 变成 "0 0 0 0"（那在 Safari 上什么都不画）。
  const box = { w: w > 0 ? w : 1, h: h > 0 ? h : 1 };
  return (
    <svg
      viewBox={`0 0 ${box.w} ${box.h}`}
      width="100%"
      style={{ display: 'block', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4 }}
      role="img"
      aria-label="学生的手写作答"
    >
      {/* `key={index}` 在这里**可以**接受：这个列表是静态的（只读、不重排、不增删、
          没有输入控件），React 只需要它在同一次渲染内唯一。⚠️ 但别照抄到别处 ——
          任何可排序 / 可增删的列表上用下标当 key 会让 React 复用错元素的状态。 */}
      {value.strokes.map((stroke, index) => (
        <path
          key={index}
          d={strokePath(stroke.points, box)}
          fill="none"
          stroke={stroke.color}
          strokeWidth={strokeWidthPx(stroke, box)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/**
 * 这一题的对错那一小块。
 *
 * 🔴 用词与图形与规格 §7.3 的图例同源：`✓ 答对` / `✗ 答错` / `◐ 作答中 / 已提交但没有对错` /
 * `─ 未作答` —— **这四个就是 §7.3 图例列出的全部**。
 * ⚠️ **`½ 半对` 不在这四个里面** —— 它是 M4a 新增的**第五档**，出处在**规格 §12**
 * （§7.3 是 M3 的图例，早于这一档，所以那里本来就不会有它）。
 * 照 §7.3 逐条核对的人找不到半对，别以为它画错了。
 * 而 `◐ 作答中` / `◐ 已提交` 是**服务端未判分**的情形（主观题、关闭自动判分）——
 * 那里显示的是状态，**不显示 ✓ 也不显示 ✗**。把它画成「✗」是本任务最要防的一类假象：
 * 系统根本不知道学生对不对。
 *
 * ★ M4a：`mark` 多了一档 `'partial'`（规格 §12 要它画得出来）。E2 之前它落到最后那一支，
 * 显示「◐ 已提交」—— 那句话是真的，却与「没有对错」**完全不可区分**。
 *
 * ⚠️ **本组件只把 `outcomeMarkView` 的结果贴上去，一个判据都不含**：
 * 「哪一档画哪个符号/词/颜色」住在 `worksheet-drawer-state.ts`（纯函数、有测试）——
 * 留在 JSX 里的话，把 `'partial'` 那一支改成与 `'wrong'` 一模一样不会有任何东西变红。
 * 类型取 `WorksheetOutcomeMark` 而**不再重写一份字面量联合**：本文件曾经手抄过
 * `'correct' | 'wrong' | 'none'`，多一档时它会安静地少一档。
 */
function OutcomeMark({
  mark, status,
}: {
  mark: WorksheetOutcomeMark;
  status: WorksheetQuestionStatus;
}) {
  const view = outcomeMarkView(mark, status);
  return (
    <span style={{
      // 三个档位与 E2 之前那两支**逐字同值**（判分结论 0.813rem/加粗、未作答 0.813rem、
      // 状态词 0.75rem）—— 只是现在由数据决定，而不是由 JSX 里的分支决定。
      fontSize: view.emphasis === 'status' ? '0.75rem' : '0.813rem',
      fontWeight: view.emphasis === 'verdict' ? 700 : undefined,
      color: view.color,
      whiteSpace: 'nowrap',
    }}>
      {view.glyph} {view.label}
    </span>
  );
}
