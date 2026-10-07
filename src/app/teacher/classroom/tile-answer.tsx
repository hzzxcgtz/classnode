'use client';

import { useMemo } from 'react';
import { answerView, type AnswerView } from '@/lib/worksheet-answer-view';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
// ★ 2026-09-30：题面文本里的数学公式（选项 / 左右项 / 框名 / 条目）。
// 🔴 **只包「教师写的原文」**：本文件里 `view.text`（问答）/ `blank.text`（填空）/
//    排序那个 `{text}` 都是**学生填的答案**，一律**不**包（裁定 ④）。
import { PromptText } from '@/lib/worksheet-prompt-text';
import type { WorksheetQuestionNode } from '@/lib/types';
import type { TileAnswer } from './worksheet-tile-state';
import { InkPreview } from './ink-preview';

/**
 * ★ 2026-09-28（教师）：「图中已有图形和文字要整体上移，留出下方最大的空间用来显示
 * 当天学生正在答题的详细动态情况，不同题型可能不同，你想想办法，适应每种题型」。
 *
 * ── 🔴 这一格里**只有学生的作答，没有对错、没有正确答案**（教师第二轮追加）────────
 * 原话：「只显示学生的作答过程和内容，不需要判对错，不需要给答案」。
 * ⇒ 选项不标 ✓/✗、不补「正确：B」；连线不标红绿、不报「连错 N 条 / 漏连 M 条」；
 *   归类里放错的条目也不带 ✗。**整块一律中性色**。
 *
 * ⚠️ 判据层（`worksheet-answer-view.ts`）**照旧算 `ok` / `missed`** ——
 * 抽屉那边要用（教师两轮前的裁定：「连线/归类/单选/判断 标逐元素对错」）。
 * 这一格只是**不画**它们，不是把它们从模型里删掉。
 * ⚠️ 也**不要**顺手把抽屉那边的也去掉：那是教师明确做过的另一个决定。
 * （如果这一条其实是想连抽屉一起改，告诉他一声 —— 那是两处、不是一处。）
 *
 * ── 这一层与抽屉里那一层（`answer-view.tsx`）**不是同一份**，而那是刻意的 ──────
 * 抽屉有 420px 宽、可以随便展开；这一格是 **214 × 150**，扣掉状态行与方块阵之后
 * 只剩大约 90px 高。所以同一个题型在这里必须**换一种更紧的画法**：
 *
 * | 题型 | 抽屉里 | 这一格里 |
 * |---|---|---|
 * | 单选/多选/判断 | 整张选项表 + 两个记号 | **只画他勾的那几个** |
 * | 填空 | 逐空一栏 + 正确答案 | 一列小格子（`空1 H2O`），换行排 |
 * | 问答 | 原文 | 原文，最多三行截断 |
 * | 排序 | 编号列表 + 正确顺序 | 一串 `① 甲 ② 乙` 挤在一行里 |
 * | 连线 | 两栏 + 中间的线 | 每一对一行 `水 ─ H2O`（两个字的宽度画不出两栏） |
 * | 归类 | 每个框一张卡 | 每个框一行 `哺乳类：猫、狗` |
 * | 绘图 | 整幅图 | **同一个 `InkPreview`**，只是被下面那个框裁到只剩一块 |
 *
 * ⚠️ **本文件只画**：哪一种、哪些条目 —— 判据全在
 * `src/lib/worksheet-answer-view.ts`（纯函数、有测试）。这里只决定「怎么挤进去」。
 *
 * 🔴 数据是**实时**的：`value` 来自看板的作答行，而 `applyLiveRows` 已经把广播带来的
 * 内容补进去了（乙档）—— 所以学生在写、教师这一格跟着变。没有那一步的话，
 * 这一块只能等 30 秒一次的快照，读起来像卡住了。
 */

// ⚠️ 只有中性色。这一格**不画对错**（教师第二轮），所以连 `OK` / `BAD` / `ANSWER`
// 三个常量都不该在这里 —— 留着它们就是给下一个人「顺手标一下」的许可。
const MUTED = '#64748b';
const FAINT = '#94a3b8';

