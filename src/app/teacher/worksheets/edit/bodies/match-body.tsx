'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
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

  return (
    <>
      <div className="worksheet-editor-match-head" aria-hidden="true">
        <span>左侧选项</span>
        <span>右侧选项</span>
        {showAnswer && <span>正确配对</span>}
      </div>
      <div className="worksheet-editor-match-grid">
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
                      aria-label={`删除左项 ${index + 1}`} onClick={() => commit(matchRemoveLeft(match, index))}>×</button>
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
                      aria-label={`删除右项 ${index + 1}`} onClick={() => commit(matchRemoveRight(match, index))}>×</button>
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
                     · 不用管「点外面关掉」、不用管键盘与 Esc（浏览器给）；
                     · 编辑器里已有先例（「从 Excel 粘贴一张表」那个折叠块）。
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
                    <summary title={summary}>{summary}</summary>
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
                            {rightLabel(item.text, itemIndex)}
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
        <p className="worksheet-editor-hint">
          {pairs.length === 0
            ? '还没有设置任何连线 —— 点每一项右边的开关，打开的格子就是一条正确的连线。'
            : `已设置 ${pairs.length} 条连线。一个左项可以连多个右项，多个左项也可以连同一个右项。`
              + '没有连线的左项是**留空项**：学生不需要连它，误连会拿不到全对。'}
        </p>
      )}
    </>
  );
}
