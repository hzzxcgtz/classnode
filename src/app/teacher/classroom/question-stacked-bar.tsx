'use client';

import type { QuestionStats } from './worksheet-question-stats';

// 与浮层、抽屉各处同源的一组颜色。
const OK = '#15803d';
const BAD = '#dc2626';
const WARN = '#b45309';
const BLUE = '#1d4ed8';
const MUTED = '#64748b';
const FAINT = '#94a3b8';

/**
 * 逐题的**分布条**（★ 2026-09-28，规格 `specs/2026-09-28-按题统计与分析.md` §2）。
 *
 * 🔴 **为什么单独一个文件**（不是口味）：它被**两处**用 —— 题列表里那一条迷你版
 * （`worksheet-drawer.tsx`）与按题统计浮层的页头（`question-stats-overlay.tsx`）——
 * 而浮层又要复用抽屉里的 `QuestionAnswers`。留在浮层那个文件里就会形成
 * `drawer → overlay → drawer` 的**循环 import**（本批已经为 `InkPreview` 拆过一次，
 * 同一条理由：ESM 能跑，但组件之间的循环在 Fast Refresh / 条件渲染下会出很难查的问题）。
 *
 * 🔴 **两处必须走同一个函数**（`questionStats` 的分档计数）—— 各数一份的表现是
 * 「题列表说 3 人全对、点进去说 4 人」，而**没有人会去核对这两个数**。
 */

/** 堆叠条的五个分段（顺序 = 图例顺序 = 计数顺序）。**颜色只是辅助，数字一律写出来**。 */
const SEGMENTS = [
  { key: 'correct', label: '全对', color: OK },
  { key: 'partial', label: '部分给分', color: WARN },
  { key: 'wrong', label: '答错', color: BAD },
  { key: 'noVerdict', label: '已提交（无对错）', color: BLUE },
  { key: 'unanswered', label: '未作答', color: '#e2e8f0' },
] as const;

function segmentCount(stats: QuestionStats, key: typeof SEGMENTS[number]['key']): number {
  return key === 'correct' ? stats.correct
    : key === 'partial' ? stats.partial
      : key === 'wrong' ? stats.wrong
        : key === 'noVerdict' ? stats.noVerdict
          : stats.unanswered;
}

/**
 * 堆叠条。`compact` 是题列表里那条迷你版（无文字、更矮）。
 *
 * 🔴 **它和页头那条走的是同一个函数**（`questionStats` 的分档计数）——
 * 各数一份的表现是「题列表说 3 人全对、点进去说 4 人」，而没有人会去核对这两个数。
 */
export function StackedBar({ stats, compact = false }: { stats: QuestionStats; compact?: boolean }) {
  const total = Math.max(1, stats.total);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 0 : 4 }}>
      <div style={{ display: 'flex', height: compact ? 6 : 10, borderRadius: 999, overflow: 'hidden', background: '#f1f5f9' }}>
        {SEGMENTS.map((segment) => {
          const count = segmentCount(stats, segment.key);
          if (count === 0) return null;
          return (
            <div key={segment.key} title={`${segment.label} ${count}`}
              style={{ width: `${(count / total) * 100}%`, background: segment.color }} />
          );
        })}
      </div>
      {!compact && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: '0.688rem', color: MUTED }}>
          {SEGMENTS.map((segment) => (
            <span key={segment.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: segment.color, display: 'inline-block' }} />
              {segment.label} <b style={{ color: segmentCount(stats, segment.key) > 0 ? '#0f172a' : FAINT }}>{segmentCount(stats, segment.key)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
