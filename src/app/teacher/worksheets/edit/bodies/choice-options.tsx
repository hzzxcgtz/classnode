'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import {
  MAX_OPTIONS,
  optionKey,
  readCorrectKeys,
  readOptions,
  writeMultipleOptions,
  writeOptions,
  type ChoiceOption,
} from '../worksheet-editor-core';

/**
 * 选项列表 + 正确答案 —— **单选与多选共用的那一份**。
 *
 * 🔴 **每次改动都把 `options` 与 `correctKeys` 一起交给 `writeOptions` / `writeMultipleOptions`。**
 * 分开写会有一个窗口期：选项已经重编号、正确答案还指着旧字母 —— 而那个窗口期一旦被
 * 保存或撤销命中，落库的就是一张判分全错的题（**没有任何报错**）。
 * 这个纪律原来写在 `question-card.tsx` 的 `SingleChoiceBody` 上；那个组件写死了单选，
 * M4a 加多选题时把它拆成了**这一个受控组件 + 一个 `multiple` 开关**，
 * 于是那条纪律只有一处需要遵守 —— 而这里是它唯一的实现。
 *
 * ⚠️ **重编号与翻译 `correctKeys` 的判据全在 `worksheet-editor-core.ts` 里**
 *（`writeOptions` / `writeMultipleOptions`，它们共用一份实现）。这个组件只负责
 * 「把控件画出来、把改动交上去」，不做任何判断 —— 组件这一层**没有回归网**
 *（本仓前端没有 jsdom / testing-library），判据留在这里就等于没有验证过。
 */
export function ChoiceOptionsEditor({ node, multiple, onDataChange, showAnswer = true }: {
  node: WorksheetQuestionNode;
  /** `true` = 多选题（可勾多个、正确答案可以不止一个）。`false` = 单选/判断以外的单选口径。 */
  multiple: boolean;
  onDataChange: (patch: Record<string, unknown>) => void;
  /** 关掉「允许自动评分」时为 `false` ⇒ **只隐藏「正确答案」那几个圆点/勾选框**，选项列表照常。 */
  showAnswer?: boolean;
}) {
  const options = readOptions(node);
  const correctKeys = readCorrectKeys(node);

  const commit = (nextOptions: ChoiceOption[], nextCorrect: unknown) => {
    const written = multiple
      ? writeMultipleOptions(nextOptions, nextCorrect)
      : writeOptions(nextOptions, nextCorrect);
    onDataChange({ options: written.options, correctKeys: written.correctKeys });
  };

  return (
    <>
      <div className="worksheet-editor-options">
        {options.map((option, optionIndex) => (
          <div className="worksheet-editor-option" key={option.key}>
            {showAnswer && (<>
<label className="worksheet-editor-option-correct" title="选为正确答案">
              <input
                // ⚠️ 多选是勾选框、单选是圆点。`name` 必须带 `node.id`：同卷多题如果共用名字，
                // 第 1 题的选择会把第 2 题的顶掉（学生端 `worksheet-panel.tsx` 上有一条同源的注释）。
                type={multiple ? 'checkbox' : 'radio'}
                name={`correct-${node.id}`}
                checked={correctKeys.includes(option.key)}
                onChange={() => {
                  if (!multiple) {
                    commit(options, [option.key]);
                    return;
                  }
                  // 多选：勾上就加、取消就减（顺序按点击次序，服务端只把它当一个集合读）。
                  const next = correctKeys.includes(option.key)
                    ? correctKeys.filter((key) => key !== option.key)
                    : [...correctKeys, option.key];
                  commit(options, next);
                }}
              />
              <span>{option.key}</span>
            </label>
            </>)}
            <input
              className="input"
              value={option.text}
              placeholder={`选项 ${option.key}`}
              onChange={event => {
                const nextOptions = options.map((item, itemIndex) => (
                  itemIndex === optionIndex ? { key: item.key, text: event.target.value } : item
                ));
                commit(nextOptions, correctKeys);
              }}
            />
            <button
              type="button"
              className="worksheet-editor-icon-button is-danger"
              disabled={options.length <= 2}
              title={options.length <= 2 ? '至少要保留两个选项' : '删除这个选项'}
              aria-label={`删除选项 ${option.key}`}
              onClick={() => commit(options.filter((_, itemIndex) => itemIndex !== optionIndex), correctKeys)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="worksheet-editor-inline-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={options.length >= MAX_OPTIONS}
          title={options.length >= MAX_OPTIONS ? `选项最多 ${MAX_OPTIONS} 个（A–Z）` : '再加一个选项'}
          onClick={() => commit([...options, { key: optionKey(options.length), text: '' }], correctKeys)}
        >
          ＋ 添加选项
        </button>
        {options.length === 0 && (
          <span className="worksheet-editor-warn-hint">
            这道题一个选项都没有（库里的数据被改过）—— 点「＋ 添加选项」补两个，再选正确答案。
          </span>
        )}
        {options.length > 0 && (multiple ? correctKeys.length === 0 : correctKeys.length !== 1) && (
          <span className="worksheet-editor-warn-hint">
            {multiple
              ? '还没有指定正确答案 —— 点选项左边的方框勾选（可以勾多个）'
              : '还没有指定正确答案 —— 点选项左边的圆点选一个'}
          </span>
        )}
      </div>
    </>
  );
}
