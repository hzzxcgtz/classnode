'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import { ChoiceOptionsEditor } from './choice-options';

/**
 * 多选题：选项列表（`ChoiceOptionsEditor` 的 `multiple` 那一支）
 * + 「评分方式 ○ 全对才算 ○ 漏选算部分给分」（brief Step 2）。
 *
 * 🔴 **评分方式是「漏选算部分给分」还是「全对才算」，只认两个字面量**（规格 §12 的裁定）：
 *   · `'all-or-nothing'` —— 全对才算（默认）；
 *   · `'allow-missing'`  —— 漏选算部分给分。
 * 服务端 `allowsMissing` **只认 `'allow-missing'` 这一个值**，认不出的（缺字段、拼错、
 * 别的写法）一律按「全对才算」走。⇒ 这里两个单选按钮写出去的永远只有这两个字面量之一
 *（写别的值会被服务端 400 拒，而 B1 那条拒绝是**响亮**的、有意的）。
 *
 * ⚠️ **部分给分档是 0 时界面必须说一句话** —— 那是「选了漏选算部分给分、而学生一分都拿不到」，
 * 教师会以为部分得分已经开好了。那句话在 `PointsRow` 里（`shouldWarnZeroHalfCredit`），
 * 因为判据要用到学习单级的两档，而这张卡片的这一层拿不到它。
 */
export function MultiChoiceBody({ node, onDataChange, showAnswer = true }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  /** 关掉「允许自动评分」时为 `false` ⇒ 答案那一块不渲染（题面照常）。 */
  showAnswer?: boolean;
}) {
  // 判据与服务端 `allowsMissing` 逐字一致：**只有** 'allow-missing' 算「漏选算部分给分」。
  // 认不出的值 ⇒ 这个按钮显示成未选中（= 全对才算），与判分的行为一致 ——
  // 反过来显示会让教师在屏幕上看到一个服务端并不认的选项。
  const multiple = node.type === 'multi-choice' || node.data.choiceMode === 'multiple';
  const allowMissing = node.data.partialCredit === 'allow-missing';

  const setMultiple = (nextMultiple: boolean) => {
    const correct = Array.isArray(node.data.correctKeys) ? node.data.correctKeys.filter((item): item is string => typeof item === 'string') : [];
    onDataChange({
      choiceMode: nextMultiple ? 'multiple' : 'single',
      partialCredit: 'all-or-nothing',
      ...(nextMultiple ? {} : { correctKeys: correct.slice(0, 1) }),
    });
  };

  return (
    <>
      <fieldset className="worksheet-editor-scoring-method worksheet-editor-choice-mode">
        <legend>选择方式</legend>
        <div className="worksheet-editor-scoring-options">
          <label className={!multiple ? 'is-selected' : ''}><input type="radio" name={`choice-mode-${node.id}`} checked={!multiple} onChange={() => setMultiple(false)} /><span><strong>单选</strong><em>学生只能选择一个答案</em></span></label>
          <label className={multiple ? 'is-selected' : ''}><input type="radio" name={`choice-mode-${node.id}`} checked={multiple} onChange={() => setMultiple(true)} /><span><strong>多选</strong><em>学生可以选择多个答案</em></span></label>
        </div>
      </fieldset>

      <ChoiceOptionsEditor node={node} multiple={multiple} onDataChange={onDataChange} showAnswer={showAnswer} />

      {showAnswer && multiple && (
        <fieldset className="worksheet-editor-scoring-method">
          <legend>评分方式</legend>
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
      )}
    </>
  );
}