/**
 * 小格子（填空的空、选项、排序的条目）。**颜色一律中性** —— 这一格不画对错
 * （教师第二轮），所以边框色只区分「这是个盒子」，不带任何判断。
 * ⚠️ 原来还有一个 `filled` 参数（画空心/实心两态）—— 所有调用都传同一个值之后就删了：
 * 留着一个恒为真的开关，下一个人会以为它还有用。
 */
const chipStyle = (color: string): React.CSSProperties => ({
  fontSize: '0.625rem', lineHeight: 1.25, padding: '1px 5px', borderRadius: 5,
  border: `1px solid ${color}`,
  background: 'white',
  color: '#0f172a', whiteSpace: 'nowrap', maxWidth: '100%',
  overflow: 'hidden', textOverflow: 'ellipsis',
});

function Line({ children, color = MUTED }: { children: React.ReactNode; color?: string }) {
  return <div style={{ fontSize: '0.625rem', color, lineHeight: 1.35 }}>{children}</div>;
}

export function TileAnswerBody({ answer }: { answer: TileAnswer }) {
  // ⚠️ memo：`answerView` 每次调用都返回新对象，而这一格每 30 秒会因快照更新重渲染一次。
  const view = useMemo(() => answerView(answer.node, answer.value), [answer.node, answer.value]);
  // ⚠️ `flexShrink: 0` 是给**滚动**用的（★ 2026-09-29，教师：「内容比较长则自动加上垂直
  // 滚动条」）：外面那一层是 column flex + `overflowY: auto`，而子项默认 `flex-shrink: 1`
  // 会被压到刚好塞下 —— 那时没有任何东西溢出，滚动条永远不出现，长内容**直接被切掉**
  //（不报错，只是「后半截没了」）。不许被压，那一层才会真的溢出、才谈得上滚。
  //
  // ★ 2026-10-07（教师）：「学生在画流程图的时候，能够**一眼看到完整的图**，也就是说可以缩放一下，
  //   不要使用滚动条了」⇒ **绘图这一支反过来**：它要**填满剩余空间**（`flex: 1; minHeight: 0`），
  //   这样下面那幅图才拿得到一个**确定的高度**去等比缩放（`max-height: 100%` 要有确定的百分比基准）。
  //   文字类作答照旧走上面那条 `flexShrink: 0`（长答案该滚就滚）。
  const fill = view.kind === 'ink';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, ...(fill ? { flex: 1, minHeight: 0 } : { flexShrink: 0 }) }}>
      {renderCompact(view, answer.node)}
    </div>
  );
}

