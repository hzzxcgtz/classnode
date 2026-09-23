'use client';

import type { WorksheetCellStatus, WorksheetTileState } from './worksheet-tile-state';

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
  draft: { background: '#fbbf24', border: '#f59e0b', label: '作答中' },
  submitted: { background: '#2563eb', border: '#1d4ed8', label: '已提交' },
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
      return state.index === null
        ? '正在作答'
        : `正在做 第 ${state.index + 1} 题${state.typeLabel ? ` · ${state.typeLabel}` : ''}`;
    case 'stuck':
      return state.index === null
        ? `停住了 · ${state.minutes} 分钟`
        : `停在第 ${state.index + 1} 题 · ${state.minutes} 分钟`;
    case 'all-submitted':
      return `✓ ${state.cells.length} 题已全部提交`;
    default:
      return '';
  }
}

/** 那行大字与方格阵的底色（只有「停住了」是琥珀）。 */
function stateTone(state: WorksheetTileState): { background: string; border: string; color: string } {
  if (state.kind === 'stuck') return { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' };
  if (state.kind === 'all-submitted') return { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' };
  return { background: '#f8fafc', border: '1px solid #eef2f6', color: '#1e293b' };
}

export function WorksheetTileContent({ state, compact }: {
  state: WorksheetTileState;
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
    // （没有拉取历史的 REST 端点，见 `worksheet-tile-state.ts` 的注释），
    // 教师刷新一次页面，早就做完的学生也会落到这一态。说「还没开始」就是编了一个假事实。
    // 第二行把这个局限说明白 —— 它同时解释了「为什么这个格子不动」。
    case 'no-progress':
      return placeholder('还没收到作答', '打开看板后的新作答会实时显示', compact);

    // ── 四态里剩下的三态：一行大字 + 方格阵 ───────────────────────────────
    case 'working':
    case 'stuck':
    case 'all-submitted': {
      const tone = stateTone(state);
      return (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: compact ? 5 : 7, padding: compact ? '6px 8px' : '8px 10px', borderRadius: compact ? 6 : 8, background: tone.background, border: tone.border }}>
          <div style={{ fontSize: compact ? '0.688rem' : '0.813rem', fontWeight: 700, color: tone.color, lineHeight: 1.3 }}>
            {stateLine(state)}
          </div>
          {/* 逐题状态方格阵。窄格子会自己换行 —— 题多的学习单只是方块多几行，不会溢出。 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {state.cells.map((status, index) => (
              <span key={index}
                title={`第 ${index + 1} 题 · ${CELL_STYLE[status].label}`}
                style={{
                  width: compact ? 11 : 14, height: compact ? 11 : 14, borderRadius: 3,
                  background: CELL_STYLE[status].background, border: `1px solid ${CELL_STYLE[status].border}`,
                }} />
            ))}
          </div>
        </div>
      );
    }

    default:
      // TS 认为不可达（联合类型已被上面穷尽）。留一条兜底是因为**线缆值**可能不在联合里：
      // 上游多出第四种模块状态时，看板不该渲染出一片空白（与 `renderTileContent` 同款兜底）。
      return placeholder('…', '学习单这一格看板还不认识', compact);
  }
}
