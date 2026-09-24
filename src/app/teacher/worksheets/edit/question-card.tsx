'use client';

import { useState } from 'react';
import type { QuestionPointsDraft, WorksheetQuestionNode } from '@/lib/types';
import {
  isPartialPoints,
  MAX_OPTIONS,
  optionKey,
  parsePointInput,
  POINTS_MAX,
  QUESTION_TYPE_OPTIONS,
  readFillAnswers,
  readOptions,
  shouldWarnZeroHalfCredit,
  writeFillAnswers,
  writeOptions,
  // 从**纯函数内核**直接取：这张卡片只用纯逻辑，不碰 hook（React 状态 / 路由 / 网络）。
  // 内核就是 `node --test` 直接跑的那一份，回归网在 `worksheet-editor-core.test.ts`。
} from './worksheet-editor-core';

/**
 * 一道题的编辑卡片（规格 §6.2 的题流）。
 *
 * 分工：卡片只负责**把这道题的控件画出来并把改动交给 reducer**，不做校验、
 * 不碰网络、不碰历史栈。所有写入口都是 `onPromptChange` / `onDataChange` / `onPointsChange`，
 * 它们最终都落到 `contentReducer` 上。
 *
 * ⚠️ 这里有几处「看起来像校验」的东西，它们**不是**判据，只是本地提示：
 *   1. 少于两个选项时禁用删除按钮（服务端要求 `options.length >= 2`）；
 *   2. 没选正确答案时给一句提示；
 *   3. 分值只填了一个框时给一句提示（真正的拦阻在 `save()` 的 `findPartialPoints`）；
 *   4. 多选「漏选算半对」+ 半对档 0 时给一句提示（规格 §12 裁定 3 的连带要求）。
 * 真正的判据在服务端（`routes/worksheets.ts` 的 `parseContent` → `validateQuestion`），
 * 保存失败时会把逐题的原因原样带回来。这里重复一遍是为了**不必先保存一次才知道**，
 * 但它们可能与服务端漂移 —— 漂移的后果只是提示早晚，不是放行。
 */
export function QuestionCard({ index, total, node, inheritedPoints, onPromptChange, onDataChange, onPointsChange, onMove, onRemove }: {
  index: number;
  total: number;
  node: WorksheetQuestionNode;
  /**
   * 学习单级的**两档**（`settings.rewardStep` / `settings.halfStep`）—— 逐题留空时继承的就是它们。
   * ⚠️ 它的用法**只有两种**：画「继承中」的占位符、以及判断「半对 0 分」那条提示。
   * **不要**拿它去预填输入框 —— 预填等于把继承拍成了副本（规格 §12 裁定 4 的理由）。
   */
  inheritedPoints: { full: number; half: number };
  onPromptChange: (prompt: string) => void;
  onDataChange: (patch: Record<string, unknown>) => void;
  onPointsChange: (points: QuestionPointsDraft | undefined) => void;
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

      <PointsRow
        index={index}
        node={node}
        inheritedPoints={inheritedPoints}
        onPointsChange={onPointsChange}
      />

      {node.type === 'single-choice' && <SingleChoiceBody node={node} onDataChange={onDataChange} />}
      {node.type === 'fill-blank' && <FillBlankBody node={node} onDataChange={onDataChange} />}
      {node.type === 'short-answer' && (
        <p className="worksheet-editor-hint">问答题是主观题，不自动判分 —— 看板上只统计作答进度。</p>
      )}
    </section>
  );
}

