'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import {
  matchAddRow,
  matchPairLeftRow,
  matchRemoveRow,
  readMatch,
  renameEntryAt,
  writeMatch,
  type MatchData,
} from '../worksheet-editor-core';

/** 右栏条目的下拉里显示的文字（没写内容时说清楚是哪一个，而不是一个空白项）。 */
function rightLabel(text: string, index: number): string {
  return text.trim() || `右项 ${index + 1}（还没写内容）`;
}

/**
 * 连线题：左栏 / 右栏两个列表 + **每个左项一个下拉**选出它连到右栏的哪一项。
 *
 * ── 为什么编辑态用下拉、不做拖拽（brief Step 2）────────────────────────
 * 编辑是**低频动作**，下拉可靠得多；拖拽那一套（含 iOS 上 `touch-action` 的坑）留给学生端。
 *
 * ── 三栏的关系（这一屏最容易看错的地方）────────────────────────────────
 *   · 左栏与右栏**同行**只是编辑时的排版，**不是答案**；
 *   · 答案只看第三列那个下拉（`data.pairs`，服务端判分读的就是它）；
 *   · 两栏**条数恒等**：加/删都是「一组」（`matchAddRow` / `matchRemoveRow`）——
 *     服务端要求条数相同，两个独立的「＋」能产出的中间态里有一半必然被拒。
 *
 * 🔴 **id 是学生作答值里的键**（`links: [{leftId, rightId}]`，规格 §12）：
 * 改文字不碰 id；**同一个右项只能被一个左项占用**（`matchSetPair` 里「旧的被顶掉」）——
 * 并存会让服务端拒绝**整道题**，一个学生都判不了分。
 *
 * 🔴 **缺 id 的坏行：下拉必须当场生效**（2026-09-24 审查报的原始缺陷，本轮修）。
 * 手工改过的库行里条目可能没有 id（`readEntries` 读成空串）。老实现直接拿左项的 id 去
 * 配（`matchSetPair(pairs, '', 'r1')`）⇒ 那条配对的 `leftId` 为空 ⇒ 被 `readPairs`
 * （与服务端）丢掉 ⇒ 教师选完**下拉当场弹回「请选择」**，而他看不出自己错在哪。
 * ⇒ 下拉的 `onChange` 现在整个走内核的 `matchPairLeftRow`（**先补 id、再配对**，
 * 同一次提交里完成），所以选中的那一项立刻显示出来。右栏缺 id 的情形见下面那条禁用选项。
 *
 * ⚠️ 判据一条都不在这里：组件只画状态并把改动交上去（本仓没有 jsdom，这一层没有回归网）。
 *
 * ⚠️ 教师侧的键叫 `pairs`、学生那侧的作答值叫 `links`（§12 的裁定，**别写反**）：
 * 撞名会让「学生连线答对了」被那条「响应不得含答案键」的扫描读成「答案泄漏」。
 */
