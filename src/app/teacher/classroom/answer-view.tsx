'use client';

import { useMemo } from 'react';
import { answerView, matchLineGeometry, type AnswerView } from '@/lib/worksheet-answer-view';
import { WorksheetTableView } from '@/lib/worksheet-table-view';
// ★ 2026-09-30：题面文本里的数学公式（选项 / 标准答案 / 左右项 / 框名 / 条目）。
// 🔴 **只包「教师写的原文」**：本文件里 `view.text` / `blank.text` / `view.texts` 那些是
//    **学生填的答案**，学生打的字里 `$` 没有公式语义（裁定 ④）⇒ 一律**不**包。
//    这两种文本混在同一个组件里，改错一处不会报错，只会让某个学生的答案突然变成公式。
import { PromptText } from '@/lib/worksheet-prompt-text';
import type { WorksheetQuestionNode } from '@/lib/types';
import { WorksheetStatusIcon } from '@/components/worksheet-status-icon';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
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
 *   · `#15803d` 对 / `#934e4e` 错 / `#b45309` 部分与提醒 / `#64748b` 中性 / `#94a3b8` 空。
 *   「正确答案」一律用**中性蓝**（`var(--primary-dark)`）而不是绿色 —— 绿色在抽屉里已经占了
 *   「判对」这个意思，再用它标正确答案会让「他答对了」与「这是答案」分不开。
 */

const OK = '#15803d';
const BAD = '#934e4e';
const WARN = '#b45309';
const MUTED = '#64748b';
const FAINT = '#94a3b8';
const ANSWER = 'var(--primary-dark)';

/**
 * 连线题的行距与中间那条通道的宽度。
 *
 * 🔴 **行高必须是固定的** —— 这是「不测量 DOM 也能画线」的全部依据：两栏各按原题顺序排，
 * 每个盒子的纵坐标由**下标**算出来（`matchLineGeometry`，纯函数、有测试）。
 * 按内容自适应行高的话位置就只能量，而「量完 setState → 再量」正是这一晚把学生端
 * 搞成假死的那类回路。⚠️ 代价：太长的条目会被**截断**（下面用两行截断兜着）。
 */
