'use client';

import { useMemo } from 'react';
import { answerView, type AnswerView } from '@/lib/worksheet-answer-view';
import { WorksheetTableView } from '@/lib/worksheet-table-view';
import type { WorksheetQuestionNode } from '@/lib/types';
import { InkPreview } from './ink-preview';

/**
 * 逐题型的**作答呈现**（★ 2026-09-28，教师：「看到的答题信息过于简单……比如连线题
 * 就应该左右框加上中间的线」）。
 *
 * ⚠️ **本文件只画，一个判据都没有**：哪一种题型画成什么样、哪一对连线是错的、
 * 哪些条目漏了 —— 全在 `src/lib/worksheet-answer-view.ts`（纯函数、被 `node --test` 跑）。
 * 把判据写进 JSX 就没有任何回归网了（本仓没有前端测试框架）—— 与 `worksheet-drawer.tsx`
 * / `worksheet-tiles.tsx` 同一条铁律。
 *
 * ── 配色（与抽屉其余各处同源）────────────────────────────────────────
 *   · `#15803d` 对 / `#dc2626` 错 / `#b45309` 部分与提醒 / `#64748b` 中性 / `#94a3b8` 空。
 *   「正确答案」一律用**中性蓝**（`#1d4ed8`）而不是绿色 —— 绿色在抽屉里已经占了
 *   「判对」这个意思，再用它标正确答案会让「他答对了」与「这是答案」分不开。
 */

const OK = '#15803d';
const BAD = '#dc2626';
const WARN = '#b45309';
const MUTED = '#64748b';
const FAINT = '#94a3b8';
const ANSWER = '#1d4ed8';

/** 学生写的字那一层「底」。填空 / 问答共用，让「他写了什么」一眼能框出来。 */
const answerBox: React.CSSProperties = {
  fontSize: '0.813rem', color: '#0f172a', background: '#f8fafc',
  border: '1px solid #eef2f6', borderRadius: 6, padding: '5px 8px',
  wordBreak: 'break-word', whiteSpace: 'pre-wrap',
};

function Empty() {
  return <span style={{ fontSize: '0.813rem', color: FAINT }}>未作答</span>;
}

export function AnswerViewBody({ node, value }: { node: WorksheetQuestionNode; value: unknown }) {
  // ⚠️ **必须 memo**：`answerView` 每次调用都返回一个新对象，而下面有些渲染分支
  // 用它做 `useMemo`/依赖。不 memo 的话每次父组件重渲染都会产生一份新的呈现模型。
  const view = useMemo(() => answerView(node, value), [node, value]);
  return <>{renderView(node, view)}</>;
}

