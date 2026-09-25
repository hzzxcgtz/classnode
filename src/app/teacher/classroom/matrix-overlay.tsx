'use client';

// ⚠️ `CSSProperties` 要显式 import：本仓的组件不引 React 本体（Next 的新 JSX 变换），
// 直接写 `React.CSSProperties` 会 `tsc` 报「找不到名称 React」。惯例见 `worksheet-panel.tsx:4`。
import type { CSSProperties } from 'react';
import type { WorksheetBoard, WorksheetQuestionNode } from '@/lib/types';
import { isGradedType } from './worksheet-drawer-state';
import { buildWorksheetMatrix, matrixHeadline, promptLabel, questionTallies, rowTally, uncoveredCount, type CellState, type MatrixHeadline, type MatrixRow } from './worksheet-matrix';
import type { ParticipantWorksheetProgress } from './worksheet-tile-state';

/**
 * 教师看板的**学习单矩阵**覆盖层（规格 `specs/2026-09-25-m5b-matrix-overview.md`）。
 *
 * ⚠️ **本文件只画，不判断**：每一格是什么状态、哪一题卡住，全在 `worksheet-matrix.ts`
 * （纯函数、有测试）。判据写进 JSX 就没有任何回归网了（本仓没有 jsdom，
 * `node --test` 加载不了 JSX）—— 与 `worksheet-drawer.tsx` 同一条规矩。
 *
 * 🔴 **一块 = 一份学习单**：高级模式下每个组可以是**不同的**学习单（规格 §2.2），
 * 「全班共有的第 3 题」并不存在。标准 / 分组模式下 `worksheets[]` 只有一个元素，
 * 这里自动退化成一块（无额外 UI）。
 *
 * 🔴 **层级**：本覆盖层 `zIndex: 250`（与 `gridFullscreen` 同档），而学习单抽屉是 `290/291`
 * ⇒ 点行首 / 点格子打开抽屉时，抽屉**画在上面**，不需要改抽屉、也不该把矩阵关掉。
 */
