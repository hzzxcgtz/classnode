'use client';

import type { QuestionPointsDraft, WorksheetQuestionNode } from '@/lib/types';
import {
  isPartialPoints,
  parsePointInput,
  planPointInputChange,
  pointText,
  POINTS_FULL_MIN,
  POINTS_MAX,
  pointsSignature,
  QUESTION_TYPE_OPTIONS,
  type RejectedPointInput,
  shouldWarnZeroHalfCredit,
  // 从**纯函数内核**直接取：这张卡片只用纯逻辑，不碰 hook（React 状态 / 路由 / 网络）。
  // 内核就是 `node --test` 直接跑的那一份，回归网在 `worksheet-editor-core.test.ts`。
} from './worksheet-editor-core';
// ★ M4a：6 个题型的编辑体（单选复用 `choice-options` 那一个受控组件）。
// 组件与内核分家的理由见各文件头：内核里全是可以 `node --test` 的纯函数，
// 组件这一层**没有回归网**（本仓没有 jsdom / testing-library）。
import { ChoiceOptionsEditor } from './bodies/choice-options';
import { TrueFalseBody } from './bodies/true-false-body';
import { MultiChoiceBody } from './bodies/multi-choice-body';
import { FillBlanksBody } from './bodies/fill-blanks-body';
import { OrderBody } from './bodies/order-body';
import { MatchBody } from './bodies/match-body';
import { CategorizeBody } from './bodies/categorize-body';

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
export function QuestionCard({ index, total, node, inheritedPoints, rejectedPointInput, onPromptChange, onDataChange, onPointsInputChange, onPointsChange, onMove, onRemove }: {
  index: number;
  total: number;
  node: WorksheetQuestionNode;
  /**
   * 学习单级的**两档**（`settings.rewardStep` / `settings.halfStep`）—— 逐题留空时继承的就是它们。
   * ⚠️ 它的用法**只有两种**：画「继承中」的占位符、以及判断「半对 0 分」那条提示。
   * **不要**拿它去预填输入框 —— 预填等于把继承拍成了副本（规格 §12 裁定 4 的理由）。
   */
  inheritedPoints: { full: number; half: number };
  /** 这一题那两格里**还没进 reducer** 的文本（`useWorksheetEditor` 持有，见 `PointsRow`）。 */
  rejectedPointInput: RejectedPointInput | undefined;
  onPromptChange: (prompt: string) => void;
  onDataChange: (patch: Record<string, unknown>) => void;
  onPointsInputChange: (input: RejectedPointInput | null) => void;
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
        rejectedInput={rejectedPointInput}
        onPointsInputChange={onPointsInputChange}
        onPointsChange={onPointsChange}
      />

      {/* 题型 → 编辑体。⚠️ 这里是一条**平铺的 && 链**，不是按 `QUESTION_TYPE_OPTIONS` 驱动的
          分派：那个数组在 `src/lib/worksheet-questions.ts` 里，而它必须能被 `node --test`
          直接执行（无 React）—— 往它里面塞组件就是两份真源。代价是**加题型要记得在这里加一支**，
          而漏加的后果是「那道题在新题型上只有题干、没有任何输入控件」，教师看得出不对
          （卡片上什么都没有），不像题目注册表那条漏改是静默的。 */}
      {node.type === 'single-choice' && <SingleChoiceBody node={node} onDataChange={onDataChange} />}
      {node.type === 'true-false' && <TrueFalseBody node={node} onDataChange={onDataChange} />}
      {node.type === 'multi-choice' && <MultiChoiceBody node={node} onDataChange={onDataChange} />}
      {node.type === 'fill-blank' && <FillBlanksBody node={node} onDataChange={onDataChange} />}
      {node.type === 'order' && <OrderBody node={node} onDataChange={onDataChange} />}
      {node.type === 'match' && <MatchBody node={node} onDataChange={onDataChange} />}
      {node.type === 'categorize' && <CategorizeBody node={node} onDataChange={onDataChange} />}
      {node.type === 'short-answer' && (
        <p className="worksheet-editor-hint">问答题是主观题，不自动判分 —— 看板上只统计作答进度。</p>
      )}
    </section>
  );
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
 * ⚠️ **非法输入不进 reducer**（`onPointsChange` 不被调用）：`points` 只装整数
 *（**全对 1–99 / 半对 0–99**，★ M4a/I1 —— 两档的下界不同，见上面的红字分支），
 * 塞不进 `'7.5'`。被拒的文本靠 `rejectedInput` 留在屏幕上 —— 它是**受控**的，
 * 由 `useWorksheetEditor` 持有（**不是**这里的 `useState`），因为 `save()` 必须看得见它：
 * 否则教师看到框里写着 `7.5`、顶栏写着「已保存」，而发出去的其实是上一次的合法值
 * （2026-09-24 审查实机复现的「界面在说假话」）。它带**签名**，
 * `node.points` 一变（撤销 / 恢复草稿 / 换题）就自动失效。
 */
function PointsRow({ index, node, inheritedPoints, rejectedInput, onPointsInputChange, onPointsChange }: {
  index: number;
  node: WorksheetQuestionNode;
  inheritedPoints: { full: number; half: number };
  /** 屏幕上还没进 reducer 的那两格文本（父层持有，因为 `save()` 要看得见它）。 */
  rejectedInput: RejectedPointInput | undefined;
  onPointsInputChange: (input: RejectedPointInput | null) => void;
  onPointsChange: (points: QuestionPointsDraft | undefined) => void;
}) {
  const signature = pointsSignature(node);
  const shown = rejectedInput && rejectedInput.signature === signature ? rejectedInput : null;

  const fullText = shown?.full !== undefined ? shown.full : pointText(node.points?.full);
  const halfText = shown?.half !== undefined ? shown.half : pointText(node.points?.half);

  // 判据整个在 `planPointInputChange`（内核）里 —— 「非法时两格都记」「半填如实提交」
  // 这两条都有回归网，而组件这一层没有。
  const commit = (which: 'full' | 'half', raw: string) => {
    const plan = planPointInputChange(node, which, raw, rejectedInput);
    if (plan.kind === 'rejected') {
      onPointsInputChange(plan.input);
      return;
    }
    onPointsInputChange(null);
    onPointsChange(plan.points);
  };

  // 两格的域不同（全对 1–99 / 半对 0–99），所以**提示文案必须分开** —— 一句
  // 「只能是 0–99 的整数」对着填了 0 的全对框就是错的（0 确实在 0–99 里）。
  const fullInvalid = parsePointInput(fullText, 'full').kind === 'invalid';
  const halfInvalid = parsePointInput(halfText, 'half').kind === 'invalid';
  const invalidHint = fullInvalid
    // 🔴 ★ I1：这句必须**指名道姓**说清「全对」那一档，并交代「不计分」今天没有出口 ——
    // 教师填 0 的动机通常就是「这题不计分」，而**今天没有这个设置**（留空只是跟随学习单的
    // 档，不是不计分）。不写这一句，他就会去找一个不存在的选项，或者干脆留下 0。
    ? `「全对给几分」必须是 ${POINTS_FULL_MIN} 以上（${POINTS_FULL_MIN}–${POINTS_MAX} 的整数）——`
      // ⚠️ 这段字是**教师看到的原文**（`<p>` 里渲染，不走 markdown）⇒ 不许出现 `**` 这类记号。
      + ` 填 0 的话，答对这道题的学生会看到红叉：他答对了，却一分都没有。`
      + ` 今天没有「这题不计分」这个设置 —— 两个框都留空只表示跟随学习单的档`
      + `（${inheritedPoints.full} / ${inheritedPoints.half}），不是不计分。`
    : halfInvalid
      // 这一条同时覆盖两种来路：
      //   · 教师**刚打的**那个字（`rejectedInput` 把它留在屏幕上）—— 它没进 reducer，
      //     而且 `save()` 也会拦住保存（`findUncommittedPointInput`）；
      //   · 库里**已经存在**的越界值（只能来自手工改过的行，编辑器的输入路径产生不了它）
      //     —— `save()` 由 `findInvalidPoints` 拦。
      //     第二种没有这条提示就等于**静默**：服务端的 `normalizePointValue` 对越界值
      //     **回落** `DEFAULT_POINTS`（200 变成 1），保存照常 200，而框里还写着 200。
      ? `半对只能是 0–${POINTS_MAX} 的整数（0 = 不给部分分），请改一下。`
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
 * ★ M4a：选项编辑的**逻辑与实现**搬进了 `bodies/choice-options.tsx`（单选/多选共用一份，
 * 用 `multiple` 开关区分），这里只剩「按单选口径调它」这一层。
 * 那条「`options` 与 `correctKeys` 必须**一起**提交」的纪律也跟着搬了过去 —— 它现在只有
 * 一处需要遵守（那正是拆出这个组件的目的：多选直接用 `SingleChoiceBody` 的话，
 * `writeOptions` 结尾的 `slice(0, 1)` 会把第 2 个正确答案静默丢掉）。
 */
function SingleChoiceBody({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  return <ChoiceOptionsEditor node={node} multiple={false} onDataChange={onDataChange} />;
}
