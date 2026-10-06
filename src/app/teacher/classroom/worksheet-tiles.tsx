'use client';

import type { TileAnswer, WorksheetCellStatus, WorksheetTileState } from './worksheet-tile-state';
import { WorksheetStatusIcon } from '@/components/worksheet-status-icon';
import { TileAnswerBody } from './tile-answer';

/**
 * 看板格子里**学习单那一格的内容区**（规格 §7.2）。
 *
 * 尺寸是实测的 **214 × 150 px**，所以：
 *   · **不带学习单标题**（§3-AE）——214px 放不下，「这份是哪张单」在抽屉里（D4）；
 *   · 只有一行大字 + 一行方格阵，没有第二种排布。
 *
 * ⚠️ 三件套里只有这一格是「状态 + 方格阵」的长相，另外两格各自有内容
 * （学伴是最近一轮 Q&A、探究空间是缩略图）。别为了「统一」把它们拉齐。
 *
 * ⚠️ **本文件只画，不判断**：状态全在 `worksheet-tile-state.ts`（纯函数、有测试）。
 * 这里只把状态映射成中文与颜色 —— 把判据写进 JSX 就没有任何回归网了（本仓没有前端测试框架）。
 */

/**
 * 方格阵里一个方块的三种长相。**只编码状态，不编码对错**（规格 §7.2）。
 *
 * 🔴 为什么没有对错：教师拿到「哪道题错得多」会去讲那道题（按题聚合在抽屉里，D4 做），
 * 而「哪个学生第 3 题错了」不是课上能当场处理的信息；五档颜色在十几像素的方块上也分不清，
 * 红绿对色觉障碍教师尤其不友好。这几种颜色还刻意选了**明度差**大的一组（灰 / 琥珀 / 蓝），
 * 而不是红绿那一组。
 */
const CELL_STYLE: Record<WorksheetCellStatus, { background: string; border: string; label: string }> = {
  unanswered: { background: '#f1f5f9', border: '#e2e8f0', label: '未答' },
  draft: { background: '#fbbf24', border: '#956834', label: '作答中' },
  submitted: { background: 'var(--primary)', border: 'var(--primary-dark)', label: '已提交' },
};

/**
 * 「这一格没有内容可显示」的长相 —— 与 `page.tsx` 里那个 `placeholder()`
 * （首页 / 状态未知两处用它）**逐字同款**：同一种东西在同一个看板上必须长同一个样子。
 * 改动请两边一起看。
 */
function placeholder(label: string, hint: string, compact: boolean) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 6px', borderRadius: compact ? 6 : 8, background: '#f9fafb', border: '1px dashed #e2e8f0', textAlign: 'center' }}>
      <span style={{ fontSize: compact ? '0.688rem' : '0.813rem', fontWeight: 600, color: '#94a3b8' }}>{label}</span>
      <span style={{ fontSize: '0.625rem', color: '#cbd5e1', lineHeight: 1.4 }}>{hint}</span>
    </div>
  );
}

/**
 * 状态那一行大字。
 *
 * ⚠️ 「停住了」那一种**只用文字与琥珀底，不用 ⚠ 图标**（规格 §3-AD）：徽章行上已经有一个
 * ⚠ 表示屏蔽词警告次数，同一个位置上再来一个 ⚠，教师分不清「这个学生说了脏话」还是
 * 「他卡住了」。`✓` 可以（它不是警告，是「交齐了」），也是规格 §7.2 原文里的写法。
 */
function stateLine(state: WorksheetTileState): string {
  switch (state.kind) {
    case 'working':
      // 说不出哪一题时（最后作答那题已被教师删掉、也没有在答的题）**不编号码**：
      // 编一个「第 1 题」会让教师去讲一道这个学生根本没在做的题。
      // 题号是两级题号（`任务一 · 2`）**裸显示**，不再包「第 … 题」：包起来之后
      // 每一条已迁移的学习单上都会写成「第 任务一 · 2 题」。
      return state.heading === null
        ? '正在作答'
        : `正在做 ${state.heading}${state.typeLabel ? ` · ${state.typeLabel}` : ''}`;
    case 'stuck':
      return state.heading === null
        ? `停住了 · ${state.minutes} 分钟`
        : `停在 ${state.heading} · ${state.minutes} 分钟`;
    case 'all-submitted':
      return `${state.cells.length} 题已全部提交`;
    default:
      return '';
  }
}

