'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import {
  MAX_OPTIONS,
  optionKey,
  QUESTION_TYPE_OPTIONS,
  readFillAnswers,
  readOptions,
  writeFillAnswers,
  writeOptions,
  // 从**纯函数内核**直接取：这张卡片只用纯逻辑，不碰 hook（React 状态 / 路由 / 网络）。
  // 内核就是 `node --test` 直接跑的那一份，回归网在 `worksheet-editor-core.test.ts`。
} from './worksheet-editor-core';

/**
 * 一道题的编辑卡片（规格 §6.2 的题流）。
 *
 * 分工：卡片只负责**把这道题的控件画出来并把改动交给 reducer**，不做校验、
 * 不碰网络、不碰历史栈。所有写入口都是 `onPromptChange` / `onDataChange`，
 * 它们最终都落到 `contentReducer` 上。
 *
 * ⚠️ 这里有两处「看起来像校验」的东西，它们**不是**判据，只是本地提示：
 *   1. 少于两个选项时禁用删除按钮（服务端要求 `options.length >= 2`）；
 *   2. 没选正确答案时给一句提示。
 * 真正的判据在服务端（`routes/worksheets.ts` 的 `parseContent` → `validateQuestion`），
 * 保存失败时会把逐题的原因原样带回来。这里重复一遍是为了**不必先保存一次才知道**，
 * 但它们可能与服务端漂移 —— 漂移的后果只是提示早晚，不是放行。
 */
export function QuestionCard({ index, total, node, onPromptChange, onDataChange, onMove, onRemove }: {
  index: number;
  total: number;
  node: WorksheetQuestionNode;
  onPromptChange: (prompt: string) => void;
  onDataChange: (patch: Record<string, unknown>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const typeLabel = QUESTION_TYPE_OPTIONS.find(option => option.value === node.type)?.label ?? node.type;

  return (
    <section className="worksheet-editor-question" aria-label={`第 ${index + 1} 题 ${typeLabel}`}>
      <header className="worksheet-editor-question-head">
        <span className="worksheet-editor-question-index">{index + 1}</span>
        <span className="worksheet-editor-question-type">{typeLabel}</span>
        <div className="worksheet-editor-question-tools">
          <button
            type="button"
            className="worksheet-editor-icon-button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title={index === 0 ? '已经是第一题' : '上移一位'}
            aria-label="上移一位"
          >
            ▲
          </button>
          <button
            type="button"
            className="worksheet-editor-icon-button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title={index === total - 1 ? '已经是最后一题' : '下移一位'}
            aria-label="下移一位"
          >
            ▼
          </button>
          <button
            type="button"
            className="worksheet-editor-icon-button is-danger"
            onClick={onRemove}
            title="删除这道题"
            aria-label="删除这道题"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M6 6l1 14h10l1-14" />
            </svg>
          </button>
        </div>
      </header>

      <label className="worksheet-editor-field">
        <span>题干</span>
        <textarea
          className="input"
          rows={2}
          value={node.prompt}
          onChange={event => onPromptChange(event.target.value)}
          placeholder={node.type === 'fill-blank' ? '例如：植物进行光合作用释放的气体是____。' : '例如：光合作用需要哪些条件？'}
        />
      </label>

      {node.type === 'single-choice' && <SingleChoiceBody node={node} onDataChange={onDataChange} />}
      {node.type === 'fill-blank' && <FillBlankBody node={node} onDataChange={onDataChange} />}
      {node.type === 'short-answer' && (
        <p className="worksheet-editor-hint">问答题是主观题，不自动判分 —— 看板上只统计作答进度。</p>
      )}
    </section>
  );
}

/**
 * 单选题：选项列表（增删改）+ 正确答案单选。
 *
 * 🔴 每次改动都把 `options` 与 `correctKeys` **一起**交给 `writeOptions`。
 * 分开写会有一个窗口期：选项已经重编号、正确答案还指着旧字母 —— 而那个窗口期
 * 一旦被保存或撤销命中，落库的就是一张判分全错的题（没有任何报错）。
 */
function SingleChoiceBody({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  const options = readOptions(node);
  const correctKeys = Array.isArray(node.data.correctKeys)
    ? (node.data.correctKeys as unknown[]).filter((key): key is string => typeof key === 'string')
    : [];

  const commit = (nextOptions: typeof options, nextCorrect: unknown) => {
    const written = writeOptions(nextOptions, nextCorrect);
    onDataChange({ options: written.options, correctKeys: written.correctKeys });
  };

  return (
    <>
      <div className="worksheet-editor-options">
        {options.map((option, optionIndex) => (
          <div className="worksheet-editor-option" key={option.key}>
            <label className="worksheet-editor-option-correct" title="选为正确答案">
              <input
                type="radio"
                name={`correct-${node.id}`}
                checked={correctKeys.includes(option.key)}
                onChange={() => commit(options, [option.key])}
              />
              <span>{option.key}</span>
            </label>
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
              title={options.length <= 2 ? '单选题至少要有两个选项' : '删除这个选项'}
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
        {correctKeys.length !== 1 && (
          <span className="worksheet-editor-warn-hint">还没有指定正确答案 —— 点选项左边的圆点选一个</span>
        )}
      </div>
    </>
  );
}

/**
 * 填空题：题干 + 「答案」textarea，**一行一个可接受答案**（规格 §3-R）。
 *
 * textarea 的文本与 `data.answers` 之间是**无损**往返（`writeFillAnswers` 只按 `\n` 切分、
 * 不丢空行），所以这里不需要额外的本地缓冲：`value` 直接由节点算出来即可，
 * 撤销 / 恢复草稿 / 换题都能立刻反映到光标那一行上。
 */
function FillBlankBody({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <>
      <label className="worksheet-editor-field">
        <span>答案</span>
        <textarea
          className="input"
          rows={3}
          value={readFillAnswers(node)}
          onChange={event => onDataChange({ answers: writeFillAnswers(event.target.value) })}
          placeholder={'一行一个可接受答案，例如：\n光合作用\n碳氧平衡'}
        />
      </label>
      <p className="worksheet-editor-hint">
        学生的答案与其中任意一行一致即算正确（忽略多余空格与全角/半角差异，<strong>区分大小写</strong> —— 英文题请把大小写不同的写法各写一行）。
      </p>
    </>
  );
}
