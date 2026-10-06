'use client';

import { useEffect, useRef } from 'react';
import type { WorksheetQuestionNode } from '@/lib/types';
// ★ 2026-09-30：已配对摘要里可能带教师的右项原文（含公式）。
import { PromptText } from '@/lib/worksheet-prompt-text';
import { TrashIcon } from '../editor-icons';
import {
  matchAddLeft,
  matchAddRight,
  matchTogglePair,
  matchRemoveLeft,
  matchRemoveRight,
  readMatch,
  renameEntryAt,
  writeMatch,
  type MatchData,
} from '../worksheet-editor-core';

function rightLabel(text: string, index: number): string {
  return text.trim() || `右项 ${index + 1}（还没写内容）`;
}

/**
 * 「正确配对」那个下拉：**点外面 / 按 Esc 要关掉**（★ 2026-09-30，教师）。
 *
 * 教师原话：「我在下拉列表外部点击后，下拉列表应该消失。」
 *
 * 🔴 这是**原生 `<details>` 的一条真实缺口**，而下面那段注释原先写着相反的话
 *（「不用管『点外面关掉』、不用管键盘与 Esc（浏览器给）」—— **那是错的**）：
 * `<details>` 只在点自己的 `<summary>` 时开合，点屏幕别处它**一直开着**，
 * Esc 也不管。⇒ 补上那条监听。
 *
 * ⚠️ `mousedown`（不是 `click`）—— 与 `prompt-editor.tsx` 那个颜色下拉同一条理由：
 * 点外面那一下要**在**它变成别处的点击之前关掉，否则那一下会先被别的控件吃掉，
 * 下拉还挂在屏幕上。
 * 🔴 只认 `.worksheet-editor-pair-picker` 这一个类，**不能**写成「关掉页面上所有
 * `<details>`」：同一个编辑器里还有两个**常驻的展开块**（表格粘贴、背景说明），
 * 它们不是下拉，随手点一下就把教师刚展开的说明收掉是另一个毛病。
 */
