'use client';

import { useEffect, useMemo, useState } from 'react';
import type { WorksheetBoard, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
import { WorksheetStatusIcon } from '@/components/worksheet-status-icon';
import { RewardIcon } from '@/components/worksheet-reward-icon';
// ★ M4b/E1：笔迹的换算**只有一份**（`src/lib/worksheet-ink.ts`）—— 学生端 canvas（C1）与
// 教师端这个 SVG 都走它。各写一份 `x * canvas.w` 的后果是**两边画出来的形状不一样**，
// 而两处都「看起来正常」：没有任何报错、也没有一条用例会红。
import { AnswerViewBody } from './answer-view';
import { InkPreview } from './ink-preview';
// ★ 2026-09-28：奖励的换算与全貌/过程的判据。
import { resolveRewardScale, type RewardScale } from '@/lib/worksheet-reward';
import { StackedBar } from './question-stacked-bar';
import styles from './worksheet-drawer.module.css';
import { questionStats, type StatsRow } from './worksheet-question-stats';
import {
  indexQuestions,
  participantColumnTitle,
  participantUnitLabel,
  questionAggregate,
  questionHeading,
  questionOutcome,
  // `statusLabel` 不再从这里引：状态词与图标都由判据层统一给出。
  outcomeMarkView,
  formatAgo,
  inProgressQuestionId,
  participantOverview,
  processFacts,
  type ParticipantOverview,
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
  entry, onClose, board, nodesByWorksheet, settingsByWorksheet, loading, reviewBusy, onReview, onClearQuestion, onOpenQuestionStats,
}: {
  entry: WorksheetDrawerEntry;
  onClose: () => void;
  /** 历史读端点的结果；`null` = 还没到（第一次打开时它总要先来一趟）。 */
  board: WorksheetBoard | null;
  /** 学习单 id → 题目树（`useWorksheetBoard` 拉的，格子的格数也用它）。 */
  nodesByWorksheet: Record<string, WorksheetQuestionNode[]>;
  /**
   * ★ 2026-09-28：学习单 id → `settings`，**奖励换算要用它**（`resolveRewardScale`）。
   * 键不在 = 还没加载到 ⇒ 奖励那一项显示「—」而**不是 0**（0 是一句假话）。
   */
  settingsByWorksheet: Record<string, WorksheetSettings>;
  loading: boolean;
  /** 正在标记的那一条（`participantId:questionId`），点过的按钮显示「标记中…」。 */
  reviewBusy: string | null;
  onReview: (worksheetId: string, participantId: string, questionId: string) => void;
  /** ★ 2026-09-28（第 4 条）：清除**这一题**的作答。整张清除在格子的垃圾桶上。 */
  onClearQuestion: (worksheetId: string, participantId: string, questionId: string) => void;
  /**
   * ★ 2026-09-28：点题列表里的一题 ⇒ **开按题统计浮层**（规格 `2026-09-28-按题统计与分析.md` §2）。
   * ⚠️ 抽屉**第三层**（`{kind:'question'}`）因此不再从这里进 —— 但**矩阵那条路仍在用它**
   *（`openMatrixQuestion`），所以它不是死代码。
   */
  onOpenQuestionStats: (worksheetId: string, questionId: string) => void;
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
  const participantHeader = current.kind === 'participant'
    ? findParticipant(board, current.participantId)
    : null;
  const participantActivity = participantHeader
    ? participantHeader.participant.answerRows.some((row) => row.status === 'draft')
      ? { label: '作答中', state: 'draft' }
      : participantHeader.participant.answerRows.some((row) => row.status === 'submitted')
        ? { label: '有作答', state: 'submitted' }
        : { label: '未开始', state: 'idle' }
    : null;

  return (
    <>
      {/* 遮罩层。与对话抽屉同一块位置、同一个 z-index 层（两者互斥，见 page.tsx 的打开处）。 */}
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 290, background: 'rgba(0,0,0,0.12)' }} />
      <div data-worksheet-drawer className={styles.drawer}>
        {/* 头部：标题随层次变，左上角是「返回」（只在有多层时出现）。 */}
        <div className={styles.header}>
          {canGoBack && (
            <button type="button" onClick={back} aria-label="返回上一层"
              className="btn btn-ghost" style={{ fontSize: '0.688rem', padding: '4px 8px', flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              返回
            </button>
          )}
          {participantHeader && (
            <div className={styles.avatar} aria-hidden>{participantHeader.participant.name.trim().slice(0, 1) || '学'}</div>
          )}
          <div className={styles.headerText}>
            <div className={styles.headerTitleLine}>
              <h3 className={styles.headerTitle}>{header.title}</h3>
              {participantActivity && (
                <span className={styles.activityBadge} data-state={participantActivity.state}>{participantActivity.label}</span>
              )}
            </div>
            {header.hint && <div className={styles.headerHint}>{header.hint}</div>}
          </div>
          <button type="button" className={styles.headerButton} onClick={onClose}>关闭</button>
        </div>

        <div className={`${styles.body} ${current.kind === 'participant' ? styles.participantBody : ''}`}>
          {/* ★ 2026-09-28：判据是「**有没有数据**」，不是「正在不在读」。
              🔴 这两件事混起来是一个实测出来的 bug（教师报「抽屉里展开某一题看答题情况，
              它会自己收拢」）：下面那六个分支原先都带 `!loading`，而看板的数据层是
              **30 秒轮询**的 —— 每一次刷新都让这一整块**卸载重挂**一次，
              组件内的状态（「哪一题展开了」）随之清零、滚动位置也会跳。
              ⇒ 有数据就画数据（刷新静默进行，中间不经过「空」那一帧），
                没有数据才轮到「读到了没有」这两句。 */}
          {!board && loading && (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem' }}>正在读取作答…</div>
          )}
          {!board && !loading && (
            // 读失败 / 还没到：**如实说**，不要画一个像是「全班都没作答」的空列表
            // （那正是本任务要修的那类假象）。
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem', lineHeight: 1.7 }}>
              还没有读到这一堂课的作答。<br />请确认服务正在运行，或稍后再打开一次。
            </div>
          )}
          {board && current.kind === 'worksheets' && (
            <WorksheetList board={board} onOpen={(worksheetId) => push({ kind: 'questions', worksheetId })} />
          )}
          {board && current.kind === 'questions' && (
            <QuestionList board={board} worksheetId={current.worksheetId}
              nodes={nodesByWorksheet[current.worksheetId] ?? null}
              onOpen={(questionId) => onOpenQuestionStats(current.worksheetId, questionId)} />
          )}
          {board && current.kind === 'question' && (
            <QuestionAnswers board={board} worksheetId={current.worksheetId} questionId={current.questionId}
              nodes={nodesByWorksheet[current.worksheetId] ?? null}
              onOpenParticipant={(participantId) => push({ kind: 'participant', participantId })} />
          )}
          {board && current.kind === 'participant' && (
            <ParticipantAnswers board={board} participantId={current.participantId}
              nodesByWorksheet={nodesByWorksheet} settingsByWorksheet={settingsByWorksheet}
              reviewBusy={reviewBusy} onReview={onReview} onClearQuestion={onClearQuestion} />
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
  /** ★ 2026-09-28：改成**开按题统计浮层**（规格 §2）—— 抽屉第三层那条路仍留给矩阵。 */
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
        // ★ 迷你堆叠条：分布口径与浮层页头**同一个函数**（各数一份会让
        // 「题列表说 3 人全对、点进去说 4 人」，而没有人会去核对这两个数）。
        const miniRows: Array<StatsRow | undefined> = worksheet.participants.map((participant) => {
          const row = participant.answerRows.filter((item) => item.questionId === node.id)[0];
          if (!row) return undefined;
          return {
            participantId: participant.participantId, participantName: participant.name,
            status: row.status, isCorrect: row.isCorrect, gradeState: row.gradeState, value: row.value,
            createdAt: row.createdAt, savedAt: row.savedAt, saveCount: row.saveCount,
          };
        });
        const miniStats = questionStats(node, miniRows);
        const aggregate = questionAggregate(rows);
        const accuracy = aggregate.accuracy;
        return (
          <button key={node.id} type="button" onClick={() => onOpen(node.id)}
            style={{
              display: 'flex', flexDirection: 'column', gap: 6, width: '100%', textAlign: 'left',
              padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer',
            }}>
            {/* ★ 2026-09-28：**分布条**与那两个数字分成上下两行。
                今天只有两个数字，看不出分布形状 —— 「正确 0%」是**全班都错**、
                还是**只有 3 个人交**，要读第二眼那个 `3/40` 才知道，
                而那正是教师判「要不要讲这道题」的依据（规格 §2）。 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
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
            </div>
            <StackedBar stats={miniStats} compact />
          </button>
        );
      })}
    </div>
  );
}

// ── 形态 B · 第三层：某题的全部作答（按参与者列，可能是组不是人）────

export function QuestionAnswers({
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
  board, participantId, nodesByWorksheet, settingsByWorksheet, reviewBusy, onReview, onClearQuestion,
}: {
  board: WorksheetBoard;
  participantId: string;
  nodesByWorksheet: Record<string, WorksheetQuestionNode[]>;
  settingsByWorksheet: Record<string, WorksheetSettings>;
  reviewBusy: string | null;
  onReview: (worksheetId: string, participantId: string, questionId: string) => void;
  onClearQuestion: (worksheetId: string, participantId: string, questionId: string) => void;
}) {
  /**
   * 教师手动展开/收起过的题（`questionId → 展开?`）。
   * **没点过的题走默认**（进行中的那一题展开，其余收起）—— 见 `inProgressQuestionId`。
   * ⚠️ 用 `undefined` 判「没点过」而不是 `false`：`false` 是一个**决定**（他收起了那一题），
   * 与「他没表过态」是两件事，混起来的表现是「他收起的那一题，等下一个广播来了又自己弹开」。
   */
  const [expandedOverride, setExpandedOverride] = useState<Record<string, boolean | undefined>>({});
  const [filter, setFilter] = useState<'all' | 'answered' | 'attention' | 'unanswered'>('all');

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

  // ── 全貌（第 2 条）────────────────────────────────────────────────
  // `settings` 不在 ⇒ `scale` 为 null ⇒ 奖励那一格画「—」而不是 0（见 participantOverview）。
  const settings = settingsByWorksheet[worksheet.id];
  const scale = settings ? resolveRewardScale(settings) : null;
  const overview = participantOverview(nodes, participant.answerRows, scale);
  // 「距今多久」用的是**服务端对服务端**的差（`serverNow - savedAt`），与浏览器时钟无关。
  // ⚠️ 旧服务端不发 `serverNow` ⇒ `NaN` ⇒ 时间那两段不显示（`processFacts` 负责落 null）。
  const serverNowMs = typeof board.serverNow === 'string' ? Date.parse(board.serverNow) : Number.NaN;
  const defaultExpandedId = inProgressQuestionId(nodes, participant.answerRows);

  const rowsByQuestion = new Map(participant.answerRows.map((row) => [row.questionId, row]));
  const enriched = items.map((item) => {
    const row = rowsByQuestion.get(item.node.id);
    return { ...item, row, outcome: questionOutcome(item.node, row) };
  });
  const attentionCount = overview.partial + overview.wrong + overview.noVerdict;
  const answeredCount = items.length - overview.unanswered;
  const completedCount = overview.correct + overview.partial + overview.wrong + overview.noVerdict;
  const suggestedExpandedId = defaultExpandedId
    ?? enriched.filter(({ outcome }) => outcome.mark === 'partial' || outcome.mark === 'wrong' || (outcome.status === 'submitted' && outcome.mark === 'none'))[0]?.node.id
    ?? null;
  const latestActivityMs = participant.answerRows.reduce((latest, row) => {
    const value = Date.parse(row.savedAt ?? row.createdAt ?? '');
    return Number.isFinite(value) ? Math.max(latest, value) : latest;
  }, Number.NEGATIVE_INFINITY);
  const lastActivity = Number.isFinite(serverNowMs) && Number.isFinite(latestActivityMs)
    ? formatAgo(Math.max(0, serverNowMs - latestActivityMs))
    : null;

  const visible = enriched.filter(({ outcome }) => {
    if (filter === 'answered') return outcome.status !== 'unanswered';
    if (filter === 'attention') {
      return outcome.mark === 'partial'
        || outcome.mark === 'wrong'
        || (outcome.status === 'submitted' && outcome.mark === 'none');
    }
    if (filter === 'unanswered') return outcome.status === 'unanswered';
    return true;
  });
  const taskGroups = new Map<string, typeof visible>();
  for (const item of visible) {
    const separator = item.heading.lastIndexOf(' · ');
    const task = separator > 0 ? item.heading.slice(0, separator) : '其他题目';
    const group = taskGroups.get(task) ?? [];
    group.push(item);
    taskGroups.set(task, group);
  }
  const allTaskGroups = new Map<string, typeof enriched>();
  for (const item of enriched) {
    const separator = item.heading.lastIndexOf(' · ');
    const task = separator > 0 ? item.heading.slice(0, separator) : '其他题目';
    const group = allTaskGroups.get(task) ?? [];
    group.push(item);
    allTaskGroups.set(task, group);
  }

  return (
    <div className={styles.participantRoot}>
      <OverviewRow
        overview={overview}
        total={items.length}
        completed={completedCount}
        rewardScale={scale}
        lastActivity={lastActivity}
      />
      <div className={styles.filters} aria-label="筛选题目">
        {([
          ['all', `全部题目 ${items.length}`],
          ['answered', `已作答 ${answeredCount}`],
          ['attention', `待处理 ${attentionCount}`],
          ['unanswered', `未作答 ${overview.unanswered}`],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" className={styles.filterButton}
            data-active={filter === value}
            onClick={() => setFilter(value)}>{label}</button>
        ))}
        <span className={styles.filterHint}>展开题目可查看学生原始作答</span>
      </div>

      {taskGroups.size === 0 && (
        <div className={styles.emptyFilter}>这个筛选条件下暂时没有题目。</div>
      )}

      {[...taskGroups.entries()].map(([task, group]) => {
        const allInTask = allTaskGroups.get(task) ?? [];
        const taskCompleted = allInTask.filter(({ outcome }) => outcome.status === 'submitted').length;
        return (
          <section key={task} className={styles.taskSection}>
            <div className={styles.taskHeader}>
              <h4>{task}</h4>
              <span>完成 {taskCompleted}/{allInTask.length}</span>
            </div>
            <div className={styles.questionList}>
              {group.map(({ node, label, row, outcome }) => {
                const busyKey = `${participantId}:${node.id}`;
                const expanded = expandedOverride[node.id] ?? (node.id === suggestedExpandedId);
                const facts = outcome.status === 'unanswered' ? null : processFacts(row, serverNowMs);
                return (
                  <article key={node.id} className={styles.question}>
                    <button type="button" className={styles.questionHeader}
                      onClick={() => setExpandedOverride((prev) => ({ ...prev, [node.id]: !expanded }))}
                      aria-expanded={expanded}>
                      <span className={styles.questionNumber}>{label}</span>
                      <span className={styles.questionText}>
                        <strong>{questionHeading(node, null)}</strong>
                        <p>{node.prompt || '这道题没有填写题干'}</p>
                      </span>
                      <OutcomeMark mark={outcome.mark} status={outcome.status} />
                      <span aria-hidden className={styles.chevron}>{expanded ? '⌃' : '⌄'}</span>
                    </button>
                    {expanded && (
                      <div className={styles.questionDetail}>
                        {facts && (facts.startedAgoMs !== null || facts.savedAgoMs !== null || facts.saveCount !== null) && (
                          <div className={styles.processFacts}>
                            {facts.startedAgoMs !== null && <span>首次作答 {formatAgo(facts.startedAgoMs)}</span>}
                            {facts.saveCount !== null && <span>已保存 {facts.saveCount} 次</span>}
                            {facts.savedAgoMs !== null && <span>最近保存 {formatAgo(facts.savedAgoMs)}</span>}
                          </div>
                        )}
                        <div className={styles.answerPanel}>
                          <span className={styles.answerLabel}>学生作答与答案对照</span>
                          <AnswerViewBody node={node} value={row?.value} />
                        </div>
                        {outcome.canReview && (
                          <div className={styles.actionRow}>
                            <button type="button" className="btn btn-ghost" disabled={reviewBusy === busyKey}
                              onClick={() => onReview(worksheet.id, participantId, node.id)}
                              style={{ fontSize: '0.688rem', padding: '4px 9px' }}>
                              {reviewBusy === busyKey ? '标记中…' : outcome.reviewed ? '再看一次' : '标记已查看'}
                            </button>
                            {outcome.reviewed && <span className={styles.reviewed}>已看</span>}
                            <button type="button" className="btn btn-ghost"
                              onClick={() => onClearQuestion(worksheet.id, participantId, node.id)}
                              title="清除这一题的作答（不可撤销）"
                              style={{ fontSize: '0.688rem', padding: '4px 9px', marginLeft: 'auto', color: '#a85d5d' }}>
                              清除这一题
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * 该生全貌那一行（第 2 条）：六个计数 + 奖励总数。
 *
 * 🔴 六个数的判据全在 `participantOverview`（纯函数、有测试）—— 这一层只画。
 * 「六档之和 = 题数」那条不变式在那里钉着；这里若自己再数一遍，屏幕上的数字与用例
 * 断言的就不再是同一个函数（`worksheet-matrix.ts` 的 `rowTally` 上记过同一条教训）。
 *
 * ⚠️ 某一档为 0 时**仍然画出来**：`✓0` 与「把 ✓ 藏起来」读起来不一样 ——
 * 后者会让教师以为「这一档不可能出现」，而它只是这一次是 0。
 */
function OverviewRow({
  overview, total, completed, rewardScale, lastActivity,
}: {
  overview: ParticipantOverview;
  total: number;
  completed: number;
  rewardScale: RewardScale | null;
  lastActivity: string | null;
}) {
  const needsAttention = overview.wrong + overview.noVerdict;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className={styles.overview}>
      <div className={styles.overviewMain}>
        <div className={styles.progressMetric}><strong>{completed}/{total}</strong><span>已完成题目</span></div>
        <div className={styles.overviewMetric} data-tone="warning"><strong>{overview.partial}</strong><span>部分答对</span></div>
        <div className={styles.overviewMetric}><strong>{needsAttention}</strong><span>需要处理</span></div>
        <div className={styles.overviewMetric}><strong>{overview.unanswered}</strong><span>尚未作答</span></div>
        <div className={styles.reward}>
          <div className={styles.rewardIcon}>
            {rewardScale
              ? <RewardIcon kind={rewardScale.style} state={overview.reward > 0 ? 'earned' : 'empty'} size={34} />
              : <span style={{ color: '#aab5c2' }}>?</span>}
          </div>
          <div><small>本学习单奖励</small><strong>{overview.rewardText ?? '暂未读取'}</strong></div>
        </div>
      </div>
      <div className={styles.overviewFoot}>
        <strong>当前进度 {progress}%</strong>
        <span>{overview.draft > 0 ? `${overview.draft} 题正在作答` : completed > 0 ? `已完成 ${completed} 题` : '尚未开始作答'}</span>
        <span className={styles.lastActivity}>{lastActivity ? `最后作答：${lastActivity}` : '暂无作答时间'}</span>
      </div>
    </div>
  );
}

// ── 两处共用的小组件 ─────────────────────────────────────────────────

/**
 * 这一题的对错那一小块。
 *
 * 用词与图形由统一状态系统给出；答对、部分给分、温和重试、作答中、已提交与未作答
 * 都有各自的语义图标。作答中 / 已提交是**服务端未判分**的情形（主观题、关闭自动判分）——
 * 那里显示的是状态，**不显示 ✓ 也不显示 ✗**。把它画成「✗」是本任务最要防的一类假象：
 * 系统根本不知道学生对不对。
 *
 * ★ M4a：`mark` 多了一档 `'partial'`（规格 §12 要它画得出来）。E2 之前它落到最后那一支，
 * 显示「已提交」—— 那句话是真的，却与判分结论不同。
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
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
    }}>
      <WorksheetStatusIcon name={view.icon} size={15} />
      {view.label}
    </span>
  );
}
