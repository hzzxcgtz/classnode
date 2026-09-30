'use client';

import { useState } from 'react';
import type { WorksheetQuestionNode } from '@/lib/types';
// ★ 2026-09-30：正确顺序 / 「学生看到的顺序」里是教师的条目原文（可能含公式）。
import { PromptText } from '@/lib/worksheet-prompt-text';
import {
  isOrderAmbiguous,
  isOrderAnswerUsable,
  moveIdInList,
  orderAddItem,
  orderRemoveItem,
  orderUseCurrentOrder,
  readOrder,
  renameEntryAt,
  shuffleOrderItems,
  writeOrder,
  type OrderData,
} from '../worksheet-editor-core';

/** 正确答案栏里显示一个条目的文字；条目被改空时给一句看得懂的话，而不是一个空白。 */
function entryLabel(text: string): string {
  return text.trim() || '（这个条目还没写内容）';
}

function moveAt<T>(values: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from === to || from >= values.length || to >= values.length) return values;
  const next = values.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * 排序题。**这是本批最容易做错的一屏**（plan Step 2），因为它有两个顺序：
 *
 *   · `items`        —— **学生看到的初始顺序**（打乱的那个，学生要把它排对）；
 *   · `correctOrder` —— **正确答案的顺序**（教师排的那个，学生看不到）。
 *
 * ⇒ 屏幕上把两者**分开画、各自带标题**，并且始终显示一行「学生看到的顺序：…」——
 * 教师任何时候都能看出「学生拿到手的是什么样」与「答案是什么」。
 *
 * 🔴 **`items` 里的每个条目有 id，而 id 是学生作答值里的键**（`order: string[]`，规格 §12）：
 * 改文字不能让 id 变（`renameEntryAt` 只换 `text`）；**永远不要用下标代替它**。
 *
 * 🔴 **两个顺序不能逐位相同** —— 相同就是「学生什么都不做就是满分」。
 * 维持它的是内核里的 `ensureOrderDistinct`（增删条目时）与 `shuffleOrderItems`
 * （「重新排列」与「取当前顺序」时，后者**保证**结果不同）。这一屏只负责把当下的状态画出来，
 * 并在它们相同的时候说一句 —— 判据一条都不在这里（组件这一层没有回归网）。
 *
 * ── ★ 2026-09-28（教师）：**拆成两个组件** ─────────────────────────────────
 * 教师原话：「『正确顺序』的设置放到『自动评分』中去」+「布局设计参考填空、选择」。
 * ⇒ 「正确顺序」搬进「自动评分」卡（与填空题的「标准答案」、选择题的「正确答案」
 *   同一个位置 —— 三者都是**答案**，而答案该在开关旁边）；条目与「学生看到的顺序」
 *   留在容器 A（题目内容）。
 * ⚠️ 判据仍然一条都不在这两个组件里：全在内核 `worksheet-editor-core.ts`。
 */

/**
 * 「正确答案的顺序」—— 学生看不到。★ 2026-09-30 起它住在**左栏（选项顺序）的右边**
 *（教师：「排序题的答案设置可以参考连线题和归类题，放在选项顺序的右侧」）。
 */