/** 那行大字与方格阵的底色（只有「停住了」是琥珀）。 */
function stateTone(state: WorksheetTileState): { background: string; border: string; color: string } {
  if (state.kind === 'stuck') return { background: '#faf4eb', border: '1px solid #fde68a', color: '#92400e' };
  if (state.kind === 'all-submitted') return { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' };
  return { background: '#f8fafc', border: '1px solid #eef2f6', color: '#1e293b' };
}

export function WorksheetTileContent({ state, answer, compact }: {
  state: WorksheetTileState;
  /**
   * ★ 2026-09-28：下方那一块要显示的那一题（教师：「留出下方最大的空间用来显示
   * 当天学生正在答题的详细动态情况」）。`null` = 挑不出是哪一题 ⇒ 不画那一块。
   */
  answer?: TileAnswer | null;
  /** 全屏网格里格子更小、字更小 —— 与 `renderTileContent` 的同一个旋钮同义。 */
  compact: boolean;
}) {
  switch (state.kind) {
    // ── 画不出格子的那几种情形（各自的说法不同，别合成一句）──────────────
    case 'unconfigured':
      return placeholder('没有学习单', '老师没有给这一格配学习单', compact);
    case 'loading':
      return placeholder('…', '学习单内容还没加载到', compact);
    case 'empty':
      return placeholder('这份学习单还没有题目', '老师还没有出题', compact);
    // 「还没收到」而不是「还没开始作答」：看板只能看到**打开之后**发生的作答
    // （读端点有，但**格子没有消费它** —— 数据源仍然只有广播，见
    // `worksheet-tile-state.ts` 里 `WorksheetTileState` 那一段的更正），
    // 教师刷新一次页面，早就做完的学生也会落到这一态。说「还没开始」就是编了一个假事实。
    // 第二行把这个局限说明白 —— 它同时解释了「为什么这个格子不动」。
    case 'no-progress':
      return placeholder('还没收到作答', '打开看板后的新作答会实时显示', compact);

    // ── 四态里剩下的三态：一行大字 + 方格阵 + **下方：他此刻那一题的作答** ──────
    case 'working':
    case 'stuck':
    case 'all-submitted': {
      const tone = stateTone(state);
      return (
        // ★ 2026-09-28（教师）：「已有图形和文字要整体上移，留出下方最大的空间用来显示
        // 当天学生正在答题的详细动态情况」。
        // ⇒ `justifyContent` 从 `center` 改成 `flex-start`（内容靠上），
        //   下面那一块吃满剩余高度（`flex: 1`）。
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: compact ? 4 : 5, padding: compact ? '6px 8px' : '8px 10px', borderRadius: compact ? 6 : 8, background: tone.background, border: tone.border }}>
          {/* 上面这一块**不许被压**（`flexShrink: 0`）：状态那一行是这一格的标题，
              被下面的预览挤掉的话，教师就不知道下面那块是谁的作答了。 */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: compact ? 4 : 5 }}>
          <div style={{ fontSize: compact ? '0.688rem' : '0.813rem', fontWeight: 700, color: tone.color, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 5 }}>
            {state.kind === 'all-submitted' && <WorksheetStatusIcon name="completed" size={compact ? 14 : 16} />}
            {state.kind === 'working' && <WorksheetStatusIcon name="drafting" size={compact ? 14 : 16} />}
            {stateLine(state)}
          </div>
          {/* 逐题状态方格阵。窄格子会自己换行 —— 题多的学习单只是方块多几行，不会溢出。 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3 }}>
            {/* ⚠️ 题号取自判据层的 `headings`（与 `cells` 同源），**不在这里现算** ——
                现算就是又一份真源：第二级任务的第一道题会写着「第 3 题」，而同一屏上
                抽屉/矩阵/学生端说的是「任务二 · 1」。 */}
            {state.cells.map((status, index) => (
              <span key={index}
                title={`${state.headings[index]} · ${CELL_STYLE[status].label}`}
                style={{
                  width: compact ? 11 : 14, height: compact ? 11 : 14, borderRadius: 3,
                  background: CELL_STYLE[status].background, border: `1px solid ${CELL_STYLE[status].border}`,
                }} />
            ))}
            {/* ⊘ 2026-10-06（教师截图批注）：「奖励移到上面去」——这一枚原来住在这一行的**右端**
                （下面那整段「位置是算过的」的来历随之作废，见 git 历史）。
                ⇒ 现在画在**卡片最上面那一行**（名字右侧、与「在线 / 学」同排），
                由 `page.tsx` 的 `tileRewardOf` + 卡头那两处 JSX 负责 —— 这一格
                **不再接收 `reward` 这个 prop**（少一条会漂移的输入）。
                ⚠️ 顺手消掉的老问题：窄格子时它会被挤到**第二行**（多 14px）—— 那正是
                教师这次截图里看到的形状；挪到卡头之后这一格只剩方格阵。 */}
          </div>
          </div>
          {/* ★ 下方：**他此刻正在做的那一题**的实时作答（逐题型换画法，见 `tile-answer.tsx`）。
              🔴 只有真的挑得出那一题时才画（`answer` 为 `null` = 说不出来是哪一题）——
              那时**不预览**，而不是随便挑一道（与正文「不编题号」同一条纪律）。 */}
            {/* ★ 2026-09-29（教师）：「学习单内容如果比较长，则**自动加上垂直滚动条，与智能学伴一致**。」
                ⇒ 走学伴那一格同一个类（`preview-scroll`：细滚动条 + `scrollbar-width: thin`，
                定义在 `page.tsx` 顶部那个 `<style>` 里），并把 `overflow: 'hidden'`
                换成 `overflowY: 'auto'`。
                ⚠️ 光换 `overflow` 是不够的：这一层是 column flex，子项默认 `flex-shrink: 1`
                会被压到能塞下为止（那就不需要滚动条了，内容直接被切掉）——
                所以 `TileAnswerBody` 那一层加了 `flexShrink: 0`（见那个文件）。
                ⚠️ 学伴那一格是**结果条下面整块**可滚；这一格只让**作答内容**滚 ——
                上面那行大字与方格阵是这一格的标题，滚走之后教师就不知道下面是谁的作答了。 */}
          {answer && (
            <div className="preview-scroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px dashed #e2e8f0', paddingTop: 4, overflowY: 'auto' }}>
              {/* 🔴 「全部提交」那一态的正文字说的是「✓ 8 题已全部提交」，**没有题号** ——
                  下面这块得自己说清是哪一题。其余两态的正文字已经带题号了，再说一遍是重复。
                  ★ 2026-09-29：「正在写」那个记号**搬去上面方格阵那一行的右端了**
                  （教师：「目前所在的位置不是很好，会导致监控内容在显示的时候上下跳动」）——
                  它原来就住在这一行，而这一行在 working / stuck 两态下**没有文字、高度是 0**
                  ⇒ 记号一来整行长高、下面那块预览跟着往下跳。搬走之后这一行只剩标题文字。 */}
              {state.kind === 'all-submitted' && (
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.625rem', color: '#64748b', overflow: 'hidden' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {answer.heading} · {answer.typeLabel}
                  </span>
                </div>
              )}
              <TileAnswerBody answer={answer} />
            </div>
          )}
        </div>
      );
    }

    default:
      // TS 认为不可达（联合类型已被上面穷尽）。留一条兜底是因为**线缆值**可能不在联合里：
      // 上游多出第四种模块状态时，看板不该渲染出一片空白（与 `renderTileContent` 同款兜底）。
      return placeholder('…', '学习单这一格看板还不认识', compact);
  }
}