export function MatrixOverlay({
  board,
  nodesByWorksheet,
  live,
  liveTrustedAfter,
  loading,
  participantCount,
  advancedMode,
  onClose,
  onOpenQuestion,
  onOpenParticipant,
  onOpenAnalysis,
}: {
  board: WorksheetBoard | null;
  nodesByWorksheet: Record<string, WorksheetQuestionNode[]>;
  live: Record<string, ParticipantWorksheetProgress>;
  /** ★ 只信在这个时刻之后到达的广播（= 本次快照发起的时刻）。见 `buildWorksheetMatrix` 的参数说明。 */
  liveTrustedAfter: number | undefined;
  loading: boolean;
  participantCount: number;
  /** ★ 只有高级模式才谈得上「有的组没配学习单」—— 下面那行提示按它收窄。 */
  advancedMode: boolean;
  onClose: () => void;
  onOpenQuestion: (worksheetId: string, questionId: string) => void;
  onOpenParticipant: (participantId: string) => void;
  /** ★ M7a：打开这道题的**分析载荷**（只对主观题有入口）。 */
  onOpenAnalysis: (worksheetId: string, questionId: string) => void;
}) {
  // ⚠️ 算术在纯函数里（GC 26）：JSX 里只调用，不再自己算一遍。
  // ⚠️ **两个入参取自不同时刻的快照**（`participantCount` 来自课堂详情、`board` 来自作答端点），
  //    差额因此可以是负数（钳在 0）或短暂偏大 —— 见 `uncoveredCount` 的注释与移交说明里的已知残余。
  const uncovered = board ? uncoveredCount(participantCount, board.worksheets) : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 250, background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', background: 'white', borderBottom: '1px solid #e2e8f0',
      }}>
        <div style={{ fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>学习单矩阵</div>
        <button onClick={onClose} type="button"
          style={{
            padding: '7px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white',
            cursor: 'pointer', fontSize: '0.813rem', color: '#475569',
          }}>
          退出
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
        {!board && loading ? (
          <p style={{ fontSize: '0.875rem', color: '#64748b' }}>正在读取作答…</p>
        ) : !board ? (
          // ⚠️ 与「全班都没作答」是两件事 —— 拉失败时 MUST NOT 画成一张空表。
          <p style={{ fontSize: '0.875rem', color: '#64748b' }}>还没读到这一堂课的作答</p>
        ) : board.worksheets.length === 0 ? (
          <p style={{ fontSize: '0.875rem', color: '#64748b' }}>这间课堂还没配学习单</p>
        ) : (
          <>
            {board.worksheets.map((sheet) => (
              <MatrixBlock
                key={sheet.id}
                title={sheet.title}
                nodes={nodesByWorksheet[sheet.id]}
                live={live}
                liveTrustedAfter={liveTrustedAfter}
                sheet={sheet}
                onOpenQuestion={onOpenQuestion}
                onOpenAnalysis={onOpenAnalysis}
                onOpenParticipant={onOpenParticipant}
              />
            ))}
            {/* 🔴 高级模式下「没配学习单的组」不在任何一块里（`resolveMaterialTargetId` 不回落）。
                少了这一行，教师看到的是一张**少了几个组**的表，而屏幕上没有任何东西说少了人。 */}
            {advancedMode && uncovered > 0 && (
              <p style={{ fontSize: '0.813rem', color: '#b45309', marginTop: 8 }}>
                另有 {uncovered} 个参与者没有可作答的学习单（高级模式下每组各自配置）
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 一块 = 一份学习单。 */
function MatrixBlock({
  sheet, title, nodes, live, liveTrustedAfter, onOpenQuestion, onOpenParticipant, onOpenAnalysis,
}: {
  sheet: WorksheetBoard['worksheets'][number];
  title: string;
  nodes: WorksheetQuestionNode[] | undefined;
  live: Record<string, ParticipantWorksheetProgress>;
  liveTrustedAfter: number | undefined;
  onOpenQuestion: (worksheetId: string, questionId: string) => void;
  onOpenParticipant: (participantId: string) => void;
  onOpenAnalysis: (worksheetId: string, questionId: string) => void;
}) {
  if (!nodes) return <p style={{ fontSize: '0.875rem', color: '#64748b' }}>《{title}》正在读取题目…</p>;

  const rows = buildWorksheetMatrix(sheet, nodes, live, liveTrustedAfter);
  // 🔴 **不再在这里早退**（独立审查抓到的）：原先 `rows.length === 0` 直接 return 一句自己写的文案，
  // 于是 `matrixHeadline` 的 `no-questions` 那一支**永远不可达**、它的用例白写，
  // 而 R1「空态只有一处判据」的目的**没达成**（还是两半，且纯函数那半是死的）。
  // 现在让没有题的那种情况照常走 `matrixHeadline` → `headlineText`。
  const headline = matrixHeadline(questionTallies(rows));
  const stuckId = headline.kind === 'stuck' ? headline.questionId : null;
  // ⚠️ 列的**顺序**来自这里（`buildWorksheetMatrix` 也是按这个顺序往 `row.cells` 里写的）。
  const participantIds = sheet.participants.map((participant) => participant.participantId);

  return (
    <section style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: '0.938rem', fontWeight: 600, color: '#1e293b', margin: '0 0 6px' }}>《{title}》</h3>
      <p style={{ fontSize: '0.813rem', color: headline.kind === 'stuck' ? '#b45309' : '#64748b', margin: '0 0 8px' }}>
        {headlineText(headline)}
      </p>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            {/* 🔴 行首（粘性左列）：横向滑到第 30 个人时，教师还得知道在看哪一题。 */}
            <th style={stickyHeaderStyle}>题＼参与者</th>
            {sheet.participants.map((participant) => (
              <th key={participant.participantId} style={headCellStyle} title={participant.name}>
                {/* 竖排：45 人时列宽只有 ~40px，横排名字会撞（「张伟 / 张敏」）。 */}
                <span style={{ writingMode: 'vertical-rl', fontSize: '0.75rem', color: '#64748b' }}>{participant.name}</span>
              </th>
            ))}
            <th style={{ ...headCellStyle, minWidth: 56 }}>已交</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <MatrixRowView
              key={row.questionId}
              row={row}
              participantIds={participantIds}
              stuck={row.questionId === stuckId}
              onOpenQuestion={() => onOpenQuestion(sheet.id, row.questionId)}
              onOpenParticipant={onOpenParticipant}
              onOpenAnalysis={() => onOpenAnalysis(sheet.id, row.questionId)}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MatrixRowView({
  row, participantIds, stuck, onOpenQuestion, onOpenParticipant, onOpenAnalysis,
}: {
  row: MatrixRow;
  /** 列的循环顺序（= `sheet.participants` 的顺序）。 */
  participantIds: string[];
  stuck: boolean;
  onOpenQuestion: () => void;
  onOpenParticipant: (participantId: string) => void;
  onOpenAnalysis: () => void;
}) {
  // ★ 屏幕上的「已交 N/M」走**用例断言的那个函数**（GC 26）。
  //   原先这里自己 `filter` 了一遍 —— 两份实现等价时三道门禁全绿，改了口径则屏幕先变而测试不红。
  const tally = rowTally(row);
  return (
    <tr style={stuck ? { background: '#fffbeb' } : undefined}>
      <th scope="row" style={{ ...stickyCellStyle, borderLeft: stuck ? '3px solid #f59e0b' : '3px solid transparent' }}>
        <button type="button" onClick={onOpenQuestion}
          style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
          {/* ★ 两级题号（`任务一 · 1`）已经是给人看的串，**不加 1** */}
          <span style={{ color: '#1e293b', fontWeight: 600 }}>{row.heading}</span>
          <span style={{ color: '#94a3b8', marginLeft: 6, fontSize: '0.75rem' }}>{row.typeLabel}</span>
          {/* 题干单行截断交给 CSS（不在这里切字符串 —— 那会把空题干那条既有文案一起吃掉）。 */}
          <span style={{
            display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', verticalAlign: 'bottom', marginLeft: 8, color: '#475569', fontSize: '0.75rem',
          }}>
            {promptLabel(row.prompt)}
          </span>
        </button>
        {/* ★ M7a：「分析」入口 —— **只对主观题出现**。客观题本来就判分，看板的对错已经
            回答了「这题答得怎么样」，再给一个分析入口只会让教师多点一下。
            判据走 `isGradedType`（它派生自题型表的 `graded` 旗标）—— 与抽屉画不画 ✓/✗
            是**同一把尺子**；而 `graded` 那张表由 `analysis-gate-parity.test.ts` 与服务端闸门对拍。
            ⚠️ 这是**兄弟节点**（不是嵌在上面那个按钮里 —— 嵌 `<button>` 是非法 HTML，
            点它会同时打开抽屉）。兄弟之间不需要 `stopPropagation`。 */}
        {!isGradedType(row.type) && (
          <button type="button" onClick={onOpenAnalysis} title="看全班这道题答了什么"
            style={{
              marginLeft: 8, padding: '2px 8px', fontSize: '0.7rem', borderRadius: 6,
              border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer',
            }}>
            分析
          </button>
        )}
      </th>
      {participantIds.map((participantId) => (
        <td key={participantId} style={bodyCellStyle}>
          <button type="button" onClick={() => onOpenParticipant(participantId)}
            title="查看这个参与者的逐题作答"
            style={{ ...dotStyle, background: CELL_COLOR[row.cells[participantId]] }} />
        </td>
      ))}
      <td style={{ ...bodyCellStyle, fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>
        {tally.submitted}/{tally.total}
        {stuck && <span style={{ marginLeft: 6, color: '#b45309' }}>⚠ 卡住</span>}
      </td>
    </tr>
  );
}

/** 三档颜色。**只有三档** —— 对错不在这里（规格 §3.4）。 */
// ⚠️ 键类型是 `CellState` 而不是 `string`：用 `string` 时**缺键 TS 判不出来**，
//    色块会静默变透明（审查点名的一处）。
const CELL_COLOR: Record<CellState, string> = {
  unanswered: '#e2e8f0',
  draft: '#fbbf24',
  submitted: '#3b82f6',
};

const DOT = 22;

const stickyHeaderStyle: CSSProperties = {
  position: 'sticky', left: 0, zIndex: 2, background: 'white', textAlign: 'left',
  padding: '4px 8px', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500,
  borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap',
};
const stickyCellStyle: CSSProperties = {
  position: 'sticky', left: 0, zIndex: 1, background: 'white', textAlign: 'left',
  padding: '4px 8px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap',
};
const headCellStyle: CSSProperties = {
  padding: '4px 2px', height: 96, verticalAlign: 'bottom', borderBottom: '1px solid #e2e8f0',
};
const bodyCellStyle: CSSProperties = { padding: '4px 2px', textAlign: 'center', borderBottom: '1px solid #f1f5f9' };
const dotStyle: CSSProperties = {
  width: DOT, height: DOT, borderRadius: 5, border: 'none', padding: 0, cursor: 'pointer', display: 'block',
};

/**
 * 那一句「此刻该讲哪一题」。五个变体各有各的话（规格 §3.5 / §3.8）。
 *
 * 🔴 **两件事都是刻意的，别「顺手修」**：
 *   · **显式标注返回类型 `: string`** —— 本仓的 `tsconfig` **没有** `noImplicitReturns`
 *     （实测：`/usr/bin/grep -n noImplicitReturns tsconfig.json` 零命中），
 *     所以少了这个标注时，将来给 `MatrixHeadline` 加第六个变体却忘了写文案，
 *     函数会**静默返回 `undefined`**，屏幕上那一行变成空白而**没有任何报错**。
 *     有了标注，缺分支是 TS2366（编译错误）。
 *   · **不写 `default:`** —— 一个 `default: return ''` 会把上面那个检查关掉。
 *     （本目录的 `worksheet-tiles.tsx:68` 有 `default: return ''`，那是**既有**写法，
 *     本批不跟着抄：它恰好是「加了变体、屏幕上出现一句空话、无人报错」的入口。）
 */
function headlineText(headline: MatrixHeadline): string {
  switch (headline.kind) {
    case 'no-questions': return '这份学习单还没有题目';
    case 'no-participants': return '还没有人加入';
    case 'all-submitted': return '全部交齐';
    case 'not-started': return '全班还没开始';
    case 'stuck': return `卡住的是 ${headline.heading} · ${headline.tally}/${headline.total} 人作答过`;
  }
}