function renderView(node: WorksheetQuestionNode, view: AnswerView) {
  switch (view.kind) {
    case 'none':
      return <Empty />;

    case 'text':
      return <div style={answerBox}>{view.text}</div>;

    case 'ink':
      // 值是笔迹、但读不出画布（手改过的行）——**如实说**，不画一个空框
      //（空框与「他画了东西但读不出来」长得一模一样）。
      return view.ink
        ? <InkPreview value={view.ink} />
        : <span style={{ fontSize: '0.813rem', color: FAINT }}>读不出这幅画</span>;

    case 'choice':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {view.options.map((option) => (
            <div key={option.key} style={{
              display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.813rem',
              padding: '4px 8px', borderRadius: 6,
              // 学生勾了的那个有明显的底；没勾的什么都不加（不是「灰掉」——
              // 灰会读成「不可选」，而这些选项都是可选的）。
              background: option.picked ? (option.correct ? '#f0fdf4' : '#fef2f2') : 'transparent',
              border: `1px solid ${option.picked ? (option.correct ? '#bbf7d0' : '#fecaca') : 'transparent'}`,
            }}>
              {/* 两件事各一个记号：**左边**说「学生勾没勾」（✓/空），
                  **右边**说「它是不是答案」（`正确答案` 三个字）。
                  用同一个记号表达两件事的话，「他答对了」与「这是答案」就分不开了。 */}
              <span style={{ width: 12, flexShrink: 0, color: option.picked ? (option.correct ? OK : BAD) : 'transparent', fontWeight: 700 }}>
                {option.picked ? (option.correct ? '✓' : '✗') : '·'}
              </span>
              <span style={{ color: option.picked ? '#0f172a' : MUTED, fontWeight: option.picked ? 600 : 400 }}>
                {option.key}. {option.text || <span style={{ color: FAINT }}>（这个选项还没写内容）</span>}
              </span>
              {option.correct && (
                <span style={{ marginLeft: 'auto', fontSize: '0.688rem', color: ANSWER, flexShrink: 0 }}>正确答案</span>
              )}
            </div>
          ))}
        </div>
      );

    case 'fill':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {view.blanks.map((blank, index) => (
            <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: '0.688rem', color: MUTED }}>
                <span>{blank.label}</span>
                {/* 🔴 `accepted` 为空 ⇒ **不画**这一栏。画一个空的会读成「标准答案是空的」，
                    而事实是老师**没填**标准答案（关掉自动评分时这是合法的）。 */}
                {blank.accepted.length > 0 && (
                  <span style={{ marginLeft: 'auto', color: ANSWER }}>
                    正确答案：{blank.accepted.join(' / ')}
                  </span>
                )}
              </div>
              {blank.text.trim()
                ? <div style={answerBox}>{blank.text}</div>
                : <span style={{ fontSize: '0.813rem', color: FAINT }}>（这一空留空了）</span>}
            </div>
          ))}
          {/* 表格填空：**复用学生端那个共享渲染器**（`WorksheetTableView`），
              只读 —— 传一对空动作。它的 `wrongOf` 这里不传：服务端只把「答错的那几格」
              发给学生，看板这一侧的作答行里根本没有那个信息，
              拿它当判据会画出一张**一个都没错**的表（比不画更坏）。 */}
          {view.hasTable && (
            <div style={{ fontSize: '0.813rem' }}>
              <WorksheetTableView
                table={(node.data as Record<string, unknown> | undefined)?.table}
                blanks={{
                  values: view.texts,
                  base: view.tableBase,
                  onChange: () => {},
                  disabled: true,
                }}
              />
            </div>
          )}
        </div>
      );

    case 'order':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {view.student.map((text, index) => (
              <li key={index} style={{ display: 'flex', alignItems: 'center', gap: 7, ...answerBox, padding: '4px 8px' }}>
                <span style={{ width: 16, flexShrink: 0, color: MUTED, fontSize: '0.688rem' }}>{index + 1}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
          {/* 🔴 正确的顺序**另列一栏**，不逐位标对错：排序的判分带容差（服务端
              `judgeOrder(…, tolerance)`），在客户端复刻一份就是第二份判分实现。 */}
          {view.correct.length > 0 && (
            <div style={{ fontSize: '0.688rem', color: ANSWER }}>
              正确顺序：{view.correct.join(' → ')}
            </div>
          )}
        </div>
      );

    case 'match':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* 🔴 **一对一行**：左框 ── 线 ── 右框。
              这样画的好处是**完全不需要测量 DOM** —— 线就是这一行里的一个连接件。
              按「左右两栏 + 绝对定位的 SVG」那种画法则要量每个盒子的位置，
              而「量完 setState → 重渲染 → 再量」正是这一晚把学生端搞成假死的那类回路。
              代价：一对多时同一个左框会在多行里各出现一次 —— 在 420px 的抽屉里
              那反而比一张密集的线网好读。 */}
          {view.links.map((link, index) => {
            const left = view.left.filter((entry) => entry.id === link.leftId)[0];
            const right = view.right.filter((entry) => entry.id === link.rightId)[0];
            return (
              <div key={`${link.leftId}-${link.rightId}-${index}`} style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
                <div style={chip(link.ok ? OK : BAD)}>{textOrId(left?.text, link.leftId)}</div>
                <div aria-hidden style={{
                  flex: '0 0 46px', alignSelf: 'center', height: 2,
                  background: link.ok ? OK : BAD,
                  // 错的那几条画成虚线：颜色之外再给一个不依赖色觉的信号
                  //（教师里可能有色觉障碍，而红绿是最不该独占的一组）。
                  ...(link.ok ? {} : { backgroundImage: `repeating-linear-gradient(90deg, ${BAD} 0 4px, transparent 4px 8px)`, background: 'transparent' }),
                }} />
                <div style={chip(link.ok ? OK : BAD)}>{textOrId(right?.text, link.rightId)}</div>
                <span style={{ marginLeft: 6, alignSelf: 'center', fontSize: '0.688rem', color: link.ok ? OK : BAD }}>
                  {link.ok ? '✓' : '✗'}
                </span>
              </div>
            );
          })}
          {/* 正确答案里、学生没连的那几对。**画出来**而不是只说一句「有漏连」——
              教师要看的是「漏了哪一条」。 */}
          {view.missed.map((pair, index) => (
            <div key={`missed-${pair.leftId}-${pair.rightId}-${index}`} style={{ display: 'flex', alignItems: 'stretch', opacity: 0.75 }}>
              <div style={chip(FAINT)}>{textOrId(view.left.filter((entry) => entry.id === pair.leftId)[0]?.text, pair.leftId)}</div>
              <div aria-hidden style={{ flex: '0 0 46px', alignSelf: 'center', borderTop: `2px dashed ${FAINT}` }} />
              <div style={chip(FAINT)}>{textOrId(view.right.filter((entry) => entry.id === pair.rightId)[0]?.text, pair.rightId)}</div>
              <span style={{ marginLeft: 6, alignSelf: 'center', fontSize: '0.688rem', color: FAINT }}>漏连</span>
            </div>
          ))}
          {/* 一条线都没有、也没有可漏的（正确答案是空的）⇒ 如实说。 */}
          {view.links.length === 0 && view.missed.length === 0 && (
            <span style={{ fontSize: '0.813rem', color: FAINT }}>这一题没有可显示的连线</span>
          )}
        </div>
      );

    case 'categorize':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {view.zones.map((zone) => (
            <div key={zone.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px' }}>
              <div style={{ fontSize: '0.688rem', color: MUTED, marginBottom: 4 }}>{zone.label}</div>
              {zone.items.length === 0
                ? <span style={{ fontSize: '0.75rem', color: FAINT }}>（这个框他一条都没放）</span>
                : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {zone.items.map((item, index) => (
                      <span key={index} style={chip(item.ok ? OK : BAD)}>{item.text}</span>
                    ))}
                  </div>
                )}
            </div>
          ))}
          {/* 没归到任何框里的条目。⚠️ 一条都没归的情况在上面就落成「未作答」了
              （`answerView` 的 `isDraftEmpty`），所以走到这里说明至少归了一条 ——
              这一行说的是「剩下这些他留在了外面」，而不是「他什么都没做」。 */}
          {view.loose.length > 0 && (
            <div style={{ fontSize: '0.75rem', color: WARN }}>
              未归类：{view.loose.join('、')}
            </div>
          )}
        </div>
      );

    default:
      return <Empty />;
  }
}

/**
 * 条目框（连线题的左右框、归类题的词）。**颜色只由对错决定**，见各自的调用处。
 *
 * 🔴 **故意允许换行、不截断。** 抽屉宽 420px，一行里两个框各只有约 165px ——
 * 用 `nowrap + ellipsis` 的话「二氧化碳」这种长条目直接被截掉，而教师点开这一屏
 * 要看的**正是那个词**。行高不一致在这里没有代价：连线的画法是「一对一行」，
 * 线是行内的连接件，**不依赖任何测量**（见 `match` 那一支的注释）。
 */
function chip(color: string): React.CSSProperties {
  return {
    flex: '1 1 0', minWidth: 0, fontSize: '0.75rem', color: '#0f172a',
    border: `1px solid ${color}`, borderRadius: 6, padding: '4px 7px',
    wordBreak: 'break-word',
  };
}

/** 条目文字查不到就退回 id（与呈现层同一条纪律：不显示空白）。 */
function textOrId(text: string | undefined, id: string): string {
  return text || id;
}