const MATCH_ROW = { rowHeight: 38, gap: 6, gutter: 46 } as const;

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
        ? <InkPreview value={view.ink} node={node} />
        : <span style={{ fontSize: '0.813rem', color: FAINT }}>读不出这幅画</span>;

    case 'photo':
      return (
        <img
          src={worksheetAssetUrl(view.url)}
          alt="学生上传的作答照片"
          style={{ display: 'block', width: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 8, border: '1px solid #dbe5ef', background: '#f8fafc' }}
        />
      );

    case 'choice':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {view.options.map((option) => (
            <div key={option.key} style={{
              display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.813rem',
              padding: '4px 8px', borderRadius: 6,
              // 学生勾了的那个有明显的底；没勾的什么都不加（不是「灰掉」——
              // 灰会读成「不可选」，而这些选项都是可选的）。
              background: option.picked ? (option.correct ? '#f0fdf4' : '#f8eeee') : 'transparent',
              border: `1px solid ${option.picked ? (option.correct ? '#bbf7d0' : '#fecaca') : 'transparent'}`,
            }}>
              {/* 两件事各一个记号：**左边**说「学生勾没勾」（✓/空），
                  **右边**说「它是不是答案」（`正确答案` 三个字）。
                  用同一个记号表达两件事的话，「他答对了」与「这是答案」就分不开了。 */}
              <span style={{ width: 16, height: 16, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {option.picked ? <WorksheetStatusIcon name={option.correct ? 'correct' : 'retry'} size={15} /> : null}
              </span>
              <span style={{ color: option.picked ? '#0f172a' : MUTED, fontWeight: option.picked ? 600 : 400 }}>
                {/* ★ 2026-09-30：选项是**教师原文** ⇒ 认公式。
                    ⚠️ 同一行左边的 `option.picked` 是**学生勾没勾**，两回事。 */}
                {option.key}. {option.text
                  ? <PromptText text={option.text} placeholder="" />
                  : <span style={{ color: FAINT }}>（这个选项还没写内容）</span>}
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
                    {/* ★ 2026-09-30：`accepted` 是**教师写的**标准答案 ⇒ 认公式。
                        ⚠️ 别与下面 `blank.text`（学生填的）搞混 —— 那个是纯文本。 */}
                    正确答案：<PromptText text={blank.accepted.join(' / ')} placeholder="" />
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
              {/* ★ 2026-09-30：正确顺序里是**教师的条目原文** ⇒ 认公式。
                  （⚠️ 上面那个 `<ol>` 里的 `{text}` 是**学生的顺序**，不是这里。） */}
              正确顺序：<PromptText text={view.correct.join(' → ')} placeholder="" />
            </div>
          )}
        </div>
      );

    case 'match': {
      // 🔴 **两栏各自按原题顺序排**（教师：「左框和右框中的顺序不能变，要按照原题中的顺序」）。
      // 线画在中间那条通道里 —— 它的坐标系只有 0..gutter 那么宽，所以横坐标是常数、
      // 纵坐标由下标算，**整段没有一个测量**。
      const solid = matchLineGeometry(view.left, view.right, view.links, MATCH_ROW);
      // 「漏连」也画成线（虚线灰）：教师要看的是**漏了哪一条**，不是「有漏连」三个字。
      const missing = matchLineGeometry(
        view.left, view.right,
        view.missed.map((pair) => ({ ...pair, ok: true })),
        MATCH_ROW,
      );
      const height = solid.height;
      // 一条线都没有、两栏也空 ⇒ 如实说（题面本身就是空的）。
      if (view.left.length === 0 && view.right.length === 0) {
        return <span style={{ fontSize: '0.813rem', color: FAINT }}>这一题没有可显示的连线</span>;
      }
      const wrong = solid.lines.filter((line) => !line.ok).length;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: MATCH_ROW.gap }}>
            {view.left.map((entry) => (
              <div key={entry.id} style={rowBox}>
                {/* ★ 2026-09-30：连线**左右项**是教师原文 ⇒ 认公式。
                    ⚠️ 文本为空时仍然回落成 id（`textOrId` 原来那一条路），行为不变。 */}
                {entry.text
                  ? <PromptText text={entry.text} placeholder="" />
                  : textOrId(entry.text, entry.id)}
              </div>
            ))}
          </div>
          {/* 中间那条通道。⚠️ 它的高度必须与两栏算出来的高度**一致**，否则线会错位 ——
              而它由 `matchLineGeometry` 同一个函数给出，不是这里另算一份。 */}
          <div style={{ flex: `0 0 ${MATCH_ROW.gutter}px`, position: 'relative', height }}>
            <svg width={MATCH_ROW.gutter} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
              {missing.lines.map((line, index) => (
                <line key={`m${index}`} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                  stroke={FAINT} strokeWidth={2} strokeDasharray="4 4" />
              ))}
              {solid.lines.map((line, index) => (
                <line key={`s${index}`} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                  // ⚠️ 错的那几条**只靠虚线区分、不用第二种颜色**：颜色之外再给一个
                  // 不依赖色觉的信号（教师里可能有色觉障碍，而红绿是最不该独占的一组）。
                  stroke={line.ok ? OK : BAD} strokeWidth={2}
                  strokeDasharray={line.ok ? undefined : '4 4'} />
              ))}
            </svg>
          </div>
          <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: MATCH_ROW.gap }}>
            {view.right.map((entry) => (
              <div key={entry.id} style={rowBox}>
                {/* ★ 2026-09-30：连线**左右项**是教师原文 ⇒ 认公式。
                    ⚠️ 文本为空时仍然回落成 id（`textOrId` 原来那一条路），行为不变。 */}
                {entry.text
                  ? <PromptText text={entry.text} placeholder="" />
                  : textOrId(entry.text, entry.id)}
              </div>
            ))}
          </div>
        </div>
        {/* 说明只在**真的需要**时出现（有线可看时才说线是什么）——
            每次都给一段图例是噪声，而教师一天要看几十遍这一屏。 */}
        {(wrong > 0 || view.missed.length > 0) && (
          <div style={{ fontSize: '0.688rem', color: MUTED }}>
            {wrong > 0 && <span style={{ color: BAD }}>红色虚线是他连错的（{wrong} 条）</span>}
            {wrong > 0 && view.missed.length > 0 && ' · '}
            {view.missed.length > 0 && <span style={{ color: FAINT }}>灰色虚线是正确答案里他漏连的（{view.missed.length} 条）</span>}
          </div>
        )}
        </div>
      );
    }

    case 'categorize':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {view.zones.map((zone) => (
            <div key={zone.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px' }}>
              <div style={{ fontSize: '0.688rem', color: MUTED, marginBottom: 4 }}>
                {/* ★ 2026-09-30：框名是教师原文 ⇒ 认公式。 */}
                <PromptText text={zone.label} placeholder="" />
              </div>
              {zone.items.length === 0
                ? <span style={{ fontSize: '0.75rem', color: FAINT }}>（这个框他一条都没放）</span>
                : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {zone.items.map((item, index) => (
                      // ★ 2026-09-30：条目是**教师原文** ⇒ 认公式（`item.ok` 才是
                      // 「学生放对了没有」，两回事）。
                      // ⚠️ 这条注释只能用 `//`：这里是箭头函数的**表达式体**，
                      // `{/* … */}` 是 JSX **子元素**位置的语法，放这儿是语法错。
                      <span key={index} style={chip(item.ok ? OK : BAD)}>
                        <PromptText text={item.text} placeholder="" />
                      </span>
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
              {/* ★ 2026-09-30：`loose` 是**教师的条目原文**里没被归进任何框的那些。 */}
              未归类：<PromptText text={view.loose.join('、')} placeholder="" />
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

/**
 * 连线题两栏里的一个盒子。**高度固定**（见 `MATCH_ROW` 那段理由），文字**两行截断** ——
 * 行高一旦随内容变，「按下标算位置」就不再成立。
 */
const rowBox: React.CSSProperties = {
  height: MATCH_ROW.rowHeight, boxSizing: 'border-box',
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
  overflow: 'hidden', wordBreak: 'break-word',
  fontSize: '0.75rem', lineHeight: 1.25, color: '#0f172a',
  border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 7px',
};

/** 条目文字查不到就退回 id（与呈现层同一条纪律：不显示空白）。 */
function textOrId(text: string | undefined, id: string): string {
  return text || id;
}