// ⚠️ 形参写结构类型（`{ current }`）而不是 `RefObject<…>`：本文件不 import React 命名空间，
//    而 ref 在这里只需要「读一下 `.current`」这一件事。
function useClosePairPickerOnOutside(gridRef: { current: HTMLDivElement | null }) {
  useEffect(() => {
    const close = (inside: (node: Node) => boolean) => {
      const box = gridRef.current;
      if (!box) return;
      box.querySelectorAll<HTMLDetailsElement>('details.worksheet-editor-pair-picker[open]').forEach((picker) => {
        if (inside(picker)) return;
        picker.open = false;
      });
    };
    const onMouseDown = (event: MouseEvent) => {
      close((picker) => event.target instanceof Node && picker.contains(event.target));
    };
    // ⚠️ Esc 只是顺手补上的那一半（原生 `<details>` 也不管 Esc）：本页**没有**别的
    // Esc 处理（全仓只有颜色下拉那一个），所以不会与谁抢。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(() => false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [gridRef]);
}

/** 连线题：左右栏独立维护，答案由每个左项后的下拉指定。 */
export function MatchBody({ node, onDataChange, showAnswer = true }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  showAnswer?: boolean;
}) {
  const match = readMatch(node);
  const { left, right, pairs } = match;
  const commit = (next: MatchData) => onDataChange(writeMatch(next.left, next.right, next.pairs));
  const rows = Math.max(left.length, right.length);
  /** 下面那条「点外面关掉」的监听按它找这一题里的下拉（见那个 hook 的注释）。 */
  const gridRef = useRef<HTMLDivElement>(null);
  useClosePairPickerOnOutside(gridRef);

  return (
    <>
      <div className="worksheet-editor-match-head" aria-hidden="true">
        <span>左侧选项</span>
        <span>右侧选项</span>
        {showAnswer && <span>正确配对</span>}
      </div>
      <div className="worksheet-editor-match-grid" ref={gridRef}>
        {Array.from({ length: rows }, (_, index) => {
          const leftEntry = left[index];
          const rightEntry = right[index];
          return (
            <div className="worksheet-editor-match-row" key={index}>
              <div className="worksheet-editor-match-entry">
                {leftEntry ? (
                  <>
                    <input className="input" value={leftEntry.text} placeholder={`左项 ${index + 1}`}
                      onChange={(event) => commit({ ...match, left: renameEntryAt(left, index, event.target.value) })} />
                    <button type="button" className="worksheet-editor-icon-button is-danger"
                      disabled={left.length <= 2} title={left.length <= 2 ? '左侧至少保留两个条目' : '删除这个左侧条目'}
                      aria-label={`删除左项 ${index + 1}`} onClick={() => commit(matchRemoveLeft(match, index))}><TrashIcon /></button>
                  </>
                ) : <span />}
              </div>

              <div className="worksheet-editor-match-entry">
                {rightEntry ? (
                  <>
                    <input className="input" value={rightEntry.text} placeholder={`右项 ${index + 1}`}
                      onChange={(event) => commit({ ...match, right: renameEntryAt(right, index, event.target.value) })} />
                    <button type="button" className="worksheet-editor-icon-button is-danger"
                      disabled={right.length <= 1} title={right.length <= 1 ? '右侧至少保留一个条目' : '删除这个右侧条目'}
                      aria-label={`删除右项 ${index + 1}`} onClick={() => commit(matchRemoveRight(match, index))}><TrashIcon /></button>
                  </>
                ) : <span />}
              </div>

              {/* ★ 2026-09-28（教师第二轮）：**带复选框的下拉**。
                  第一版我做成了「把每个右项摊成一行开关」—— 教师当场否掉：
                  「那你挤在一块儿，我也看不清楚呀。你这里完全可以使用下拉式的，带复选框的那种。」
                  🔴 摊开那一版的问题不是控件本身，是**右项被重复了三遍**（每个左项一行），
                     而组与组之间看不出谁属于谁。下拉把那一列收进一个控件里：
                     一行一个左项、一屏三个控件。
                  ⚠️ 用原生 `<details>` / `<summary>` 而不是自己写开关状态：
                     · 编辑器里已有先例（「从 Excel 粘贴一张表」那个折叠块）。
                  🔴 这里原先还写着「不用管『点外面关掉』、不用管键盘与 Esc（浏览器给）」——
                     **那句话是错的**，教师当场撞上（「我在下拉列表外部点击后，下拉列表
                     应该消失」）。`<details>` 只在点自己的 `<summary>` 时开合，点别处
                     它一直开着。⇒ 补在 `useClosePairPickerOnOutside` 那个 hook 里。
                  ⚠️ 摘要行**必须写出当前连了哪几项** —— 收起时它就是唯一的信息，
                     写「已选 2 项」的话教师还得展开才知道连的是谁。 */}
              {showAnswer && (leftEntry ? (() => {
                const chosen = right.filter((item) => pairs.some(
                  (pair) => pair.leftId === leftEntry.id && pair.rightId === item.id,
                ));
                const summary = chosen.length === 0
                  ? '不连线（留空）'
                  : chosen.map((item) => rightLabel(item.text, right.indexOf(item))).join('、');
                return (
                  <details className="worksheet-editor-pair-picker">
                    {/* ★ 2026-09-30：摘要里是**教师的右项原文** ⇒ 认公式。
                        ⚠️ `title` 那个属性是浏览器的原生 tooltip，只能吃字符串 ⇒ 不包。 */}
                    <summary title={summary}><PromptText text={summary} placeholder="" /></summary>
                    <div className="worksheet-editor-pair-picker-panel" role="group"
                      aria-label={`「${leftEntry.text.trim() || `左项 ${index + 1}`}」连到哪几项`}>
                      {right.map((item, itemIndex) => {
                        const checked = pairs.some(
                          (pair) => pair.leftId === leftEntry.id && pair.rightId === item.id,
                        );
                        return (
                          <label
                            key={item.id || `missing-${itemIndex}`}
                            className={`worksheet-editor-pair-option${checked ? ' is-on' : ''}${leftEntry.id && item.id ? '' : ' is-disabled'}`}
                            title={item.id ? undefined : '这一项还没有 id（先在右边把它写完）'}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!leftEntry.id || !item.id}
                              onChange={(event) => commit({
                                ...match,
                                pairs: matchTogglePair(pairs, leftEntry.id, item.id, event.target.checked),
                              })}
                            />
                            {/* ★ 2026-09-30：右项是教师原文 ⇒ 认公式。
                                🔴 这一处**不是** `<option>`（最初的普查报错过一次，
                                说它与归类那个下拉一样装不下元素）：它是
                                `<label>` + `<input type="checkbox">` ⇒ 装得下。 */}
                            <PromptText text={rightLabel(item.text, itemIndex)} placeholder="" />
                          </label>
                        );
                      })}
                    </div>
                  </details>
                );
              })() : <span />)}
            </div>
          );
        })}
      </div>

      <div className="worksheet-editor-inline-actions">
        <button type="button" className="btn btn-secondary" onClick={() => commit(matchAddLeft(match))}>＋ 左侧添加</button>
        <button type="button" className="btn btn-secondary" onClick={() => commit(matchAddRight(match))}>＋ 右侧添加</button>
      </div>
      {showAnswer && (
        <p className="worksheet-editor-status-note">
          {pairs.length === 0
            ? '尚未设置正确连线'
            : `已设置 ${pairs.length} 条正确连线`}
        </p>
      )}
    </>
  );
}