/** `points` 里那一格的文本（`undefined` ⇒ 空串 = 没填）。半填靠它渲染出来。 */
function pointText(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/**
 * 逐题分值的**两栏行**（规格 §12 裁定 4 / 5）。
 *
 * ```
 * 分值  全对 [ 7 ]  半对 [   ]      ← 留空 = 跟随学习单（3 / 2）
 * ```
 *
 * 🔴 **留空 = 继承，且不要预填。** 输入框为空 ⇒ `onPointsChange(undefined)`（整份
 * `points` 消失 = 跟随学习单级）。占位符显示**继承中的那个数**，于是「留空」在屏幕上
 * 不是一个空洞，而是一个**看得见、但是灰的**数 —— 教师能分辨「这是跟随的值」与
 * 「这是我填的值」。预填成实字就分不出这两者了，而教师改学习单级的档时，已保存的题
 * 不会跟随，他看不到任何提示（裁定 4 要防的正是这个）。
 *
 * ⚠️ **两个框要么都填、要么都空**。只填一个**不是一个能保存的状态**：
 * 服务端的 `normalizePoints` 会把缺的那一端补成 `DEFAULT_POINTS`（**不是**学习单级的档）
 * ⇒ 教师填了「全对 7」、半对留空，半对**静默变成 0 分**。实测与完整理由见
 * `findPartialPoints`。这里给红字，保存时 `save()` 会真的拦下。
 *
 * ⚠️ **非法输入不进 reducer**（`onPointsChange` 不被调用）：`points` 只装 0..99 的整数，
 * 塞不进 `'7.5'`。被拒的文本**临时留在屏幕上**（否则教师打的字会当着他的面消失），
 * 靠 `rejected` 那一格 —— 它带**签名**，`node.points` 一变（撤销 / 恢复草稿 / 换题）
 * 就自动失效，所以不会出现「撤销之后框里还留着刚才那段非法文本」。
 */
function PointsRow({ index, node, inheritedPoints, onPointsChange }: {
  index: number;
  node: WorksheetQuestionNode;
  inheritedPoints: { full: number; half: number };
  onPointsChange: (points: QuestionPointsDraft | undefined) => void;
}) {
  // 只在「用户刚打了非法文本」时才有值；`signature` 让它随 `node.points` 自动失效。
  const [rejected, setRejected] = useState<{ signature: string; which: 'full' | 'half'; text: string } | null>(null);

  const signature = `${node.id}:${pointText(node.points?.full)}/${pointText(node.points?.half)}`;
  const shownRejected = rejected && rejected.signature === signature ? rejected : null;

  const fullText = shownRejected?.which === 'full' ? shownRejected.text : pointText(node.points?.full);
  const halfText = shownRejected?.which === 'half' ? shownRejected.text : pointText(node.points?.half);

  const commit = (which: 'full' | 'half', raw: string) => {
    const full = parsePointInput(which === 'full' ? raw : fullText);
    const half = parsePointInput(which === 'half' ? raw : halfText);
    if (full.kind === 'invalid' || half.kind === 'invalid') {
      setRejected({ signature, which, text: raw });
      return;
    }
    setRejected(null);
    // ⚠️ 半填要**如实**交给 reducer（不能因为「另一端还没填」就不提交）—— 否则教师刚打的
    // 那个字会被下一次渲染吞掉（输入框的值是从 `node.points` 算出来的）。
    const next: QuestionPointsDraft = {};
    if (full.kind === 'value') next.full = full.value;
    if (half.kind === 'value') next.half = half.value;
    onPointsChange(next.full === undefined && next.half === undefined ? undefined : next);
  };

  const invalidHint = (parsePointInput(fullText).kind === 'invalid' || parsePointInput(halfText).kind === 'invalid')
    // 这一条同时覆盖两种来路：
    //   · 教师**刚打的**那个字（`shownRejected` 把它留在屏幕上）—— 它没进 reducer；
    //   · 库里**已经存在**的越界值（只能来自手工改过的行，编辑器的输入路径产生不了它）。
    //     第二种没有这条提示就等于**静默**：服务端的 `normalizePointValue` 对越界值
    //     **回落** `DEFAULT_POINTS`（200 变成 1），保存照常 200，而框里还写着 200。
    ? `分值只能是 0–${POINTS_MAX} 的整数，请改一下。`
    : null;
  // ⚠️ 非法值优先：两框非法 + 只填了一个时只显示前一条 —— 两条红字挤在一起，
  // 教师会先去改那个**更靠前**的错，而两条的路数是同一个（先把框改成合法值）。
  const partialHint = !invalidHint && isPartialPoints(node.points)
    ? '两个框要么都填，要么都留空 —— 只填一个的话，另一个会按 0 分算，学生那边看不出来。'
    : null;

  return (
    <div className="worksheet-editor-points">
      <span className="worksheet-editor-points-label">分值</span>
      <label className="worksheet-editor-points-field">
        <span>全对</span>
        <input
          className="input"
          type="text"
          inputMode="numeric"
          value={fullText}
          placeholder={String(inheritedPoints.full)}
          aria-label={`第 ${index + 1} 题全对得分`}
          onChange={event => commit('full', event.target.value)}
        />
      </label>
      <label className="worksheet-editor-points-field">
        <span>半对</span>
        <input
          className="input"
          type="text"
          inputMode="numeric"
          value={halfText}
          placeholder={String(inheritedPoints.half)}
          aria-label={`第 ${index + 1} 题半对得分`}
          onChange={event => commit('half', event.target.value)}
        />
      </label>
      <span className="worksheet-editor-points-note">
        留空 = 跟随学习单（{inheritedPoints.full} / {inheritedPoints.half}）
      </span>
      {invalidHint && <p className="worksheet-editor-warn-hint">{invalidHint}</p>}
      {partialHint && <p className="worksheet-editor-warn-hint">{partialHint}</p>}
      {shouldWarnZeroHalfCredit(node, inheritedPoints) && (
        // 🔴 规格 §12 裁定 3 的**连带要求**，一个字都不许省：没有这句，教师会以为自己开了
        // 部分得分，而学生**一分都拿不到**，且没有任何报错 —— 他会去怀疑学生。
        <p className="worksheet-editor-warn-hint">
          半对给 0 分，等于全对才算 —— 若想给部分分，请把半对填成一个正数。
        </p>
      )}
    </div>
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
