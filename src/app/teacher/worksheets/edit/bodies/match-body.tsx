'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import {
  matchAddLeft,
  matchAddRight,
  matchPairLeftRow,
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
          const paired = leftEntry ? pairs.find((pair) => pair.leftId === leftEntry.id) : undefined;
          const pairedRightId = paired?.rightId ?? '';
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

              {showAnswer && (leftEntry ? (
                <select className="input worksheet-editor-pair-select" value={pairedRightId}
                  aria-label={`「${leftEntry.text.trim() || `左项 ${index + 1}`}」连到哪一项`}
                  onChange={(event) => commit(matchPairLeftRow(match, index, event.target.value))}>
                  <option value="">不连线（留空）</option>
                  {right.map((item, itemIndex) => (
                    <option key={item.id || `missing-${itemIndex}`} value={item.id} disabled={!item.id}>
                      {rightLabel(item.text, itemIndex)}
                    </option>
                  ))}
                </select>
              ) : <span />)}
            </div>
          );
        })}
      </div>

      <div className="worksheet-editor-inline-actions">
        <button type="button" className="btn btn-secondary" onClick={() => commit(matchAddLeft(match))}>＋ 左侧添加</button>
        <button type="button" className="btn btn-secondary" onClick={() => commit(matchAddRight(match))}>＋ 右侧添加</button>
      </div>
      {showAnswer && pairs.length < left.length && (
        <p className="worksheet-editor-hint">
          {left.length - pairs.length} 个左侧条目设置为留空。学生不需要连接这些条目；若误连则会扣分。
        </p>
      )}
    </>
  );
}