export function MatchBody({ node, onDataChange, showAnswer = true }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  /** 关掉「允许自动评分」时为 `false` ⇒ 答案控件不渲染（题面照常）。 */
  showAnswer?: boolean;
}) {
  const match = readMatch(node);
  const { left, right, pairs } = match;
  /** 右栏里**缺编号**（id 是空串）的条目数 —— 它们在配对下拉里选不中，得说一句。 */
  const rightMissingId = right.filter((item) => !item.id).length;
  /** 三个键一起写（左栏陪着右栏与 `pairs`）—— 见内核里那一节的纪律 1。 */
  const commit = (next: MatchData) => onDataChange(writeMatch(next.left, next.right, next.pairs));

  return (
    <>
      <div className="worksheet-editor-options">
        {left.map((entry, index) => {
          const rightEntry = right[index];
          // 当前这个左项连到哪个右项。**只有下拉是答案**，同行不是。
          const paired = pairs.filter((pair) => pair.leftId === entry.id)[0];
          const pairedRightId = paired ? paired.rightId : '';
          const pairedExists = right.some((item) => item.id === pairedRightId);
          return (
            // key 用下标：条目缺 id 时写回会补一个（见 `writeEntries`），用 id 当 key 会让
            // 输入框在补 id 的那一刻被重挂载（焦点丢失）。列表是受控的，不会串位。
            <div className="worksheet-editor-option" key={index}>
              <input
                className="input"
                value={entry.text}
                placeholder={`左项 ${index + 1}`}
                onChange={event => commit({ ...match, left: renameEntryAt(left, index, event.target.value) })}
              />
              <input
                className="input"
                // 右栏**同行显示**只是为了好读：哪一项配哪一项由右边那个下拉决定。
                value={rightEntry ? rightEntry.text : ''}
                placeholder={`右项 ${index + 1}`}
                onChange={event => commit({ ...match, right: renameEntryAt(right, index, event.target.value) })}
              />
              {showAnswer && (<>
<select
                className="input worksheet-editor-pair-select"
                value={pairedRightId}
                aria-label={`「${entry.text.trim() || `左项 ${index + 1}`}」连到哪一项`}
                // 🔴 整个选配动作走内核的 `matchPairLeftRow`（不是直接 `matchSetPair`）：
                // 左项缺 id 时它**先把 id 补上再配对**，否则那一条配对会被当成「leftId 为空」
                // 丢掉，下拉当场弹回「请选择」（老实现的原始缺陷，见文件头）。
                onChange={event => commit(matchPairLeftRow(match, index, event.target.value))}
              >
                <option value="">请选择</option>
                {right.map((item, itemIndex) => (
                  item.id ? (
                    <option key={item.id} value={item.id}>{rightLabel(item.text, itemIndex)}</option>
                  ) : (
                    // 🔴 右项缺 id（手工改过的库行）⇒ 这一项**选不中**：它的 `value` 只能是空串，
                    // 而那与「请选择」是同一个值 ⇒ 点它不会有任何反应，教师只会看到一个
                    // 「点了没反应」的下拉。⇒ 显式画成一条**禁用**的选项并把怎么修写在上面
                    //（在右栏任意一格改一个字就会补上 id，`writeMatch` 那侧是常量补齐）。
                    // ⚠️ key 用 `missing-N` 前缀而**不是下标**：库里的 id 可能是 `"2"` 这种形状，
                    // 与下标撞上就是一个重复 key（React 只 warning，但列表从此靠不住）。
                    <option key={`missing-${itemIndex}`} value="" disabled>
                      {rightLabel(item.text, itemIndex)}（缺编号 —— 在右栏那一格改一个字就能选）
                    </option>
                  )
                ))}
                {pairedRightId && !pairedExists ? (
                  // 配对指向一个已经被删掉的右项（手工改过的行才会出现）：把它显式画出来，
                  // 免得下拉显示成「请选择」而 `pairs` 里其实还留着一条 —— 屏幕与数据必须一致。
                  <option value={pairedRightId}>（原来的右项已经不在了）</option>
                ) : null}
              </select>
              </>)}
              <button
                type="button"
                className="worksheet-editor-icon-button is-danger"
                disabled={left.length <= 2}
                title={left.length <= 2 ? '连线题至少要有两对' : '删除这一对（左右各一个）'}
                aria-label={`删除第 ${index + 1} 对`}
                onClick={() => commit(matchRemoveRow(match, index))}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="worksheet-editor-inline-actions">
        <button type="button" className="btn btn-secondary" onClick={() => commit(matchAddRow(match))}>
          ＋ 添加一组（左右各一个条目）
        </button>
      </div>

      <p className="worksheet-editor-hint">
        左栏与右栏<b>同行</b>只是编辑时的排版，<b>不是答案</b> —— 答案看每一行最右边那个下拉。
        左右两栏的条数必须一样，所以增删都是「一组」。
        {pairs.length < left.length
          ? ` 现在还有 ${left.length - pairs.length} 个左项没配，保存会被服务端拦下。`
          : ''}
        {left.length < 2 ? ' 连线题至少要两对。' : ''}
      </p>

      {/* 🔴 右栏缺编号：那几项在配对下拉里是**禁用**的（点了没反应），得说清怎么修 ——
          不说的话教师只会对着一个「点了没反应」的下拉发呆（2026-09-24 审查同类缺陷）。
          ⚠️ 修法是**任意一格改一个字**：`writeMatch` 那侧一次给所有缺 id 的条目补齐
          （常量补齐，不是只补被改的那一个）—— 所以改完回来也行。 */}
      {rightMissingId > 0 && (
        <p className="worksheet-editor-warn-hint">
          ⚠ 右栏有 {rightMissingId} 个条目<b>缺编号</b>（库里的这一行被改过）—— 它们在下拉里选不中。
          在右栏任意一格里改一个字（改完再改回来也行），编号就会补上，然后就能选。
        </p>
      )}
    </>
  );
}
