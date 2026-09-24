'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import {
  isOrderAmbiguous,
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
 * （「打乱顺序」与「取当前顺序」时，后者**保证**结果不同）。这一屏只负责把当下的状态画出来，
 * 并在它们相同的时候说一句 —— 判据一条都不在这里（组件这一层没有回归网）。
 */
export function OrderBody({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  const order = readOrder(node);
  const { items, correctOrder } = order;
  const byId = new Map(items.map(entry => [entry.id, entry]));
  const ambiguous = isOrderAmbiguous(items, correctOrder);
  /** 三个键一起写（`items` 陪着 `correctOrder`）—— 见内核里那一节的纪律 1。 */
  const commit = (next: OrderData) => onDataChange(writeOrder(next.items, next.correctOrder));

  return (
    <>
      {/* ── 正确答案的顺序（学生看不到）──────────────────────────────── */}
      <div className="worksheet-editor-block">
        <span className="worksheet-editor-block-label">正确答案的顺序（学生看不到）</span>
        {correctOrder.length === 0 ? (
          <p className="worksheet-editor-hint">
            还没设置正确顺序 —— 先点下面的「取当前顺序」（它会把现在的条目顺序当答案，
            同时把学生看到的顺序打乱），再用这里的 ▲▼ 调成正确的顺序。
          </p>
        ) : (
          <ol className="worksheet-editor-order-answer">
            {correctOrder.map((id, index) => {
              const entry = byId.get(id);
              const label = entry ? entryLabel(entry.text) : '（这个条目已经被删掉了）';
              return (
                // key 用下标：条目缺 id 时写回会补一个（`writeEntries`），用 id 当 key
                // 会让这一行的按钮在补 id 的那一刻被重挂载 —— 而列表本身是受控的，不会串位。
                <li className="worksheet-editor-order-row" key={index}>
                  <span className="worksheet-editor-order-index">{index + 1}</span>
                  <span className="worksheet-editor-option-text">{label}</span>
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
        {correctOrder.length === 0 ? (
          <div className="worksheet-editor-inline-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={items.length < 2}
              title={items.length < 2 ? '至少要两个条目' : '把现在的条目顺序当成正确答案，并打乱学生看到的顺序'}
              onClick={() => commit(orderUseCurrentOrder(order))}
            >
              取当前顺序
            </button>
          </div>
        ) : null}
      </div>

      {/* ── 条目（学生要排的东西）────────────────────────────────────── */}
      <div className="worksheet-editor-block">
        <span className="worksheet-editor-block-label">条目（学生看到的就是这些，顺序见下面一行）</span>
        <div className="worksheet-editor-options">
          {items.map((entry, index) => (
            <div className="worksheet-editor-option" key={index}>
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
        <div className="worksheet-editor-inline-actions">
          <button type="button" className="btn btn-secondary" onClick={() => commit(orderAddItem(order, ''))}>
            ＋ 添加条目
          </button>
        </div>
      </div>

      {/* ── 学生看到的那个顺序 + 打乱 ─────────────────────────────────── */}
      <div className="worksheet-editor-inline-actions">
        <span className="worksheet-editor-hint">
          学生看到的顺序：{items.length === 0
            ? '（还没有条目）'
            : items.map(entry => entryLabel(entry.text)).join(' → ')}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={items.length < 2}
          title={items.length < 2 ? '至少要两个条目' : '重新打乱学生看到的顺序（不会等于正确答案的顺序）'}
          onClick={() => commit({ items: shuffleOrderItems(items, correctOrder), correctOrder })}
        >
          打乱顺序
        </button>
      </div>

      {ambiguous && (
        // 本地提示，**不是**判据：真正的拦阻在服务端（A1 的那条校验会说「请先把条目打乱，
        // 或点『打乱顺序』」）。这里重复一遍是为了不必先保存一次才知道。
        // ⚠️ 它只有在**库里那一份**是这种状态时才可能出现（增删条目与「取当前顺序」
        // 都会在内核里把顺序挪开）—— 例如手工改过的行。
        <p className="worksheet-editor-warn-hint">
          ⚠ 学生看到的顺序与正确答案的顺序**一模一样** —— 学生什么都不做就是满分。
          点「打乱顺序」，或调整正确答案那一栏的顺序。
        </p>
      )}
    </>
  );
}
