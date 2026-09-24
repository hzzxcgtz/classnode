'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import { ChoiceOptionsEditor } from './choice-options';

/**
 * 多选题：选项列表（`ChoiceOptionsEditor` 的 `multiple` 那一支）
 * + 「评分方式 ○ 全对才算 ○ 漏选算半对」（brief Step 2）。
 *
 * 🔴 **评分方式是「漏选算半对」还是「全对才算」，只认两个字面量**（规格 §12 的裁定）：
 *   · `'all-or-nothing'` —— 全对才算（默认）；
 *   · `'allow-missing'`  —— 漏选算半对。
 * 服务端 `allowsMissing` **只认 `'allow-missing'` 这一个值**，认不出的（缺字段、拼错、
 * 别的写法）一律按「全对才算」走。⇒ 这里两个单选按钮写出去的永远只有这两个字面量之一
 *（写别的值会被服务端 400 拒，而 B1 那条拒绝是**响亮**的、有意的）。
 *
 * ⚠️ **半对档是 0 时界面必须说一句话** —— 那是「选了漏选算半对、而学生一分都拿不到」，
 * 教师会以为部分得分已经开好了。那句话在 `PointsRow` 里（`shouldWarnZeroHalfCredit`），
 * 因为判据要用到学习单级的两档，而这张卡片的这一层拿不到它。
 */
export function MultiChoiceBody({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  // 判据与服务端 `allowsMissing` 逐字一致：**只有** 'allow-missing' 算「漏选算半对」。
  // 认不出的值 ⇒ 这个按钮显示成未选中（= 全对才算），与判分的行为一致 ——
  // 反过来显示会让教师在屏幕上看到一个服务端并不认的选项。
  const allowMissing = node.data.partialCredit === 'allow-missing';

  return (
    <>
      <ChoiceOptionsEditor node={node} multiple onDataChange={onDataChange} />

      <div className="worksheet-editor-inline-actions">
        <span className="worksheet-editor-block-label">评分方式</span>
        <label className="worksheet-editor-option-correct">
          <input
            type="radio"
            name={`partial-${node.id}`}
            checked={!allowMissing}
            onChange={() => onDataChange({ partialCredit: 'all-or-nothing' })}
          />
          <span>全对才算</span>
        </label>
        <label className="worksheet-editor-option-correct">
          <input
            type="radio"
            name={`partial-${node.id}`}
            checked={allowMissing}
            onChange={() => onDataChange({ partialCredit: 'allow-missing' })}
          />
          <span>漏选算半对</span>
        </label>
      </div>

      <p className="worksheet-editor-hint">
        选了「漏选算半对」之后，学生只勾了正确答案里的一部分（<strong>一个错的都没勾</strong>）时得上面
        「分值」一行的<strong>半对</strong>那个数；少勾但勾错了、或者什么都没勾，一律 0 分。
        半对给几分由那一行决定 —— 填 0 就等于「全对才算」。
      </p>
    </>
  );
}
