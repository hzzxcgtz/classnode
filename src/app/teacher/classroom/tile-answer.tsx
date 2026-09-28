'use client';

import { useMemo } from 'react';
import { answerView, type AnswerView } from '@/lib/worksheet-answer-view';
import type { TileAnswer } from './worksheet-tile-state';
import { InkPreview } from './ink-preview';

/**
 * ★ 2026-09-28（教师）：「图中已有图形和文字要整体上移，留出下方最大的空间用来显示
 * 当天学生正在答题的详细动态情况，不同题型可能不同，你想想办法，适应每种题型」。
 *
 * ── 这一层与抽屉里那一层（`answer-view.tsx`）**不是同一份**，而那是刻意的 ──────
 * 抽屉有 420px 宽、可以随便展开；这一格是 **214 × 150**，扣掉状态行与方块阵之后
 * 只剩大约 90px 高。所以同一个题型在这里必须**换一种更紧的画法**：
 *
 * | 题型 | 抽屉里 | 这一格里 |
 * |---|---|---|
 * | 单选/多选/判断 | 整张选项表 + 两个记号 | **只画他勾的那几个**（+ 没勾对时补一个正确答案） |
 * | 填空 | 逐空一栏 + 正确答案 | 一列小格子（`空1 H2O`），换行排 |
 * | 问答 | 原文 | 原文，最多三行截断 |
 * | 排序 | 编号列表 + 正确顺序 | 一串 `① 甲 ② 乙` 挤在一行里 |
 * | 连线 | 两栏 + 中间的线 | 每一对一行 `水 ─ H2O`（两个字的宽度画不出两栏） |
 * | 归类 | 每个框一张卡 | 每个框一行 `哺乳类：猫、狗` |
 * | 绘图 | 整幅图 | **同一个 `InkPreview`**，只是被下面那个框裁到只剩一块 |
 *
 * ⚠️ **本文件只画**：哪一种、哪些条目、哪一对是错的 —— 判据全在
 * `src/lib/worksheet-answer-view.ts`（纯函数、有测试）。这里只决定「怎么挤进去」。
 *
 * 🔴 数据是**实时**的：`value` 来自看板的作答行，而 `applyLiveRows` 已经把广播带来的
 * 内容补进去了（乙档）—— 所以学生在写、教师这一格跟着变。没有那一步的话，
 * 这一块只能等 30 秒一次的快照，读起来像卡住了。
 */

const OK = '#15803d';
const BAD = '#dc2626';
const MUTED = '#64748b';
const FAINT = '#94a3b8';
const ANSWER = '#1d4ed8';

/** 小格子（填空的空、选项、连线的两端）。**一律不截断单词、整块换行。** */
const chipStyle = (color: string, filled: boolean): React.CSSProperties => ({
  fontSize: '0.625rem', lineHeight: 1.25, padding: '1px 5px', borderRadius: 5,
  border: `1px solid ${color}`,
  background: filled ? 'white' : 'transparent',
  color: '#0f172a', whiteSpace: 'nowrap', maxWidth: '100%',
  overflow: 'hidden', textOverflow: 'ellipsis',
});

function Line({ children, color = MUTED }: { children: React.ReactNode; color?: string }) {
  return <div style={{ fontSize: '0.625rem', color, lineHeight: 1.35 }}>{children}</div>;
}

export function TileAnswerBody({ answer }: { answer: TileAnswer }) {
  // ⚠️ memo：`answerView` 每次调用都返回新对象，而这一格每 30 秒会因快照更新重渲染一次。
  const view = useMemo(() => answerView(answer.node, answer.value), [answer.node, answer.value]);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minHeight: 0, overflow: 'hidden' }}>{renderCompact(view)}</div>;
}