export function OrderAnswerBody({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  const order = readOrder(node);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const { items, correctOrder } = order;
  const byId = new Map(items.map(entry => [entry.id, entry]));
  /**
   * 「正确顺序」这一栏现在能不能用（是不是条目的 id 的一个排列）。
   *
   * 🔴 `!answerReady` 时**必须留着**「取当前顺序」那个按钮（不只是 `correctOrder` 为空时）。
   * 屏幕上的判据原来只有「`correctOrder` 为空」一条，而**真正的死局**是 `correctOrder`
   * **非空、却不是这些条目 id 的排列**（重复 id / 与条目对不上 / 条目缺 id 的行）：那时
   * 按钮被藏掉，而加条目、删条目都救不回来 ⇒ 教师唯一的出路是删掉这道题。
   * （判据在核心里，这里只画状态。）
   *
   * ⚠️ 2026-09-24（C3）更正一段**已被实测证伪**的复现叙述。这里原先写的是（逐字照抄
   * `a4b1a11` 那一版，只省掉与结论无关的中间半句）：
   *
   *   「审查者实测过一条**死局**：条目缺 id 的行点过一次「取当前顺序」之后，`correctOrder` 里
   *     留着两个空串（既指不到任何条目、也不为空），而那个按钮原来只在「为空」时渲染
   *     ⇒ 屏幕上是两行「这个条目已经被删掉了」、保存被 400 拦下、**修复入口已经被它自己
   *     藏掉** ⇒ 教师唯一的出路是删掉这道题。」
   *
   * 实测不成立 —— `readOrder` 走的 `readStringList` 会**丢掉空串**，落库的 `["",""]`
   * 读回界面是 `[]`，那条老判据照样渲染按钮；那条路只是**两次点击**才能修好
   *（第一次落库的仍是 `["",""]`：答案键在 `writeEntries` 补 id **之前**就算好了），
   * 不是死局。上面那句里唯一成立的是「那是审查者实测的」 —— 他测的是别的来路。
   * 两级内核各跑一遍的实测记录：`task-C3-report.md` 第一节。
   */
  const answerReady = isOrderAnswerUsable(items, correctOrder);
  /** 三个键一起写（`items` 陪着 `correctOrder`）—— 见内核里那一节的纪律 1。 */
  const commit = (next: OrderData) => onDataChange(writeOrder(next.items, next.correctOrder));

  return (
    <div className="worksheet-editor-block">
      {/* ★ 2026-09-30（教师）：「是这个红框里边的位置不对，所以导致错位。」
          原来这里是 `<h4>正确顺序</h4>` + 一整段说明，比左栏那一个
          `.worksheet-editor-block-label` 高出约 **52px** ⇒ 右栏的行整体被推下去，
          两栏的行对不齐。⇒ 改成与左栏**同一个类**的单行标签；那两句说明搬到卡片顶部
          （`question-card.tsx` 的 `order.description`）—— 一句话管两栏，也更省地方。 */}
      <span className="worksheet-editor-block-label">正确顺序</span>
      {correctOrder.length === 0 ? (
        <p className="worksheet-editor-hint">
          还没设置正确顺序 —— 先点下面的「取当前顺序」（它会把现在的条目顺序当答案，
          同时把学生看到的顺序重新排列），再用这里的 ▲▼ 调成正确的顺序。
        </p>
      ) : (
        <ol className="worksheet-editor-order-answer">
          {correctOrder.map((id, index) => {
            const entry = byId.get(id);
            const label = entry ? entryLabel(entry.text) : '（这个条目已经被删掉了）';
            return (
              // key 用下标：条目缺 id 时写回会补一个（`writeEntries`），用 id 当 key
              // 会让这一行的按钮在补 id 的那一刻被重挂载 —— 而列表本身是受控的，不会串位。
              <li
                className={`worksheet-editor-order-row${dragFrom === index ? ' is-dragging' : ''}${dragOver === index ? ' is-drop-target' : ''}`}
                key={index}
                onDragOver={(event) => { event.preventDefault(); setDragOver(index); }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragFrom !== null) commit({ items, correctOrder: moveAt(correctOrder, dragFrom, index) });
                  setDragFrom(null); setDragOver(null);
                }}
              >
                <button type="button" className="worksheet-editor-order-drag" draggable
                  aria-label={`拖动「${label}」调整正确顺序`}
                  onDragStart={(event) => { setDragFrom(index); event.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { setDragFrom(null); setDragOver(null); }}>⋮⋮</button>
                <span className="worksheet-editor-order-index">{index + 1}</span>
                {/* ★ 2026-09-30：`label` 是教师条目原文（条目被删掉时是那句机器提示，
                    一并包住对它无害）。 */}
                <span className="worksheet-editor-option-text"><PromptText text={label} placeholder="" /></span>
                <button
                  type="button"
                  className="worksheet-editor-icon-button"
                  disabled={index === 0}
                  title={index === 0 ? '已经是第一个' : '往前一位'}
                  aria-label={`把「${label}」往前移一位`}
                  onClick={() => commit({ items, correctOrder: moveIdInList(correctOrder, id, -1) })}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="worksheet-editor-icon-button"
                  disabled={index === correctOrder.length - 1}
                  title={index === correctOrder.length - 1 ? '已经是最后一个' : '往后一位'}
                  aria-label={`把「${label}」往后移一位`}
                  onClick={() => commit({ items, correctOrder: moveIdInList(correctOrder, id, 1) })}
                >
                  ▼
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {!answerReady && correctOrder.length > 0 && (
        // 「正确顺序」与条目对不上（缺 id / 长度不符 / 有重复）—— 它是**存不下**的状态
        //（服务端：「排序题的『正确顺序』必须正好是这些条目各一次」），所以必须说清怎么重设。
        <p className="worksheet-editor-warn-hint">
          ⚠ 这一栏与条目对不上（库里那一份被改过，或者条目缺了 id），照这样保存会被服务端拒绝。
          点「取当前顺序」按现在的条目重设一遍即可。
        </p>
      )}
      {!answerReady ? (
        <div className="worksheet-editor-inline-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={items.length < 2}
            title={items.length < 2 ? '至少要两个条目' : '把现在的条目顺序当成正确答案，并重新排列学生看到的顺序'}
            onClick={() => commit(orderUseCurrentOrder(order))}
          >
            取当前顺序
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 条目（学生要排的东西）+「学生看到的顺序」+「重新排列」。
 * **住在容器 A（题目内容）里**；答案那一半见 `OrderAnswerBody`。
 */
export function OrderBody({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  const order = readOrder(node);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const { items, correctOrder } = order;
  const ambiguous = isOrderAmbiguous(items, correctOrder);
  /** 三个键一起写（`items` 陪着 `correctOrder`）—— 见内核里那一节的纪律 1。 */
  const commit = (next: OrderData) => onDataChange(writeOrder(next.items, next.correctOrder));

  return (
    <>
      {/* ★ 2026-09-30（教师）：「排序题的答案设置可以参考连线题和归类题，放在**选项顺序的
          右侧**。」⇒ **左栏**是这一块（条目 + 学生看到的顺序），**右栏**是 `OrderAnswerBody`
          （正确顺序）—— 它原来住在「自动评分」卡里，两块分在两处，调答案时要上下找。
          ⚠️ 窄屏**上下叠**（教师同日裁定）—— `.worksheet-editor-order-columns` 的媒体查询。
          ⚠️ 「学生看到的顺序与正确答案一模一样」那句提示留在**两栏外面**：它说的是**整题**
             的状态，且同时指向两栏（「点重新排列，或调整『正确顺序』那一栏」）。 */}
      <div className="worksheet-editor-order-columns">
      <div className="worksheet-editor-block">
        <span className="worksheet-editor-block-label">选项顺序</span>
        <div className="worksheet-editor-options">
          {items.map((entry, index) => (
            <div
              className={`worksheet-editor-option worksheet-editor-order-edit-row${dragFrom === index ? ' is-dragging' : ''}${dragOver === index ? ' is-drop-target' : ''}`}
              key={index}
              onDragOver={(event) => { event.preventDefault(); setDragOver(index); }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragFrom !== null) commit({ items: moveAt(items, dragFrom, index), correctOrder });
                setDragFrom(null); setDragOver(null);
              }}
            >
              <button type="button" className="worksheet-editor-order-drag" draggable
                aria-label={`拖动条目 ${index + 1} 调整学生看到的顺序`}
                onDragStart={(event) => { setDragFrom(index); event.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => { setDragFrom(null); setDragOver(null); }}>⋮⋮</button>
              <span className="worksheet-editor-order-index">{index + 1}</span>
              <input
                className="input"
                value={entry.text}
                placeholder={`条目 ${index + 1}`}
                onChange={event => commit({ items: renameEntryAt(items, index, event.target.value), correctOrder })}
              />
              <button
                type="button"
                className="worksheet-editor-icon-button is-danger"
                disabled={items.length <= 2}
                title={items.length <= 2 ? '排序题至少要有两个条目' : '删除这个条目'}
                aria-label={`删除条目 ${entryLabel(entry.text)}`}
                onClick={() => commit(orderRemoveItem(order, index))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {/* ★ 2026-09-28（教师）：「打乱顺序」移到这一行、改名「重新排列」——
            它和「＋ 添加条目」都是**对条目这一列本身的操作**，摆在一起才读得通；
            而「打乱顺序」这个名字说着像是另一种操作，其实只是把学生看到的顺序重排一次。 */}
        <div className="worksheet-editor-inline-actions">
          <button type="button" className="btn btn-secondary" onClick={() => commit(orderAddItem(order, ''))}>
            ＋ 添加条目
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={items.length < 2}
            title={items.length < 2 ? '至少要两个条目' : '重新排列学生看到的顺序（不会等于正确答案的顺序）'}
            onClick={() => commit({ items: shuffleOrderItems(items, correctOrder), correctOrder })}
          >
            重新排列
          </button>
        </div>
        <p className="worksheet-editor-hint">
          {/* ★ 2026-09-30：这一行是教师条目原文 ⇒ 认公式。⚠️ 箭头是分隔符，不包。 */}
          学生看到的顺序：{items.length === 0
            ? '（还没有条目）'
            : <PromptText text={items.map(entry => entryLabel(entry.text)).join(' → ')} placeholder="" />}
        </p>
      </div>
      {/* ── 右栏：正确顺序（从「自动评分」卡搬来的）───────────────────────── */}
      <OrderAnswerBody node={node} onDataChange={onDataChange} />
      </div>

      {ambiguous && (
        // 本地提示，**不是**判据：真正的拦阻在服务端（A1 的那条校验会说「请先把条目打乱，
        // 或点『重新排列』」）。这里重复一遍是为了不必先保存一次才知道。
        // ⚠️ 它只有在**库里那一份**是这种状态时才可能出现（增删条目与「取当前顺序」
        // 都会在内核里把顺序挪开）—— 例如手工改过的行。
        <p className="worksheet-editor-warn-hint">
          ⚠ 学生看到的顺序与正确答案的顺序**一模一样** —— 学生什么都不做就是满分。
          点「重新排列」，或调整「正确顺序」那一栏。
        </p>
      )}
    </>
  );
}
