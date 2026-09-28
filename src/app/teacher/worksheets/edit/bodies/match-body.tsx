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

              {/* ★ 2026-09-28（教师裁定甲）：这一格从**一对一的下拉**换成**开关** ——
                  一个左项可以连到好几个右项（一对多），好几个左项也可以连同一个右项（多对一）。
                  🔴 为什么不是一张真正的矩阵（左项当行、右项当列）：这个编辑器是**行式**的
                     —— 第 i 行同时编辑「左项 i」与「右项 i」，左项与右项是**交错**排的，
                     摆不出「左项一列、右项一行」。这里的语义与矩阵**逐字相同**
                     （每格 = 一条线），只是把列摊在了行里。
                  ⚠️ 「不连线（留空）」现在是**一个开关都不开**，不再是一个选项。 */}
              {showAnswer && (leftEntry ? (
                <div className="worksheet-editor-pair-toggles" role="group"
                  aria-label={`「${leftEntry.text.trim() || `左项 ${index + 1}`}」连到哪几项`}>
                  {right.map((item, itemIndex) => {
                    const checked = pairs.some((pair) => pair.leftId === leftEntry.id && pair.rightId === item.id);
                    return (
                      <label
                        key={item.id || `missing-${itemIndex}`}
                        className={[
                          'worksheet-editor-pair-toggle',
                          checked ? 'is-on' : '',
                          // ⚠️ 禁用态用**一个类**而不是 CSS 的 `:has(input:disabled)` ——
                          //    `:has()` Safari 15 不支持，而 globals.css 学生端也加载
                          //    （`check-classroom-browser-compat.mjs` 当场把构建拦下来了）。
                          leftEntry.id && item.id ? '' : 'is-disabled',
                        ].filter(Boolean).join(' ')}
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
              ) : <span />)}
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