function renderCompact(view: AnswerView): React.ReactNode {
  switch (view.kind) {
    // 未作答：一句短的。**不画空框** —— 空框与「他写了但读不出来」长得一样。
    case 'none':
      return <Line color={FAINT}>还没开始写</Line>;

    case 'text':
      return (
        <div style={{
          fontSize: '0.625rem', color: '#0f172a', lineHeight: 1.3, wordBreak: 'break-word',
          display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{view.text}</div>
      );

    case 'ink':
      // 一幅画在这一格里只能给一块固定高度的窗口（按宽度缩放的话 4:3 的图会高过整格）。
      return view.ink ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', borderRadius: 4, border: '1px solid #e2e8f0' }}>
          <InkPreview value={view.ink} />
        </div>
      ) : <Line color={FAINT}>读不出这幅画</Line>;

    case 'choice': {
      // 只画**他勾的**那几个：整张表在这一格里放不下，而他没勾的选项对教师没有信息量。
      const picked = view.options.filter((option) => option.picked);
      const missedCorrect = view.options.filter((option) => option.correct && !option.picked);
      return (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {picked.length === 0
              ? <Line color={FAINT}>还没选</Line>
              : picked.map((option) => (
                <span key={option.key} style={chipStyle(option.correct ? OK : BAD, true)}>
                  <span style={{ color: option.correct ? OK : BAD, fontWeight: 700 }}>{option.correct ? '✓' : '✗'}</span>
                  {' '}{option.key}. {option.text || option.key}
                </span>
              ))}
          </div>
          {/* 他勾错了 ⇒ 把**正确答案**补在下面（教师一眼看到「应该选什么」）。
              勾对了就不补 —— 那是噪声，而这一格每一行都贵。 */}
          {picked.length > 0 && missedCorrect.length > 0 && (
            <Line color={ANSWER}>正确：{missedCorrect.map((option) => `${option.key}. ${option.text}`).join('、')}</Line>
          )}
        </>
      );
    }

    case 'fill': {
      const filled = view.blanks.filter((blank) => blank.text.trim());
      // 表格填空：这一格画不下一张表 ⇒ 把值按空序排出来（表格那一屏在抽屉里）。
      return (
        <>
          {filled.length === 0
            ? <Line color={FAINT}>还没填</Line>
            : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {filled.map((blank) => (
                  <span key={blank.label} style={chipStyle('#e2e8f0', true)}>
                    <span style={{ color: FAINT }}>{blank.label.replace('第 ', '').replace(' 空', '空')}</span> {blank.text}
                  </span>
                ))}
              </div>
            )}
          {view.hasTable && <Line color={FAINT}>（这道题带表格）</Line>}
        </>
      );
    }

    case 'order':
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {view.student.length === 0
            ? <Line color={FAINT}>还没排</Line>
            : view.student.map((text, index) => (
              <span key={index} style={chipStyle('#e2e8f0', true)}>
                <span style={{ color: MUTED }}>{index + 1}</span> {text}
              </span>
            ))}
        </div>
      );

    case 'match': {
      const wrong = view.links.filter((link) => !link.ok).length;
      return (
        <>
          {view.links.length === 0
            ? <Line color={FAINT}>还没连</Line>
            : view.links.map((link, index) => (
              <div key={index} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: '0.625rem', color: link.ok ? '#0f172a' : BAD,
              }}>
                <span style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {textOrId(view.left, link.leftId)}
                </span>
                <span aria-hidden style={{
                  flex: '0 0 18px', height: 2, alignSelf: 'center',
                  background: link.ok ? OK : BAD,
                  ...(link.ok ? {} : { background: 'transparent', backgroundImage: `repeating-linear-gradient(90deg, ${BAD} 0 3px, transparent 3px 6px)` }),
                }} />
                <span style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {textOrId(view.right, link.rightId)}
                </span>
              </div>
            ))}
          {/* 数目就够了 —— 这一格画不下那些虚线，而「漏了 2 条」是教师此刻要知道的。 */}
          {(wrong > 0 || view.missed.length > 0) && (
            <Line color={wrong > 0 ? BAD : FAINT}>
              {wrong > 0 && `${wrong} 条连错`}
              {wrong > 0 && view.missed.length > 0 && ' · '}
              {view.missed.length > 0 && `漏连 ${view.missed.length} 条`}
            </Line>
          )}
        </>
      );
    }

    case 'categorize':
      return (
        <>
          {view.zones.filter((zone) => zone.items.length > 0).map((zone) => (
            <Line key={zone.id}>
              <span style={{ color: MUTED }}>{zone.label}：</span>
              {zone.items.map((item, index) => (
                <span key={index} style={{ color: item.ok ? '#0f172a' : BAD }}>
                  {index > 0 && '、'}{item.text}{!item.ok && '✗'}
                </span>
              ))}
            </Line>
          ))}
          {view.loose.length > 0 && <Line color={FAINT}>未归类：{view.loose.join('、')}</Line>}
        </>
      );

    default:
      return <Line color={FAINT}>—</Line>;
  }
}

/** 条目文字查不到就退回 id（与呈现层同一条纪律：不显示空白）。 */
function textOrId(entries: ReadonlyArray<{ id: string; text: string }>, id: string): string {
  return entries.filter((entry) => entry.id === id)[0]?.text || id;
}
