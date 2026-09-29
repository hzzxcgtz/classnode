'use client';

// ⚠️ `CSSProperties` 要显式 import：本仓的组件不引 React 本体（Next 的新 JSX 变换），
// 直接写 `React.CSSProperties` 会 `tsc` 报「找不到名称 React」。惯例见 `worksheet-panel.tsx:4`。
// ★ 2026-09-29：`Fragment` 是**具名** import（不是 `React.Fragment`）—— 段头行与它下面的题行
// 是同一层里的兄弟节点，key 只能挂在 Fragment 上。同目录的 `analysis-panel.tsx` 也是这么引 hook 的。
import { Fragment, useState, type CSSProperties } from 'react';
import type { WorksheetBoard, WorksheetQuestionNode } from '@/lib/types';
import { indexQuestions, isGradedType, questionAggregate } from './worksheet-drawer-state';
import { buildWorksheetMatrix, matrixGroups, matrixHeadline, promptLabel, questionTallies, rowTally, uncoveredCount, type CellState, type MatrixHeadline, type MatrixRow } from './worksheet-matrix';
import { questionTypeNickname } from '@/lib/worksheet-questions';
import type { ParticipantWorksheetProgress } from './worksheet-tile-state';
import styles from './matrix-overlay.module.css';

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
    <div className={styles.overlay}>
      <div className={styles.topbar}>
        <div className={styles.titleBlock}>
          <h2>学习单举证</h2>
          <p>按题目与学生交叉查看学习证据</p>
        </div>
        <button onClick={onClose} type="button" className={styles.closeButton}>
          退出
        </button>
      </div>

      <div className={styles.content}>
        {!board && loading ? (
          <div className={styles.emptyState}>正在读取作答…</div>
        ) : !board ? (
          // ⚠️ 与「全班都没作答」是两件事 —— 拉失败时 MUST NOT 画成一张空表。
          <div className={styles.emptyState}>还没读到这一堂课的作答</div>
        ) : board.worksheets.length === 0 ? (
          <div className={styles.emptyState}>这间课堂还没配学习单</div>
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
              <p className={styles.uncovered}>
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
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention' | 'manual'>('all');
  if (!nodes) return <div className={styles.emptyState}>《{title}》正在读取题目…</div>;

  const rows = buildWorksheetMatrix(sheet, nodes, live, liveTrustedAfter);
  // 🔴 **不再在这里早退**（独立审查抓到的）：原先 `rows.length === 0` 直接 return 一句自己写的文案，
  // 于是 `matrixHeadline` 的 `no-questions` 那一支**永远不可达**、它的用例白写，
  // 而 R1「空态只有一处判据」的目的**没达成**（还是两半，且纯函数那半是死的）。
  // 现在让没有题的那种情况照常走 `matrixHeadline` → `headlineText`。
  const headline = matrixHeadline(questionTallies(rows));
  const stuckId = headline.kind === 'stuck' ? headline.questionId : null;
  const indexed = indexQuestions(nodes).byId;
  const details = new Map(rows.map((row) => {
    const answerRows = sheet.participants.map((participant) =>
      participant.answerRows.find((answer) => answer.questionId === row.questionId));
    const aggregate = questionAggregate(answerRows);
    const node = indexed.get(row.questionId);
    const manual = !isGradedType(row.type) || node?.autoGrade === false;
    const attention = !manual && aggregate.graded > 0 && (aggregate.accuracy ?? 100) < 60;
    return [row.questionId, { aggregate, manual, attention }] as const;
  }));
  const visibleRows = rows.filter((row) => {
    const detail = details.get(row.questionId);
    if (filter === 'attention') return detail?.attention;
    if (filter === 'manual') return detail?.manual;
    return true;
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const participants = sheet.participants.filter((participant) =>
    normalizedQuery.length === 0 || participant.name.toLocaleLowerCase().includes(normalizedQuery));
  // ⚠️ 列的**顺序**仍来自 REST 快照；搜索只做可见列过滤，不改变真实矩阵。
  const participantIds = participants.map((participant) => participant.participantId);
  const totalSubmissions = rows.reduce((sum, row) => sum + rowTally(row).submitted, 0);
  const manualCount = [...details.values()].filter((detail) => detail.manual).length;
  const attentionCount = [...details.values()].filter((detail) => detail.attention).length;
  const focusRow = stuckId ? rows.find((row) => row.questionId === stuckId) : rows.find((row) => details.get(row.questionId)?.attention);
  const focusDetail = focusRow ? details.get(focusRow.questionId) : undefined;

  return (
    <section className={styles.sheet}>
      <div className={styles.sheetHeader}>
        <div>
          <h3>《{title}》</h3>
          <p data-tone={headline.kind === 'stuck' ? 'warning' : undefined}>{headlineText(headline)}</p>
        </div>
      </div>

      <div className={styles.summary}>
        <div className={styles.metric}><strong>{sheet.participants.length}</strong><span>参与者</span></div>
        <div className={styles.metric}><strong>{totalSubmissions}</strong><span>已提交作答</span></div>
        <div className={styles.metric}><strong>{rows.length - manualCount}</strong><span>自动判分题</span></div>
        <div className={styles.metric} data-tone="warning"><strong>{manualCount}</strong><span>待人工分析题</span></div>
      </div>

      {focusRow && focusDetail && (
        <div className={styles.focusStrip}>
          <strong>{focusDetail.attention ? '优先关注' : '当前进度'}：{focusRow.heading}</strong>
          <span>已提交 {focusDetail.aggregate.submitted}/{focusDetail.aggregate.total}</span>
          <span>{focusDetail.manual
            ? `${focusDetail.aggregate.submitted} 份待分析`
            : focusDetail.aggregate.graded > 0
              ? `答对 ${focusDetail.aggregate.correct}/${focusDetail.aggregate.graded}`
              : '暂无判分结果'}</span>
          {focusDetail.aggregate.submitted > 0 && focusDetail.aggregate.submitted < 3 && <span>样本较少，仅供课堂观察</span>}
          <button type="button" className={styles.focusAction}
            onClick={() => onOpenQuestion(sheet.id, focusRow.questionId)}>查看该题</button>
        </div>
      )}

      <div className={styles.toolbar}>
        <input className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索学生或小组" aria-label="搜索学生或小组" />
        <button type="button" className={styles.filterButton} data-active={filter === 'all'} onClick={() => setFilter('all')}>全部题目 {rows.length}</button>
        <button type="button" className={styles.filterButton} data-active={filter === 'attention'} onClick={() => setFilter('attention')}>需要关注 {attentionCount}</button>
        <button type="button" className={styles.filterButton} data-active={filter === 'manual'} onClick={() => setFilter('manual')}>待分析 {manualCount}</button>
        <div className={styles.legend} aria-label="状态图例">
          {(Object.entries(CELL_LABEL) as Array<[CellState, string]>).map(([state, label]) => (
            <span className={styles.legendItem} key={state}>
              <i className={styles.legendDot} style={{ '--cell-color': CELL_COLOR[state] } as CSSProperties} />{label}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.tableShell}>
        {participants.length === 0 || visibleRows.length === 0 ? (
          <div className={styles.noMatches}>{participants.length === 0 ? '没有找到匹配的学生或小组。' : '这个筛选条件下暂时没有题目。'}</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.corner}>题目 / 学习证据</th>
                {participants.map((participant) => (
                  <th key={participant.participantId} className={styles.participantHead} title={participant.name}>
                    <span className={styles.initial}>{participant.name.trim().slice(0, 1) || '·'}</span>
                    <span className={styles.participantName}>{participant.name}</span>
                  </th>
                ))}
                <th className={styles.aggregateHead}>已提交</th>
              </tr>
            </thead>
            <tbody>
          {/* ★ 2026-09-29（教师批图 1）：「这里要按任务进行归类，不要让同样的任务名称多次出现」。
              ⇒ 逐**段**画：段头一行（`matrixGroups` 切好的），下面才是题行。
              ⚠️ 判据（哪两行属于同一段）全在纯函数里，这里只遍历 —— 写进 JSX 的判据没有回归网，
              而它错了不报错（段头少画一次或多画一次，读起来完全正常）。 */}
          {matrixGroups(visibleRows).map((group, groupIndex) => (
            // ⚠️ key 用「段序号 + 段名」：两个**同名任务**相邻时合成一段，拿段名当 key 会撞。
            <Fragment key={`${groupIndex}:${group.taskTitle ?? ''}`}>
              {group.taskTitle !== null && (
                <tr>
                  {/* 🔴 段头也必须是**粘性左列**：横向滑到第 30 个人时，题行上只剩一个
                      「1 开心填空」—— 看不出这是哪个任务的。 */}
                  <th scope="colgroup" className={styles.groupHead}>{group.taskTitle}</th>
                  {/* ⚠️ 粘性挂在**第一格**上，其余用一格 `colSpan` 的填空铺过去 ——
                      给 `colSpan` 的那一格本身加 `position: sticky` 是没验证过的形状，
                      而「粘性左列」在本文件里已经有一套跑通的写法（表头行与题行都是它）。 */}
                  <td colSpan={participantIds.length + 1} className={styles.groupFiller} />
                </tr>
              )}
              {group.rows.map((row) => (
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
            </Fragment>
          ))}
            </tbody>
          </table>
        )}
      </div>
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
    <tr>
      {/* 🔴 行头**两行**（★ 2026-09-29，教师批图 1：「可以在下一行显示题干内容……每一行的
          高度可以适当的放大，甚至占到两到三行都没关系」）：
            第一行 `组内序号 + 题型别名`（右侧挂「分析」），第二行题干（最多两行、超出省略）。
          ⚠️ 任务名**不在这一行** —— 它在上面那条段头里（这就是批注要的「不要多次出现」）。 */}
      <th scope="row" className={styles.questionCell} data-stuck={stuck}>
        <div className={styles.questionTop}>
          {/* ⚠️ 题干与序号在**同一个**按钮里（点哪儿都是打开这道题的抽屉）；「分析」是它的
              **兄弟节点** —— 嵌 `<button>` 是非法 HTML，点它会同时触发外层。
              兄弟之间不需要 `stopPropagation`。 */}
          <button type="button" onClick={onOpenQuestion} className={styles.questionButton}>
            <span style={{ display: 'block' }}>
              <span className={styles.questionLabel}>{row.label}</span>
              {/* ★ 教师批图 1：「这里的题型使用别名」—— 画的是**学生端那套别名**
                  （`开心填空` / `慧眼选择`…，见 `worksheet-questions.ts` 的 `nickname`）。
                  🔴 正式题型名**没有丢**：挂在这一格的 `title` 上（悬浮可见）。
                  它会让人对不上教材与教研的用词，所以两件都要留着。 */}
              <span title={row.typeLabel} className={styles.typeLabel}>
                {questionTypeNickname(row.type)}
              </span>
            </span>
            {/* 题干：两行截断交给 CSS（不在这一层切字符串 —— 那会把空题干那条既有文案一起吃掉）。 */}
            <span className={styles.prompt}>{promptLabel(row.prompt)}</span>
          </button>
          {/* ★ M7a：「分析」入口 —— **只对主观题出现**。客观题本来就判分，看板的对错已经
              回答了「这题答得怎么样」，再给一个分析入口只会让教师多点一下。
              判据走 `isGradedType`（它派生自题型表的 `graded` 旗标）—— 与抽屉画不画 ✓/✗
              是**同一把尺子**；而 `graded` 那张表由 `analysis-gate-parity.test.ts` 与服务端闸门对拍。 */}
          {!isGradedType(row.type) && (
            <button type="button" onClick={onOpenAnalysis} title="看全班这道题答了什么" className={styles.analysisButton}>
              分析
            </button>
          )}
        </div>
      </th>
      {participantIds.map((participantId) => (
        <td key={participantId} className={styles.bodyCell}>
          <button type="button" onClick={() => onOpenParticipant(participantId)}
            title={`${CELL_LABEL[row.cells[participantId]]}，查看这个参与者的逐题作答`}
            className={styles.cellButton}
            style={{ '--cell-color': CELL_COLOR[row.cells[participantId]] } as CSSProperties} />
        </td>
      ))}
      <td className={styles.aggregateCell} data-stuck={stuck}>
        {tally.submitted}/{tally.total}
        {stuck && <span title="当前作答前沿"> · 关注</span>}
      </td>
    </tr>
  );
}

/** 三档颜色。**只有三档** —— 对错不在这里（规格 §3.4）。 */
// ⚠️ 键类型是 `CellState` 而不是 `string`：用 `string` 时**缺键 TS 判不出来**，
//    色块会静默变透明（审查点名的一处）。
const CELL_COLOR: Record<CellState, string> = {
  unanswered: '#e1e7ee',
  draft: '#d3a45f',
  submitted: '#6889ad',
};

const CELL_LABEL: Record<CellState, string> = {
  unanswered: '未作答',
  draft: '作答中',
  submitted: '已提交',
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
