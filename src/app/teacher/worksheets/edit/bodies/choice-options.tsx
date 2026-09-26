'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { WorksheetQuestionNode } from '@/lib/types';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
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
            <div className="worksheet-editor-option-content">
              <input
                className="input"
                value={option.text}
                placeholder={`选项 ${option.key}`}
                onChange={event => {
                  const nextOptions = options.map((item, itemIndex) => (
                    itemIndex === optionIndex ? { ...item, text: event.target.value } : item
                  ));
                  commit(nextOptions, correctKeys);
                }}
              />
              {option.imageUrl && <img src={worksheetAssetUrl(option.imageUrl)} alt={`选项 ${option.key} 配图预览`} />}
            </div>
            <OptionImageButton
              optionKey={option.key}
              hasImage={Boolean(option.imageUrl)}
              onChange={(imageUrl) => {
                const nextOptions = options.map((item, itemIndex) => (
                  itemIndex === optionIndex
                    ? { ...item, ...(imageUrl ? { imageUrl } : { imageUrl: undefined }) }
                    : item
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

      <div className="worksheet-editor-choice-actions">
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
          <span className="worksheet-editor-choice-warning" role="status">
            <strong>需要补充选项</strong>
            这道题还没有选项。请至少添加两个选项，再设置正确答案。
          </span>
        )}
        {options.length > 0 && (multiple ? correctKeys.length === 0 : correctKeys.length !== 1) && (
          <span className="worksheet-editor-choice-warning" role="status">
            <strong>尚未设置正确答案</strong>
            {multiple
              ? '请勾选选项左侧的方框，可以选择多个。'
              : '请点击选项左侧的圆点，选择一个。'}
          </span>
        )}
      </div>
    </>
  );
}

function OptionImageButton({ optionKey, hasImage, onChange }: {
  optionKey: string;
  hasImage: boolean;
  onChange: (imageUrl?: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const upload = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const result = await api.uploadWorksheetImage(file);
      onChange(result.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="worksheet-editor-option-image-action">
      <label title={hasImage ? `更换选项 ${optionKey} 的图片` : `给选项 ${optionKey} 添加图片`}>
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = '';
        }} />
        {/* ★ 2026-09-26（教师：「用图标」）：原来这里是「配图 / 换图」两个字的按钮，
            在一行四个控件里显得又长又抢眼。换成一个小图标（挂在 `title` 上的说明没变，
            读屏与悬停都还读得到「给选项 X 添加图片」）。
            ⚠️ `stroke="currentColor"`：它的颜色要跟着按钮的 `color` 走（hover / disabled 都算）。 */}
        {uploading ? '…' : (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="5.6" cy="6.3" r="1.25" fill="currentColor" />
            <path d="M2.6 12.2l3.5-3.5 2.3 2.3 1.9-1.9 3.1 3.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </label>
      {hasImage && <button type="button" onClick={() => onChange()} title={`移除选项 ${optionKey} 的图片`}>移除</button>}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
