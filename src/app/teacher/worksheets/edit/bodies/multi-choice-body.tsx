'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import { ChoiceOptionsEditor } from './choice-options';
import { isMultipleChoice } from '../worksheet-editor-core';

/**
 * ★ 2026-09-27（教师裁定）：这个文件原来只有一个组件（选项 + 评分方式挤在一起）。
 * 编辑页重排成两层之后，它们**分别属于两个容器**：
 *
 *   · `ChoiceOptionsBody`      —— 容器 A「题目内容」里的**选项**块
 *   · `ChoicePartialCreditBody` —— 容器 B「自动评分设置」里的**评分方式**块
 *
 * ⚠️ 拆开是为了让「块标题」与「块内容」一一对应（教师：「容器标题、编辑框标题要好好考虑一下」）——
 * 一个组件横跨两个容器，块标题就没法各自取准。
 */
export function ChoiceOptionsBody({ node, onDataChange, showAnswer = true }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  /** 关掉「允许自动评分」时为 `false` ⇒ 只隐藏正确答案那几个圆点/勾选框，选项列表照常。 */
  showAnswer?: boolean;
}) {
  // ⚠️ 判据在核心里（`isMultipleChoice`，有用例）——「粘贴题目」那条路也要用它，
  // 两处各写一遍的后果是「勾了三个正确答案、保存下来只剩一个」。
  return (
    <ChoiceOptionsEditor
      node={node}
      multiple={isMultipleChoice(node)}
      onDataChange={onDataChange}
      showAnswer={showAnswer}
    />
  );
}

/**
 * 容器 B 的**评分方式**块：多选「漏选算不算部分分」。
 *
 * ⚠️ **非多选题时渲染 `null`** —— 单选口径下没有「漏选」这回事。
 * 块标题由调用方画（`question-card.tsx`），所以这里也负责让调用方知道该不该画那一段：
 * 调用方用的是同一个判据（`isMultipleChoice`）。
 *
 * 🔴 **评分方式是「漏选算部分给分」还是「全对才算」，只认两个字面量**（规格 §12 的裁定）：
 *   · `'all-or-nothing'` —— 全对才算（默认）；
 *   · `'allow-missing'`  —— 漏选算部分给分。
 * 服务端 `allowsMissing` **只认 `'allow-missing'` 这一个值**，认不出的（缺字段、拼错、
 * 别的写法）一律按「全对才算」走 ⇒ 这里两个单选按钮写出去的永远只有这两个字面量之一。
 *
 * ⚠️ **部分给分档是 0 时界面必须说一句话** —— 那是「选了漏选算部分给分、而学生一分都拿不到」，
 * 教师会以为部分得分已经开好了。那句话在 `PointsRow` 里（`shouldWarnZeroHalfCredit`），
 * 因为判据要用到学习单级的两档，而这一层拿不到它。
 */
export function ChoicePartialCreditBody({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  // 判据与服务端 `allowsMissing` 逐字一致：**只有** 'allow-missing' 算「漏选算部分给分」。
  // 认不出的值 ⇒ 这个按钮显示成未选中（= 全对才算），与判分的行为一致 ——
  // 反过来显示会让教师在屏幕上看到一个服务端并不认的选项。
  const allowMissing = node.data.partialCredit === 'allow-missing';
  return (
    <fieldset className="worksheet-editor-scoring-method">
      <div className="worksheet-editor-scoring-options">
        <label className={!allowMissing ? 'is-selected' : ''}>
          <input
            type="radio"
            name={`partial-${node.id}`}
            checked={!allowMissing}
            onChange={() => onDataChange({ partialCredit: 'all-or-nothing' })}
          />
          <span>
            <strong>全对才得分</strong>
            <em>必须选中全部正确答案</em>
          </span>
        </label>
        <label className={allowMissing ? 'is-selected' : ''}>
          <input
            type="radio"
            name={`partial-${node.id}`}
            checked={allowMissing}
            onChange={() => onDataChange({ partialCredit: 'allow-missing' })}
          />
          <span>
            <strong>漏选可得部分分</strong>
            <em>只漏选且没有选错时生效</em>
          </span>
        </label>
      </div>
      <p>
        {allowMissing
          ? '学生只漏选、没有错选时，获得“部分正确”的分值；错选或未作答得 0 分。'
          : '学生必须选中全部正确答案，并且不能选错，才能获得“完全正确”的分值。'}
      </p>
    </fieldset>
  );
}