function renderCompact(view: AnswerView, node: WorksheetQuestionNode): React.ReactNode {
  switch (view.kind) {
    // 未作答：一句短的。**不画空框** —— 空框与「他写了但读不出来」长得一样。
    case 'none':
      return <Line color={FAINT}>还没开始写</Line>;

    case 'text':
      return (
        <div style={{
          fontSize: '0.625rem', color: '#0f172a', lineHeight: 1.3, wordBreak: 'break-word',
          // 🔴 `pre-wrap`：学生**自己敲的换行要看得见**（★ 2026-09-29 教师：「学生在输入问答题
          // 的答案时，已经手工换行了，但是在监控面板里没有看到换行」）。
          // 默认的 `white-space: normal` 会把 `\n` **折叠成一个空格** ⇒ 学生分成三段的答案
          // 在这里连成一段，读起来是不同的意思，而屏幕上一点异常都没有。
          // ⚠️ 与教师端抽屉那一份**同一条**（`answer-view.tsx` 的 `ANSWER_TEXT_STYLE`）——
          // 同一份作答在两处必须长得一样，各写一份的话分叉了也没人报错。
          whiteSpace: 'pre-wrap',
          // ⊘ ★ 2026-09-29：原来这里是 `-webkit-line-clamp: 4`（截断 4 行）。**去掉了**，
          // 因为教师同一天要了「内容比较长则自动加上垂直滚动条」—— 两者是同一个问题的两种答案，
          // 留着 clamp 的后果是：问答题的长答案被截到 4 行 ⇒ **永远不溢出** ⇒ 滚动条永远不出现
          // ⇒ 那句「自动加滚动条」在这一类内容上**等于没做**（而且被截掉的部分看不出来少了）。
          // ⇒ 长就让它长，滚由外面那一层负责（`worksheet-tiles.tsx` 的 `preview-scroll`）。
        }}>{view.text}</div>
      );

    case 'ink':
      /*
       * ★ 2026-10-07（教师）：「一眼看到完整的图……不要使用滚动条了」。
       * 🔴 **这一层必须是 flex 容器**（`display: flex`）：里面那个 `InkPreview` 外框靠
       *   `flex: 1` 填满剩余高度，而 `flex` 只在**flex 容器**里起作用 ——
       *   原来这里是普通块级元素 ⇒ 外框的高度退化成「内容高度」⇒ 图里那句
       *   `max-height: 100%` 没了基准（等于 `none`）⇒ 图按宽度铺满、**高的部分被
       *   `overflow: hidden` 裁掉**（教师截图里下半张图不见，就是这个）。
       */
      return view.ink ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 4, border: '1px solid #e2e8f0' }}>
          <InkPreview value={view.ink} node={node} />
        </div>
      ) : <Line color={FAINT}>读不出这幅画</Line>;

    case 'photo':
      return (
        <img
          src={worksheetAssetUrl(view.url)}
          alt="学生上传的作答照片"
          style={{
            display: 'block', width: '100%', maxHeight: 112, objectFit: 'contain',
            borderRadius: 4, border: '1px solid #e2e8f0', background: '#f8fafc',
          }}
        />
      );

    case 'choice': {
      // 只画**他勾的**那几个：整张表在这一格里放不下，而他没勾的选项对教师没有信息量。
      const picked = view.options.filter((option) => option.picked);
      // ⚠️ **不标对错、不补正确答案**（教师第二轮：「只显示学生的作答过程和内容」）。
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {picked.length === 0
            ? <Line color={FAINT}>还没选</Line>
            : picked.map((option) => (
              <span key={option.key} style={chipStyle('#e2e8f0')}>
                {/* ★ 2026-09-30：选项是**教师原文** ⇒ 认公式。 */}
                {option.key}. {option.text ? <PromptText text={option.text} placeholder="" /> : option.key}
              </span>
            ))}
        </div>
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
                  <span key={blank.label} style={chipStyle('#e2e8f0')}>
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
              <span key={index} style={chipStyle('#e2e8f0')}>
                <span style={{ color: MUTED }}>{index + 1}</span> {text}
              </span>
            ))}
        </div>
      );

    case 'match':
      // ⚠️ **整块中性**：不标红绿、不说「连错 N 条 / 漏连 M 条」（教师第二轮）。
      // 这一格里教师要看的是「他连成了什么样」，对错在格子上方那行结论里已经有了。
      return (
        <>
          {view.links.length === 0
            ? <Line color={FAINT}>还没连</Line>
            : view.links.map((link, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.625rem', color: '#0f172a' }}>
                <span style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {/* ★ 2026-09-30：连线**左项**是教师原文 ⇒ 认公式
                      （`textOrId` 在文本为空时会回落成 id，那也照样能过）。 */}
                  <PromptText text={textOrId(view.left, link.leftId)} placeholder="" />
                </span>
                <span aria-hidden style={{ flex: '0 0 18px', height: 2, alignSelf: 'center', background: FAINT }} />
                <span style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {/* ★ 2026-09-30：连线**右项**同左项。 */}
                  <PromptText text={textOrId(view.right, link.rightId)} placeholder="" />
                </span>
              </div>
            ))}
        </>
      );

    case 'categorize':
      return (
        <>
          {view.zones.filter((zone) => zone.items.length > 0).map((zone) => (
            <Line key={zone.id}>
              {/* ★ 2026-09-30：框名是教师原文 ⇒ 认公式。 */}
              <span style={{ color: MUTED }}><PromptText text={zone.label} placeholder="" />：</span>
              {/* ⚠️ 放错的条目**不带 ✗**（教师第二轮：这一格不给对错）。 */}
              {/* ★ 2026-09-30：归类**条目**是教师原文 ⇒ 认公式。 */}
              <span style={{ color: '#0f172a' }}>
                <PromptText text={zone.items.map((item) => item.text).join('、')} placeholder="" />
              </span>
            </Line>
          ))}
          {view.loose.length > 0 && (
            <Line color={FAINT}>
              {/* ★ 2026-09-30：`loose` 是教师条目原文里没归进任何框的那些 ⇒ 认公式。 */}
              未归类：<PromptText text={view.loose.join('、')} placeholder="" />
            </Line>
          )}
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
